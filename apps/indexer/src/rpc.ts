import { setTimeout as sleep } from "node:timers/promises";

import { RPC_BATCH_SIZE } from "./config.ts";
import { isRecord } from "./guards.ts";
import { log } from "./log.ts";
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

/**
 * The endpoint will not serve the indexer, so asking again is no use: it refuses the key or the
 * host, its quota is spent, it refuses the request itself, or it asks to wait longer than
 * RETRY_AFTER_CAP_MS.
 */
export class EndpointError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EndpointError";
	}
}

/** A call that timed out as many times as its caller allows (see CallOptions). */
export class RpcTimeout extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RpcTimeout";
	}
}

export type RpcOutcome = { ok: true; result: unknown } | { ok: false; error: RpcError };

export interface CallOptions {
	/**
	 * How many times the call may time out before it fails with an RpcTimeout, for a caller that
	 * can ask for less instead, as getLogs halves its range. By default a timeout is retried as
	 * any passing failure is.
	 */
	timeouts?: number;
}

export interface RpcStats {
	/** Calls sent: every call of a batch, retries included. */
	calls: number;
	/** Requests sent again after a failure. */
	retries: number;
	/** `calls` by method, as providers that price methods differently count them. */
	byMethod: Record<string, number>;
}

/**
 * What the client does about a failed request or call (see classify):
 * - auth: the endpoint refuses the key or the host; asking again is no use.
 * - quota: the endpoint's quota is spent; no use either.
 * - rate: too many requests; slow down, pause and ask again.
 * - lag: the node that answered has not reached the block yet; ask again shortly, and never split
 *   a log range for it.
 * - timeout: ask again, unless the caller can ask for less (CallOptions.timeouts).
 * - transient: overload or another passing failure; ask again.
 * - final: the node refuses the call itself (a revert, invalid params, a log range too wide); the
 *   caller decides.
 */
export type Verdict = "auth" | "quota" | "rate" | "lag" | "timeout" | "transient" | "final";

interface Reply {
	id?: unknown;
	result?: unknown;
	error?: unknown;
}

/** An error a reply or a response body holds: a JSON-RPC error, or a gateway's message. */
interface NodeError {
	code: number | undefined;
	message: string;
}

/** A response: its HTTP status, Retry-After in ms, and its body, parsed when it is JSON. */
interface Received {
	status: number;
	statusText: string;
	retryAfter: number | null;
	text: string;
	json: unknown;
}

/** A call that failed, and what to do about it. */
interface Failure {
	index: number;
	verdict: Verdict;
	/** The HTTP status and the node's message, for the log and errors. */
	reason: string;
}

/** The calls of a request to send again after an attempt, and why. */
interface Attempt {
	retry: number[];
	reason: string;
	/** Whether the request, or one of its calls, timed out. */
	timedOut: boolean;
	/** How long a rate limit asks to wait, in ms; 0 without one. */
	pause: number;
}

const ATTEMPTS = 12;
const TIMEOUT_MS = 30_000;
/** HTTP requests one `batch()` keeps in flight. */
const LANES = 3;
/**
 * `eth_call` is limited far more tightly than other methods on the public Base RPC: measured at
 * about 15 calls/s overall but only about 0.5 `eth_call`/s (it publishes no limits). So it gets a
 * pacer of its own at 1/30 of the RPC rate (BASE_RPC_RPS or BNB_RPC_RPS), 0.5/s at the default 15.
 */
const ETH_CALL_SHARE = 1 / 30;
/**
 * The longest Retry-After the client waits out; a longer one fails at once. Keyless thirdweb
 * asked for 175 to 300 seconds on every request, and waiting each one out kept a run silent for
 * half an hour without finishing a range.
 */
const RETRY_AFTER_CAP_MS = 60_000;
/** The longest excerpt of a response body that a reason keeps, in characters. */
const EXCERPT_LENGTH = 200;
/** The shortest part of the endpoint's URL that may be its key, in characters (see #redact). */
const SECRET_LENGTH = 16;

// The patterns below read the node's message, or a failed request's body. The examples are the
// answers of the providers the indexer has used.

/**
 * A spent quota: NodeReal's "ran out of cu", which comes with HTTP 429, and a monthly or daily
 * cap's answer.
 */
const QUOTA = /ran out of cu|quota|monthly|daily|payment required/i;
/**
 * Too many requests: NodeReal's "Your account has exceeded its Compute Units Per Second
 * capacity…" and its per-method "limit exceeded", which BNB Chain's public nodes answer too.
 */
const RATE = /rate.?limit|too many requests|per second|^limit exceeded$|exceeded .*capacity/i;
/**
 * A key or a host the endpoint refuses: NodeReal's "Unauthorized" and "IP address … is not on
 * whitelist", "Access token missing or invalid", and publicnode's "Archive requests require a
 * personal token".
 */
const AUTH =
	/unauthori[sz]ed|forbidden|access denied|access token|api key|invalid key|not on whitelist|personal token/i;
/**
 * A node behind the block asked for: geth's, BSC's and reth's "block range extends beyond current
 * head block" for an eth_getLogs range up to the safe block, and "header not found".
 */
const LAG = /beyond current head|header not found|unknown block|block not found/i;
/** NodeReal's "timeout" (its 30-second limit), "timed out", geth's "context deadline exceeded". */
const TIMEOUT = /timeout|timed out|deadline exceeded/i;
/** Overload and passing failures, such as "missing trie node" from a node still catching up. */
const TRANSIENT = /missing trie node|unavailable|try again|busy|internal error/i;

/**
 * What to do about a failed request or call (see Verdict), from the node's error code and message
 * and the HTTP status that carried them: 200 for an error in a normal reply. A spent quota comes
 * first, so a 429 that says the quota is spent fails at once; then a rate limit, so a 403 that
 * says the client is rate-limited is waited out.
 */
export function classify(code: number | undefined, message: string, status: number): Verdict {
	if (code === 3 || /revert/i.test(message)) return "final";
	if (status === 402 || QUOTA.test(message)) return "quota";
	if (status === 429 || code === 429 || code === -32016 || RATE.test(message)) return "rate";
	if (status === 401 || status === 403 || AUTH.test(message)) return "auth";
	if (LAG.test(message)) return "lag";
	if (status === 408 || status === 504 || status === 524 || TIMEOUT.test(message)) {
		return "timeout";
	}
	if (status >= 500 || code === -32603 || TRANSIENT.test(message)) return "transient";
	return "final";
}

/**
 * A rate-limited JSON-RPC client. It retries rate limits, failed HTTP requests, timeouts and
 * transient node errors, logging one line for each retry, and gives up at once on an endpoint that
 * refuses it (see Verdict).
 */
export class Rpc {
	readonly stats: RpcStats = { calls: 0, retries: 0, byMethod: {} };
	/**
	 * The widest eth_getLogs range the endpoint serves, in blocks, once a refusal has shown it;
	 * null until then. getLogs keeps its requests within it for the rest of the process.
	 */
	logRange: number | null = null;
	readonly #url: string;
	/** The parts of the URL that may be its key, kept out of every message (see #redact). */
	readonly #secrets: string[];
	readonly #pacer: Pacer;
	readonly #ethCallPacer: Pacer;
	#id = 0;

	constructor(url: string, maxCallsPerSecond: number) {
		this.#url = url;
		this.#secrets = secretsOf(url);
		this.#pacer = new Pacer(maxCallsPerSecond);
		this.#ethCallPacer = new Pacer(maxCallsPerSecond * ETH_CALL_SHARE);
	}

	/** Sends one call and returns its result; throws the node's error. */
	async call<T>(method: string, params: unknown[], options: CallOptions = {}): Promise<T> {
		const [outcome] = await this.#batch([{ method, params }], options.timeouts ?? Infinity);
		if (!outcome.ok) throw outcome.error;
		return outcome.result as T;
	}

	/** Sends many calls in JSON-RPC batches; the node's errors come back in place. */
	async batch(calls: RpcCall[]): Promise<RpcOutcome[]> {
		return this.#batch(calls, Infinity);
	}

	async #batch(calls: RpcCall[], timeouts: number): Promise<RpcOutcome[]> {
		const outcomes: RpcOutcome[] = new Array(calls.length);
		const groups: number[][] = [];
		for (let start = 0; start < calls.length; start += RPC_BATCH_SIZE) {
			const size = Math.min(RPC_BATCH_SIZE, calls.length - start);
			groups.push(Array.from({ length: size }, (_, k) => start + k));
		}
		let next = 0;
		const lane = async () => {
			while (next < groups.length) {
				await this.#settle(calls, groups[next++], outcomes, timeouts);
			}
		};
		await Promise.all(Array.from({ length: Math.min(LANES, groups.length) }, lane));
		return outcomes;
	}

	/** Sends one group of calls until every call has a final outcome. */
	async #settle(
		calls: RpcCall[],
		group: number[],
		outcomes: RpcOutcome[],
		timeouts: number
	): Promise<void> {
		let pending = group;
		let reason = "";
		let pause = 0;
		let timedOut = 0;
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			if (attempt > 0) {
				this.stats.retries++;
				const delay = Math.max(backoff(attempt - 1), pause);
				log(
					`rpc: retrying ${describeCalls(calls, pending)} in ${(delay / 1000).toFixed(1)}s ` +
						`(attempt ${attempt + 1} of ${ATTEMPTS}): ${reason}`
				);
				await sleep(delay);
			}
			const result = await this.#exchange(calls, pending, outcomes);
			if (result === null) return;
			({ retry: pending, reason, pause } = result);
			if (result.timedOut && ++timedOut >= timeouts) {
				throw new RpcTimeout(
					`${describeCalls(calls, pending)} timed out ${timedOut} times: ${reason}`
				);
			}
		}
		throw new Error(`${calls[pending[0]].method} failed ${ATTEMPTS} times: ${reason}`);
	}

	/**
	 * Sends the pending calls of a group once and records the outcome of each call that gets one.
	 * Returns the calls to send again and why, or null when none is left. Throws when the
	 * endpoint will not serve: it refuses access or the request, its quota is spent, or it asks
	 * to wait longer than RETRY_AFTER_CAP_MS.
	 */
	async #exchange(
		calls: RpcCall[],
		pending: number[],
		outcomes: RpcOutcome[]
	): Promise<Attempt | null> {
		const ids = pending.map(() => ++this.#id);
		let response: Received;
		try {
			response = await this.#post(
				pending.map((index, k) => ({ jsonrpc: "2.0", id: ids[k], ...calls[index] }))
			);
		} catch (error) {
			const reason = this.#redact(describeError(error));
			return { retry: pending, reason, timedOut: TIMEOUT.test(reason), pause: 0 };
		}
		const failures: Failure[] = [];
		// The pacers that a rate limit slows down.
		const limited = new Set<Pacer>();
		const replies = repliesTo(response.json, ids);
		if (replies === null) {
			// No call got a reply of its own: the request failed as a whole.
			const { verdict, reason, error } = this.#requestFailure(response);
			if (verdict === "final") {
				// A node's error for the whole batch belongs to each call; a refusal without one,
				// such as an HTTP 404 page, means the endpoint will not take the request.
				if (error === null) {
					throw new EndpointError(
						`${describeCalls(calls, pending)}: the RPC endpoint refuses the request (${reason})`
					);
				}
				for (const index of pending) outcomes[index] = { ok: false, error };
				return null;
			}
			for (const index of pending) failures.push({ index, verdict, reason });
			if (verdict === "rate") limited.add(this.#pacer);
		} else {
			pending.forEach((index, k) => {
				const reply = replies.get(ids[k]);
				if (reply === undefined) {
					failures.push({ index, verdict: "transient", reason: "no reply" });
					return;
				}
				const error = replyError(reply);
				if (error === null) {
					outcomes[index] = { ok: true, result: reply.result };
					return;
				}
				const message = this.#redact(error.message);
				const verdict = classify(error.code, message, response.status);
				if (verdict === "final") {
					outcomes[index] = { ok: false, error: new RpcError(error.code ?? 0, message) };
					return;
				}
				failures.push({ index, verdict, reason: reasonOf(response, error.code, message) });
				if (verdict === "rate") {
					limited.add(
						calls[index].method === "eth_call" ? this.#ethCallPacer : this.#pacer
					);
				}
			});
		}
		if (failures.length === 0) return null;
		const refused = failures.find(({ verdict }) => verdict === "auth" || verdict === "quota");
		if (refused !== undefined) {
			const what = refused.verdict === "auth" ? "refuses access" : "has spent its quota";
			throw new EndpointError(
				`${describeCalls(calls, pending)}: the RPC endpoint ${what} (${refused.reason})`
			);
		}
		const shown = failures.find(({ verdict }) => verdict === "rate") ?? failures[0];
		let pause = 0;
		if (limited.size > 0) {
			pause = response.retryAfter ?? (response.status === 429 ? 2_000 : 1_000);
			if (pause > RETRY_AFTER_CAP_MS) {
				throw new EndpointError(
					`${describeCalls(calls, pending)}: the RPC endpoint asks to wait ` +
						`${Math.round(pause / 1000)}s (${shown.reason})`
				);
			}
			if (response.status === 429) limited.add(this.#pacer);
			for (const pacer of limited) pacer.throttle(pause);
		}
		return {
			retry: failures.map(({ index }) => index),
			reason: shown.reason,
			timedOut: failures.some(({ verdict }) => verdict === "timeout"),
			pause,
		};
	}

	/**
	 * Why a request none of whose calls got a reply failed, from its HTTP status and body. The
	 * whole body decides the verdict; the reason keeps its first EXCERPT_LENGTH characters.
	 */
	#requestFailure(response: Received): {
		verdict: Verdict;
		reason: string;
		error: RpcError | null;
	} {
		const error = bodyError(response.json);
		// A success that holds neither the calls' replies nor an error.
		const unexpected = error === null && response.status >= 200 && response.status < 300;
		// A body's markup goes before the redaction, whose placeholders it would remove, and the
		// cut comes after it, since a key cut short would no longer be found.
		const message = this.#redact(
			error === null
				? response.text
						.replace(/<[^>]*>/g, " ")
						.replace(/\s+/g, " ")
						.trim()
				: error.message
		);
		const excerpt =
			message.length > EXCERPT_LENGTH ? `${message.slice(0, EXCERPT_LENGTH)}…` : message;
		const said = unexpected ? `unexpected reply: ${excerpt}` : excerpt;
		return {
			verdict: unexpected ? "transient" : classify(error?.code, message, response.status),
			reason: reasonOf(response, error?.code, said),
			error: error === null ? null : new RpcError(error.code ?? 0, message),
		};
	}

	/** Sends a request at the pace allowed; throws when no response comes back. */
	async #post(body: (RpcCall & { id: number })[]): Promise<Received> {
		const ethCalls = body.filter((call) => call.method === "eth_call").length;
		if (ethCalls > 0) await this.#ethCallPacer.take(ethCalls);
		await this.#pacer.take(body.length);
		this.stats.calls += body.length;
		for (const { method } of body) {
			this.stats.byMethod[method] = (this.stats.byMethod[method] ?? 0) + 1;
		}
		const response = await fetch(this.#url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		// The body of a failed request too: it says why.
		const text = await response.text();
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch {
			json = undefined;
		}
		return {
			status: response.status,
			statusText: response.statusText,
			retryAfter: retryAfterMs(response.headers.get("retry-after")),
			text,
			json,
		};
	}

	/**
	 * Text from the endpoint without its URLs, and without any part of the endpoint's own URL that
	 * may be its key: a reason is logged, and an endpoint may echo the request.
	 */
	#redact(text: string): string {
		let redacted = text.replace(/\b[a-z][a-z\d+.-]*:\/\/\S+/gi, "<url>");
		for (const secret of this.#secrets) redacted = redacted.replaceAll(secret, "<redacted>");
		return redacted;
	}
}

/**
 * The replies a response body holds for the request's calls, by id: a batch's array, or a single
 * reply that answers one of them. Null when it answers none: an HTTP error, or an error for the
 * request as a whole.
 */
function repliesTo(json: unknown, ids: number[]): Map<unknown, Reply> | null {
	const asked = new Set<unknown>(ids);
	const replies = new Map<unknown, Reply>();
	for (const reply of Array.isArray(json) ? json : [json]) {
		if (isRecord(reply) && asked.has(reply.id)) replies.set(reply.id, reply);
	}
	return replies.size === 0 ? null : replies;
}

/** The error of one reply; null when it has none. */
function replyError(reply: Reply): NodeError | null {
	const { error } = reply;
	if (!error) return null;
	if (!isRecord(error)) return { code: undefined, message: String(error) };
	return {
		code: typeof error.code === "number" ? error.code : undefined,
		message: typeof error.message === "string" ? error.message : "unknown",
	};
}

/**
 * The error a response body holds for the request as a whole: a JSON-RPC error, the first in a
 * batch's replies, or a gateway's `message`; null when it holds none.
 */
function bodyError(json: unknown): NodeError | null {
	for (const item of Array.isArray(json) ? json : [json]) {
		if (!isRecord(item)) continue;
		const error = replyError(item);
		if (error !== null) return error;
		if (typeof item.message === "string") return { code: undefined, message: item.message };
	}
	return null;
}

/**
 * A failure's reason for the log and errors: the HTTP status unless it is a success, then the
 * node's code and message.
 */
function reasonOf(response: Received, code: number | undefined, message: string): string {
	const said = [code, message].filter((part) => part !== undefined && part !== "").join(" ");
	if (response.status >= 200 && response.status < 300) return said;
	const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
	return said === "" ? status : `${status}: ${said}`;
}

/** The calls of a request for the log: "eth_getLogs", "10 eth_call calls" or "3 calls". */
function describeCalls(calls: RpcCall[], indexes: number[]): string {
	const { method } = calls[indexes[0]];
	if (indexes.length === 1) return method;
	const same = indexes.every((index) => calls[index].method === method);
	return same ? `${indexes.length} ${method} calls` : `${indexes.length} calls`;
}

/**
 * The parts of an endpoint's URL that may be its key: its credentials and its long host labels,
 * path segments and query values. The whole URL when it does not parse.
 */
function secretsOf(url: string): string[] {
	if (!URL.canParse(url)) return [url];
	const { username, password, hostname, pathname, searchParams } = new URL(url);
	return [
		username,
		password,
		...hostname.split("."),
		...pathname.split("/"),
		...searchParams.values(),
	].filter((part) => part.length >= SECRET_LENGTH);
}
