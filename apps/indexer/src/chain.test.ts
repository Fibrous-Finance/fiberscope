import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";

import { hexBlock } from "./abi.ts";
import { getLogs, parseSettlementLogs, SETTLEMENT, statedLogRange, TOPIC } from "./chain.ts";
import { Rpc } from "./rpc.ts";

const TX = "0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63";
/** The first block of BNB Chain's catch-up after the outage on 15 Oct. */
const FROM = 127_794_559;

/** A block range an eth_getLogs request asked for. */
interface Asked {
	from: number;
	to: number;
}

/** An answer of the fake endpoint to an eth_getLogs request; logs when it has no error. */
interface Answer {
	status?: number;
	error?: { code: number; message: string };
}

/**
 * A JSON-RPC endpoint on localhost that answers eth_getLogs request `n` (from 0) as `answer` says:
 * with an error, or else with one log, in the first block of the range asked for. Returns a client
 * of it and the ranges of every request it got.
 */
async function endpoint(
	t: TestContext,
	answer: (asked: Asked, n: number) => Answer
): Promise<{ rpc: Rpc; requests: Asked[] }> {
	const requests: Asked[] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		const [{ id, params }] = JSON.parse(body) as {
			id: number;
			params: [{ fromBlock: string; toBlock: string }];
		}[];
		const asked = { from: Number(params[0].fromBlock), to: Number(params[0].toBlock) };
		const { status = 200, error } = answer(asked, requests.length);
		requests.push(asked);
		const reply = error
			? { jsonrpc: "2.0", id, error }
			: { jsonrpc: "2.0", id, result: [{ blockNumber: hexBlock(asked.from) }] };
		response.writeHead(status, { "content-type": "application/json" });
		response.end(JSON.stringify([reply]));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.close();
		server.closeAllConnections();
	});
	const { port } = server.address() as AddressInfo;
	return { rpc: new Rpc(`http://127.0.0.1:${port}`, 1_000), requests };
}

/** The Settlement events of the blocks from `from` to `to`, through `rpc`. */
function settlementLogs(rpc: Rpc, from: number, to: number) {
	return getLogs(rpc, from, to, [SETTLEMENT], [[TOPIC.settlement]]);
}

/** Consecutive ranges of `width` blocks from `from` to `to`. */
function ranges(from: number, to: number, width: number): Asked[] {
	const out: Asked[] = [];
	for (let start = from; start <= to; start += width) {
		out.push({ from: start, to: Math.min(to, start + width - 1) });
	}
	return out;
}

describe("settlement logs", () => {
	test("a trade carries the uid of the order it filled", () => {
		// Block 52,559,741 on Base: one trade, which CoW's trades API lists under this uid.
		const { trades } = parseSettlementLogs([
			{
				address: SETTLEMENT,
				topics: [
					TOPIC.trade,
					"0x000000000000000000000000256534d1b3042a4906696e27868c7b4905628921",
				],
				data:
					"0x000000000000000000000000acfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf" +
					"000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" +
					"000000000000000000000000000000000000000000000000127a018254b9b06c" +
					"0000000000000000000000000000000000000000000000000000000001b82098" +
					"0000000000000000000000000000000000000000000000000000000000000000" +
					"00000000000000000000000000000000000000000000000000000000000000c0" +
					"0000000000000000000000000000000000000000000000000000000000000038" +
					"f4eda79948847ba58b0a6c5e54def1c92b5082ded993d9ec1803eefdafb3fe43" +
					"256534d1b3042a4906696e27868c7b49056289216ace65b60000000000000000",
				blockNumber: "0x321ff7d",
				transactionHash: TX,
				logIndex: "0x138",
			},
			{
				address: SETTLEMENT,
				topics: [
					TOPIC.settlement,
					"0x0000000000000000000000004c7bdd2d75050c4fdb84ad47dd328dc5c07d7743",
				],
				data: "0x",
				blockNumber: "0x321ff7d",
				transactionHash: TX,
				logIndex: "0x13f",
			},
		]);
		assert.equal(trades.length, 1);
		assert.equal(
			trades[0].orderUid,
			"0xf4eda79948847ba58b0a6c5e54def1c92b5082ded993d9ec1803eefdafb3fe43" +
				"256534d1b3042a4906696e27868c7b49056289216ace65b6"
		);
		assert.equal(trades[0].sellAmount, "1331378299120234604");
	});
});

describe("log ranges", () => {
	test("reads the widest range a refusal states, in the providers' words", () => {
		const cases: [message: string, blocks: number | null][] = [
			[
				"Log response size exceeded. Maximum allowed number of requested blocks is 1000",
				1_000,
			],
			["exceed maximum block range 5000", 5_000],
			["query exceeds max block range 1000", 1_000],
			["ranges over 10000 blocks are not supported on freetier", 10_000],
			["eth_getLogs is limited to a 10,000 range", 10_000],
			[
				"Log response size exceeded. You can make eth_getLogs requests with up to a 2K block " +
					"range and no limit on the response size, or you can request any block range with " +
					"a cap of 10K logs in the response.",
				2_000,
			],
			["5000 blocks requested, 1000 blocks allowed", 1_000],
			// No range: a limit on the logs, or on blocks without its number.
			["logs count exceeds the limit 50000", null],
			[
				"query returned more than 10000 results. Try with this block range [0x7a1200, 0x7a12ff].",
				null,
			],
			["Block range limit exceeded", null],
		];
		for (const [message, blocks] of cases)
			assert.equal(statedLogRange(message), blocks, message);
	});

	test("asks for the widest range a refusal states, for the rest of the process", async (t) => {
		// Keyless thirdweb's refusal on 15 Oct.
		const { rpc, requests } = await endpoint(t, ({ from, to }) =>
			to - from + 1 > 1_000
				? {
						error: {
							code: -32005,
							message:
								"Log response size exceeded. Maximum allowed number of requested " +
								"blocks is 1000",
						},
					}
				: {}
		);
		const logs = await settlementLogs(rpc, FROM, FROM + 4_999);
		assert.deepEqual(
			logs.map((entry) => Number(entry.blockNumber)),
			ranges(FROM, FROM + 4_999, 1_000).map(({ from }) => from)
		);
		assert.deepEqual(requests, [
			{ from: FROM, to: FROM + 4_999 },
			...ranges(FROM, FROM + 4_999, 1_000),
		]);
		assert.equal(rpc.logRange, 1_000);
		// The next range asks for no more from the start.
		await settlementLogs(rpc, FROM + 5_000, FROM + 9_999);
		assert.deepEqual(requests.slice(6), ranges(FROM + 5_000, FROM + 9_999, 1_000));
	});

	test("halves a range on a refusal that states none, and keeps the width that works", async (t) => {
		const { rpc, requests } = await endpoint(t, ({ from, to }) =>
			to - from + 1 > 600
				? { error: { code: -32000, message: "Block range limit exceeded" } }
				: {}
		);
		await settlementLogs(rpc, FROM, FROM + 1_999);
		assert.deepEqual(requests, [
			{ from: FROM, to: FROM + 1_999 },
			{ from: FROM, to: FROM + 999 },
			...ranges(FROM, FROM + 1_999, 500),
		]);
		assert.equal(rpc.logRange, 500);
	});

	test("halves a range refused for its logs or for another reason, for that range only", async (t) => {
		const refusals = [
			// NodeReal's limit on the logs of one request.
			{ code: -32005, message: "logs count exceeds the limit 50000" },
			// Keyless thirdweb's refusal, of a busy range within the limit it states.
			{
				code: -32005,
				message:
					"Log response size exceeded. Maximum allowed number of requested blocks is 1000",
			},
			// A refusal that tells nothing of ranges.
			{ code: -32001, message: "Resource not found" },
		];
		for (const error of refusals) {
			const { rpc, requests } = await endpoint(t, (_, n) => (n === 0 ? { error } : {}));
			await settlementLogs(rpc, FROM, FROM + 999);
			assert.deepEqual(requests, [
				{ from: FROM, to: FROM + 999 },
				...ranges(FROM, FROM + 999, 500),
			]);
			assert.equal(rpc.logRange, null, error.message);
			// The next range asks for its whole width again.
			await settlementLogs(rpc, FROM + 1_000, FROM + 1_999);
			assert.deepEqual(requests.slice(3), [{ from: FROM + 1_000, to: FROM + 1_999 }]);
		}
	});

	test("learns no narrower than 100 blocks from a refusal that states no limit", async (t) => {
		// Halving finds that 75 blocks work, a width that might owe as much to the logs of the
		// range as to the endpoint's limit.
		const { rpc, requests } = await endpoint(t, ({ from, to }) =>
			to - from + 1 > 75
				? { error: { code: -32000, message: "Block range limit exceeded" } }
				: {}
		);
		await settlementLogs(rpc, FROM, FROM + 299);
		assert.deepEqual(requests, [
			{ from: FROM, to: FROM + 299 },
			{ from: FROM, to: FROM + 149 },
			...ranges(FROM, FROM + 299, 75),
		]);
		assert.equal(rpc.logRange, 100);
	});

	test("halves a range that keeps timing out, for that range only", async (t) => {
		// NodeReal answers a request that runs past 30 seconds with a timeout.
		const { rpc, requests } = await endpoint(t, ({ from, to }) =>
			to - from + 1 > 1_000 ? { error: { code: -32000, message: "timeout" } } : {}
		);
		await settlementLogs(rpc, FROM, FROM + 1_999);
		assert.deepEqual(requests, [
			{ from: FROM, to: FROM + 1_999 },
			{ from: FROM, to: FROM + 1_999 },
			...ranges(FROM, FROM + 1_999, 1_000),
		]);
		assert.equal(rpc.logRange, null);
	});

	test("asks for the same range again after a rate limit or a lagging node", async (t) => {
		const { rpc, requests } = await endpoint(t, (_, n) => {
			if (n === 0) {
				const message =
					"Your account has exceeded its Compute Units Per Second capacity. Please check " +
					"out https://docs.nodereal.io/docs/cups-rate-limit and upgrade to Growth, Team " +
					"or Business tier for higher rate limit.";
				return { error: { code: -32005, message } };
			}
			if (n === 1) {
				// A node behind the safe block that another one gave.
				return {
					error: {
						code: -32602,
						message: "block range extends beyond current head block",
					},
				};
			}
			return {};
		});
		await settlementLogs(rpc, FROM, FROM + 1_399);
		const range = { from: FROM, to: FROM + 1_399 };
		assert.deepEqual(requests, [range, range, range]);
		assert.equal(rpc.logRange, null);
	});

	test("fails at once, without splitting, when the endpoint refuses access", async (t) => {
		// Chainstack's answer to the dead key on 15 Oct.
		const { rpc, requests } = await endpoint(t, () => ({
			status: 401,
			error: { code: -32000, message: "Access token missing or invalid" },
		}));
		await assert.rejects(settlementLogs(rpc, FROM, FROM + 1_399), {
			name: "EndpointError",
			message:
				"eth_getLogs: the RPC endpoint refuses access " +
				"(HTTP 401 Unauthorized: -32000 Access token missing or invalid)",
		});
		assert.equal(requests.length, 1);
	});
});
