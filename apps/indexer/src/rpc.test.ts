import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";

import { classify, Rpc, RpcError, RpcTimeout } from "./rpc.ts";
import type { Verdict } from "./rpc.ts";

/** The key in the fake endpoint's URL, as a provider's URL holds one; no message may show it. */
const KEY = "0123456789abcdef0123456789abcdef";
/** NodeReal's answer to a request over the plan's compute units per second. */
const CUPS =
	"Your account has exceeded its Compute Units Per Second capacity. Please check out " +
	"https://docs.nodereal.io/docs/cups-rate-limit and upgrade to Growth, Team or Business " +
	"tier for higher rate limit.";

interface Call {
	id: number;
	method: string;
	params: unknown[];
}

/** An HTTP response of the fake endpoint; `body` is sent as JSON unless it is a string. */
interface Answer {
	status?: number;
	headers?: Record<string, string>;
	body: unknown;
}

/**
 * A JSON-RPC endpoint on localhost that answers request `n` (from 0), with the calls it carries,
 * as `answer` says. Returns a client of it and the calls of every request it got.
 */
async function endpoint(
	t: TestContext,
	answer: (calls: Call[], n: number) => Answer
): Promise<{ rpc: Rpc; requests: Call[][] }> {
	const requests: Call[][] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		const calls = JSON.parse(body) as Call[];
		const { status = 200, headers = {}, body: reply } = answer(calls, requests.length);
		requests.push(calls);
		response.writeHead(status, { "content-type": "application/json", ...headers });
		response.end(typeof reply === "string" ? reply : JSON.stringify(reply));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.close();
		server.closeAllConnections();
	});
	const { port } = server.address() as AddressInfo;
	return { rpc: new Rpc(`http://127.0.0.1:${port}/v1/${KEY}`, 1_000), requests };
}

/** A reply to each call with its result. */
function results(calls: Call[], result: (call: Call) => unknown): Answer {
	return { body: calls.map((call) => ({ jsonrpc: "2.0", id: call.id, result: result(call) })) };
}

/** The same error for each call, in a response with the given HTTP status. */
function errors(calls: Call[], code: number, message: string, status = 200): Answer {
	return {
		status,
		body: calls.map((call) => ({ jsonrpc: "2.0", id: call.id, error: { code, message } })),
	};
}

/**
 * The lines `log` writes while `run` runs, without their time of day. Anything else written to
 * stdout, such as the test runner's own output, goes through.
 */
async function logged(t: TestContext, run: () => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const write = process.stdout.write;
	const mocked = t.mock.method(process.stdout, "write", (chunk: unknown, ...rest: unknown[]) => {
		const line = typeof chunk === "string" ? /^\d\d:\d\d:\d\d (.*)\n$/s.exec(chunk) : null;
		if (line === null) return Reflect.apply(write, process.stdout, [chunk, ...rest]);
		lines.push(line[1]);
		return true;
	});
	try {
		await run();
	} finally {
		mocked.mock.restore();
	}
	return lines;
}

describe("RPC failures", () => {
	test("tells what to do from the provider's message and the HTTP status", () => {
		type Case = [code: number | undefined, message: string, status: number, verdict: Verdict];
		const cases: Case[] = [
			// NodeReal, BNB Chain's RPC: its rate limit, also in its first sentence alone, and its
			// per-method limit, which BNB Chain's public nodes answer too.
			[-32005, CUPS, 200, "rate"],
			[
				-32005,
				"Your account has exceeded its Compute Units Per Second capacity.",
				200,
				"rate",
			],
			[-32005, "limit exceeded", 200, "rate"],
			[-32005, "method eth_getLogs in batch triggered rate limit", 200, "rate"],
			// Keyless thirdweb's HTTP 429, and Cloudflare's rate limit, which comes as HTTP 403.
			[undefined, "Too Many Requests", 429, "rate"],
			[undefined, "error code: 1015 You are being rate limited", 403, "rate"],
			// NodeReal's spent monthly quota comes as HTTP 429 too.
			[-32005, "ran out of cu", 429, "quota"],
			[undefined, "Payment Required", 402, "quota"],
			// A dead key (Chainstack's HTTP 401 on 15 Oct), NodeReal's invalid key and IP
			// allow-list, publicnode's archive calls without a token.
			[undefined, "Access token missing or invalid", 401, "auth"],
			[-32000, "Unauthorized", 200, "auth"],
			[-32002, "IP address 3.120.0.1 is not on whitelist", 200, "auth"],
			[-32602, "Archive requests require a personal token. Get one at: <url>", 403, "auth"],
			// A node behind the safe block the indexer read from another one.
			[-32602, "block range extends beyond current head block", 200, "lag"],
			[-32000, "header not found", 200, "lag"],
			// NodeReal's 30-second limit, and a gateway's.
			[-32000, "timeout", 200, "timeout"],
			[undefined, "Gateway Timeout", 504, "timeout"],
			[undefined, "Bad Gateway", 502, "transient"],
			[-32603, "internal error", 200, "transient"],
			// Refusals of a log range: thirdweb's, BSC's, reth's, NodeReal's and Infura's.
			[
				-32005,
				"Log response size exceeded. Maximum allowed number of requested blocks is 1000",
				200,
				"final",
			],
			[-32602, "exceed maximum block range 5000", 200, "final"],
			[-32602, "query exceeds max block range 1000", 200, "final"],
			[-32005, "logs count exceeds the limit 50000", 200, "final"],
			[
				-32005,
				"query returned more than 10000 results. Try with this block range [0x7a1200, 0x7a12ff].",
				200,
				"final",
			],
			[3, "execution reverted", 200, "final"],
			[-32602, "invalid argument 0: hex string has length 41, want 40", 200, "final"],
		];
		for (const [code, message, status, verdict] of cases) {
			assert.equal(classify(code, message, status), verdict, message);
		}
	});

	test("waits out a rate limit, asks again and logs why, without the URL", async (t) => {
		const { rpc, requests } = await endpoint(t, (calls, n) =>
			n === 0 ? errors(calls, -32005, CUPS) : results(calls, () => "0x1")
		);
		const started = performance.now();
		const lines = await logged(t, async () => {
			assert.equal(await rpc.call("eth_blockNumber", []), "0x1");
		});
		assert.equal(requests.length, 2);
		// The second after a rate limit that the pacer pauses for.
		assert.ok(performance.now() - started >= 990);
		assert.equal(rpc.stats.retries, 1);
		assert.deepEqual(lines, [
			"rpc: retrying eth_blockNumber in 1.0s (attempt 2 of 12): -32005 Your account has " +
				"exceeded its Compute Units Per Second capacity. Please check out <url> and upgrade " +
				"to Growth, Team or Business tier for higher rate limit.",
		]);
	});

	test("fails at once, with the reason and without the key, when access is refused", async (t) => {
		const refusals: [(calls: Call[]) => Answer, string][] = [
			[
				() => ({ status: 401, body: "Access token missing or invalid" }),
				"eth_blockNumber: the RPC endpoint refuses access " +
					"(HTTP 401 Unauthorized: Access token missing or invalid)",
			],
			[
				(calls) => errors(calls, -32000, "Unauthorized"),
				"eth_blockNumber: the RPC endpoint refuses access (-32000 Unauthorized)",
			],
			[
				(calls) => errors(calls, -32002, "IP address 3.120.0.1 is not on whitelist"),
				"eth_blockNumber: the RPC endpoint refuses access " +
					"(-32002 IP address 3.120.0.1 is not on whitelist)",
			],
			// An endpoint that echoes the request's URL and its key.
			[
				() => ({ status: 403, body: `<html><h1>Forbidden</h1> /v1/${KEY}</html>` }),
				"eth_blockNumber: the RPC endpoint refuses access " +
					"(HTTP 403 Forbidden: Forbidden /v1/<redacted>)",
			],
		];
		for (const [answer, message] of refusals) {
			const { rpc, requests } = await endpoint(t, answer);
			await assert.rejects(rpc.call("eth_blockNumber", []), {
				name: "EndpointError",
				message,
			});
			assert.equal(requests.length, 1);
		}
	});

	test("fails at once when the quota is spent, though that comes as HTTP 429", async (t) => {
		const { rpc, requests } = await endpoint(t, (calls) => ({
			...errors(calls, -32005, "ran out of cu", 429),
			headers: { "retry-after": "30" },
		}));
		await assert.rejects(rpc.call("eth_getLogs", [{}]), {
			name: "EndpointError",
			message:
				"eth_getLogs: the RPC endpoint has spent its quota " +
				"(HTTP 429 Too Many Requests: -32005 ran out of cu)",
		});
		assert.equal(requests.length, 1);
	});

	test("waits out a Retry-After of up to a minute", async (t) => {
		const { rpc, requests } = await endpoint(t, (calls, n) =>
			n === 0
				? { status: 429, headers: { "retry-after": "1" }, body: "Too Many Requests" }
				: results(calls, () => [])
		);
		const started = performance.now();
		assert.deepEqual(await rpc.call("eth_getLogs", [{}]), []);
		assert.equal(requests.length, 2);
		assert.ok(performance.now() - started >= 990);
	});

	test("fails at once when asked to wait longer", async (t) => {
		// Keyless thirdweb asked for 175 to 300 seconds on every request on 15 Oct.
		const { rpc, requests } = await endpoint(t, () => ({
			status: 429,
			headers: { "retry-after": "300" },
			body: "Too Many Requests",
		}));
		await assert.rejects(rpc.call("eth_getLogs", [{}]), {
			name: "EndpointError",
			message:
				"eth_getLogs: the RPC endpoint asks to wait 300s " +
				"(HTTP 429 Too Many Requests: Too Many Requests)",
		});
		assert.equal(requests.length, 1);
	});

	test("asks again after a lagging node, a timeout or a gateway's error", async (t) => {
		const failures: ((calls: Call[]) => Answer)[] = [
			(calls) => errors(calls, -32602, "block range extends beyond current head block"),
			(calls) => errors(calls, -32000, "timeout"),
			() => ({ status: 502, body: "<html><title>502 Bad Gateway</title></html>" }),
			// A reply without the call's.
			() => ({ body: [] }),
		];
		for (const failure of failures) {
			const { rpc, requests } = await endpoint(t, (calls, n) =>
				n === 0 ? failure(calls) : results(calls, () => "0x1")
			);
			assert.equal(await rpc.call("eth_blockNumber", []), "0x1");
			assert.equal(requests.length, 2);
		}
	});

	test("judges a refusal page by all of its text, and logs only its start", async (t) => {
		// Cloudflare's page for a client it rate-limits: its title says access is denied, and only
		// its text past the 200 characters that a reason keeps says why.
		const page =
			"<!DOCTYPE html><html><head><title>Access denied | rpc.example.org used Cloudflare to " +
			"restrict access</title></head><body><h1>Error 1015</h1><p>Ray ID: 8c1f2e3d4b5a6978 " +
			"&bull; 2026-10-15 15:33:22 UTC</p><p>The owner of this website (rpc.example.org) has " +
			"banned you temporarily from accessing this website.</p><h2>You are being rate " +
			"limited</h2></body></html>";
		const { rpc, requests } = await endpoint(t, (calls, n) =>
			n === 0 ? { status: 403, body: page } : results(calls, () => "0x1")
		);
		const lines = await logged(t, async () => {
			assert.equal(await rpc.call("eth_blockNumber", []), "0x1");
		});
		assert.equal(requests.length, 2);
		assert.deepEqual(lines, [
			"rpc: retrying eth_blockNumber in 1.0s (attempt 2 of 12): HTTP 403 Forbidden: Access " +
				"denied | rpc.example.org used Cloudflare to restrict access Error 1015 Ray ID: " +
				"8c1f2e3d4b5a6978 &bull; 2026-10-15 15:33:22 UTC The owner of this website " +
				"(rpc.example.org) has banned you tempora…",
		]);
	});

	test("fails at once when the endpoint refuses the request itself", async (t) => {
		const { rpc, requests } = await endpoint(t, () => ({ status: 404, body: "Not Found" }));
		await assert.rejects(rpc.call("eth_blockNumber", []), {
			name: "EndpointError",
			message:
				"eth_blockNumber: the RPC endpoint refuses the request (HTTP 404 Not Found: Not Found)",
		});
		assert.equal(requests.length, 1);
	});

	test("gives up on a call that keeps timing out when its caller can ask for less", async (t) => {
		const { rpc, requests } = await endpoint(t, (calls) => errors(calls, -32000, "timeout"));
		await assert.rejects(rpc.call("eth_getLogs", [{}], { timeouts: 2 }), (error) => {
			assert.ok(error instanceof RpcTimeout);
			assert.equal(error.message, "eth_getLogs timed out 2 times: -32000 timeout");
			return true;
		});
		assert.equal(requests.length, 2);
	});

	test("returns a node's refusal of one call in its place, as before", async (t) => {
		const { rpc, requests } = await endpoint(t, (calls) => ({
			body: calls.map(({ id, method }) =>
				method === "eth_call"
					? { jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted" } }
					: { jsonrpc: "2.0", id, result: "0x1" }
			),
		}));
		const outcomes = await rpc.batch([
			{ method: "eth_call", params: [{ to: "0x1", data: "0x" }, "latest"] },
			{ method: "eth_blockNumber", params: [] },
		]);
		assert.deepEqual(outcomes, [
			{ ok: false, error: new RpcError(3, "execution reverted") },
			{ ok: true, result: "0x1" },
		]);
		assert.equal(requests.length, 1);
	});

	test("returns a node's error for the whole batch for each of its calls", async (t) => {
		// NodeReal's answer to a batch of more than 500 calls.
		const { rpc, requests } = await endpoint(t, () => ({
			body: {
				jsonrpc: "2.0",
				id: null,
				error: { code: -32005, message: "batch size exceed limit 500" },
			},
		}));
		const outcomes = await rpc.batch([
			{ method: "eth_blockNumber", params: [] },
			{ method: "eth_chainId", params: [] },
		]);
		const error = new RpcError(-32005, "batch size exceed limit 500");
		assert.deepEqual(outcomes, [
			{ ok: false, error },
			{ ok: false, error },
		]);
		assert.equal(requests.length, 1);
	});

	test("counts calls by method, every call of a batch and every retry", async (t) => {
		// The first reply leaves out a receipt, which is asked for again.
		const { rpc } = await endpoint(t, (calls, n) =>
			results(n === 0 ? calls.slice(1) : calls, () => ({}))
		);
		await rpc.batch([
			{ method: "eth_getTransactionReceipt", params: ["0x1"] },
			{ method: "eth_getTransactionReceipt", params: ["0x2"] },
			{ method: "eth_getTransactionByHash", params: ["0x1"] },
		]);
		assert.deepEqual(rpc.stats, {
			calls: 4,
			retries: 1,
			byMethod: { eth_getTransactionReceipt: 3, eth_getTransactionByHash: 1 },
		});
	});
});
