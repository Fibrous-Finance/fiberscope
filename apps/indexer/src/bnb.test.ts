import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { BNB } from "@fiberscope/core";

import type { Rpc } from "./rpc.ts";

// The indexer as BNB Chain's. config.ts reads NETWORK when it loads, and static imports would load
// before NETWORK is set here; each test file runs in a process of its own.
process.env.NETWORK = "bnb";
const { DEFAULT_DB_PATH, NATIVE_TOKEN, readEnv } = await import("./config.ts");
const { TradeValuer } = await import("./facts.ts");
const { Store } = await import("./store.ts");
const { resolveSymbols } = await import("./symbols.ts");

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const SOLVER = "0x5050505050505050505050505050505050505050";
const TX = `0x${"e".repeat(64)}`;

describe("BNB Chain", () => {
	test("reads its RPC from BNB_RPC_URL and BNB_RPC_RPS, and has a database of its own", () => {
		const env = readEnv({ BNB_RPC_URL: "https://bnb.example", BNB_RPC_RPS: "50" });
		assert.equal(env.rpcUrl, "https://bnb.example");
		assert.equal(env.rpcRps, 50);
		assert.throws(() => readEnv({ BASE_RPC_URL: "https://base.example" }), /BNB_RPC_URL/);
		assert.ok(DEFAULT_DB_PATH.endsWith(join(".data", "bnb.db")));
	});

	test("prices a buy of BNB as WBNB, at the BNB/USD rate, and names it BNB", async () => {
		const store = new Store(":memory:");
		const range = { from: 100, to: 199 };
		// 600 USDT (18 decimals on BNB Chain) sold for 1 BNB, with BNB at $600.
		store.commitChunk(
			{
				range,
				settlements: [
					{ tx: TX, logIndex: 2, block: 100, solver: SOLVER, trades: 1, swaps: 1 },
				],
				trades: [
					{
						tx: TX,
						logIndex: 1,
						block: 100,
						settlementLogIndex: 2,
						sellToken: USDT,
						buyToken: NATIVE_TOKEN,
						sellAmount: "600000000000000000000",
						buyAmount: "1000000000000000000",
						orderUid: `${TX}${"0".repeat(48)}`,
					},
				],
				txs: [
					{
						tx: TX,
						block: 100,
						sender: SOLVER,
						recipient: BNB.contracts.settlement,
						gasUsed: 400_000,
						fee: "22000000000000",
					},
				],
				prices: [{ block: 100, answer: 600e8 }],
				anchors: [{ block: 100, time: 1_790_000_000 }],
			},
			range
		);
		// CoW's native prices on BNB Chain are in BNB: WBNB is 1e18, a USDT atom a 600th of that.
		store.saveCompetition(
			{ auctionId: 1, startBlock: 95, txHashes: [TX], prices: new Map(), solutions: [] },
			[
				[BNB.native.wrapped, "1000000000000000000"],
				[USDT, "1666666666666667"],
			],
			[{ tx: TX, priced: true }],
			0
		);
		const [trade] = store.tradeRows(range);
		const { usd, pricedSides } = new TradeValuer(store).value(trade);
		assert.equal(pricedSides, 2);
		assert.ok(Math.abs(usd! - 600) < 1e-6);

		const rpc = { batch: () => assert.fail("no symbol to look up") } as unknown as Rpc;
		const symbols = await resolveSymbols(rpc, store, [NATIVE_TOKEN]);
		assert.equal(symbols.get(NATIVE_TOKEN), "BNB");
	});

	test("refuses Base's database without touching it", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "base.db");
		// A version 3 database, which only the Base indexer wrote.
		const base = new DatabaseSync(path);
		base.exec(`
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
			CREATE TABLE settlements (block INTEGER NOT NULL, log_index INTEGER NOT NULL,
				PRIMARY KEY (block, log_index)) WITHOUT ROWID;
			CREATE TABLE eth_usd (block INTEGER PRIMARY KEY, answer INTEGER NOT NULL);
			PRAGMA user_version = 3;
		`);
		base.close();
		assert.throws(
			() => new Store(path),
			/is a Base database; this indexer covers BNB Chain \(NETWORK=bnb\)/
		);
		const after = new DatabaseSync(path, { readOnly: true });
		assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 3);
		assert.equal(
			after.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'anchors'").get(),
			undefined
		);
		after.close();
	});

	test("records its chain id in a new database", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "bnb.db");
		new Store(path).close();
		const db = new DatabaseSync(path, { readOnly: true });
		assert.equal(
			db.prepare("SELECT value FROM meta WHERE key = 'chain_id'").get()?.value,
			"56"
		);
		db.close();
	});
});
