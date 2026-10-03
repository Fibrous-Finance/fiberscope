import { setTimeout as sleep } from "node:timers/promises";

import { RPC_BATCH_SIZE } from "./config.ts";
import { backoff, describeError, Pacer, retryAfterMs } from "./pacer.ts";

export interface RpcCall {
	method: string;
	params: unknown[];
}

/** An error the node returned for one call, such as a revert. */
export class RpcError extends Error {
	readonly code: number;

	constructor(code: number, message: string) {
		super(message);
		this.name = "RpcError";
		this.code = code;
	}
}

export type RpcOutcome = { ok: true; result: unknown } | { ok: false; error: RpcError };

interface Reply {
	id?: unknown;
	result?: unknown;
	error?: { code?: number; message?: string };
}

const ATTEMPTS = 12;
const TIMEOUT_MS = 30_000;
/** HTTP requests one `batch()` keeps in flight. */
const LANES = 3;
/**
 * `eth_call` is limited far more tightly than other methods on the public Base RPC: measured at
 * about 15 calls/s overall but only about 0.5 `eth_call`/s (it publishes no limits). So it gets a
 * pacer of its own at 1/30 of BASE_RPC_RPS, which is 0.5/s at the default 15.
 */
const ETH_CALL_SHARE = 1 / 30;

/**
 * A rate-limited JSON-RPC client that retries rate limits, failed HTTP requests, timeouts and
 * transient node errors.
 */
export class Rpc {
	readonly url: string;
	readonly stats = { calls: 0, retries: 0 };
	#pacer: Pacer;
	#ethCallPacer: Pacer;
	#id = 0;

	constructor(url: string, maxCallsPerSecond: number) {
		this.url = url;
		this.#pacer = new Pacer(maxCallsPerSecond);
		this.#ethCallPacer = new Pacer(maxCallsPerSecond * ETH_CALL_SHARE);
	}

	/** Sends one call and returns its result; throws the node's error. */
	async call<T>(method: string, params: unknown[]): Promise<T> {
		const [outcome] = await this.batch([{ method, params }]);
		if (!outcome.ok) throw outcome.error;
		return outcome.result as T;
	}

	/** Sends many calls in JSON-RPC batches; the node's errors come back in place. */
	async batch(calls: RpcCall[]): Promise<RpcOutcome[]> {
		const outcomes: RpcOutcome[] = new Array(calls.length);
		const groups: number[][] = [];
		for (let start = 0; start < calls.length; start += RPC_BATCH_SIZE) {
			const size = Math.min(RPC_BATCH_SIZE, calls.length - start);
			groups.push(Array.from({ length: size }, (_, k) => start + k));
		}
		let next = 0;
		const lane = async () => {
			while (next < groups.length) await this.#settle(calls, groups[next++], outcomes);
		};
		await Promise.all(Array.from({ length: Math.min(LANES, groups.length) }, lane));
		return outcomes;
	}

	/** Sends one group of calls until every call has a final outcome. */
	async #settle(calls: RpcCall[], group: number[], outcomes: RpcOutcome[]): Promise<void> {
		let pending = group;
		let problem = "";
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			if (attempt > 0) {
				this.stats.retries++;
				await sleep(backoff(attempt - 1));
			}
			const ids = pending.map(() => ++this.#id);
			let replies: Map<unknown, Reply>;
			try {
				const body = pending.map((index, k) => ({
					jsonrpc: "2.0",
					id: ids[k],
					...calls[index],
				}));
				replies = new Map((await this.#post(body)).map((reply) => [reply.id, reply]));
			} catch (error) {
				problem = describeError(error);
				continue;
			}
			const retry: number[] = [];
			const limited = new Set<Pacer>();
			pending.forEach((index, k) => {
				const reply = replies.get(ids[k]);
				if (reply?.error) {
					const error = new RpcError(
						reply.error.code ?? 0,
						reply.error.message ?? "unknown"
					);
					if (isRateLimit(error.code, error.message)) {
						limited.add(
							calls[index].method === "eth_call" ? this.#ethCallPacer : this.#pacer
						);
					} else if (!isTransient(error)) {
						outcomes[index] = { ok: false, error };
						return;
					}
					problem = error.message;
					retry.push(index);
				} else if (reply) {
					outcomes[index] = { ok: true, result: reply.result };
				} else {
					problem = "no reply";
					retry.push(index);
				}
			});
			for (const pacer of limited) pacer.throttle(1_000);
			pending = retry;
			if (pending.length === 0) return;
		}
		throw new Error(`${calls[pending[0]].method} failed ${ATTEMPTS} times: ${problem}`);
	}

	async #post(body: (RpcCall & { id: number })[]): Promise<Reply[]> {
		const ethCalls = body.filter((call) => call.method === "eth_call").length;
		if (ethCalls > 0) await this.#ethCallPacer.take(ethCalls);
		await this.#pacer.take(body.length);
		this.stats.calls += body.length;
		const response = await fetch(this.url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) {
			await response.body?.cancel();
			if (response.status === 429) {
				this.#pacer.throttle(retryAfterMs(response.headers.get("retry-after")) ?? 2_000);
			}
			throw new Error(`HTTP ${response.status}`);
		}
		const json = (await response.json()) as Reply | Reply[];
		if (Array.isArray(json)) return json;
		// The node rejected the whole batch with a single error object.
		const message = json.error?.message ?? "unexpected reply";
		if (isRateLimit(json.error?.code, message)) this.#pacer.throttle(1_000);
		throw new Error(`batch rejected: ${message}`);
	}
}

function isRateLimit(code: number | undefined, message: string): boolean {
	return code === -32016 || code === 429 || /rate limit|too many requests/i.test(message);
}

/** Node errors worth retrying: overload and lagging-backend symptoms, never reverts. */
function isTransient(error: RpcError): boolean {
	if (error.code === 3 || /revert/i.test(error.message)) return false;
	return (
		error.code === -32603 ||
		/header not found|unknown block|missing trie node|timeout|timed out|unavailable|try again|busy/i.test(
			error.message
		)
	);
}
