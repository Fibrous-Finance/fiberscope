import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { ROUTER } from "./chain.ts";
import { TradeValuer } from "./facts.ts";
import { Store } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const SOLVER = "0x5050505050505050505050505050505050505050";
/** When Base's block 0 came; then a block every 2 seconds. */
const BASE_GENESIS = 1_686_789_347;

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
}

/** The blocks of the clock's anchors, in order. */
function anchorBlocks(store: Store): number[] {
	const rows = store.db.prepare("SELECT block FROM anchors ORDER BY block").all();
	return rows.map((row) => Number(row.block));
}

/** One-trade batches by label and block; `router` ones are settled through the flash-loan router. */
function storeWith(batches: { label: string; block: number; router?: boolean }[]): Store {
	const store = new Store(":memory:");
	const range = { from: 1, to: 1_000 };
	store.commitChunk(
		{
			range,
			settlements: batches.map(({ label, block, router }) => ({
				tx: hash(label),
				logIndex: 2,
				block,
				solver: router ? ROUTER : SOLVER,
				trades: 1,
				swaps: 1,
			})),
			trades: batches.map(({ label, block }) => ({
				tx: hash(label),
				logIndex: 1,
				block,
				settlementLogIndex: 2,
				sellToken: USDC,
				buyToken: WETH,
				sellAmount: "1000000000",
				buyAmount: "500000000000000000",
				orderUid: `${hash(label)}${"0".repeat(48)}`,
			})),
			txs: batches.map(({ label, block }) => ({
				tx: hash(label),
				block,
				sender: SOLVER,
				recipient: ROUTER,
				gasUsed: 500_000,
				fee: "500000",
			})),
			prices: [1, 140, 350].map((block) => ({ block, answer: 2_000e8 })),
			anchors: [1, 140, 200, 350, 1_000].map((block) => ({ block, time: 2 * block })),
		},
		range
	);
	store.setAuctionRange(range);
	return store;
}

/** An auction that started at `startBlock` and settled `labels`, with prices for its tokens. */
function settle(store: Store, auctionId: number, startBlock: number, labels: string[]): void {
	store.saveCompetition(
		{
			auctionId,
			startBlock,
			txHashes: labels.map(hash),
			prices: new Map(),
			solutions: labels.map((label, i) => ({
				solver: SOLVER,
				ranking: i + 1,
				winner: true,
				tx: hash(label),
				score: "1000",
				referenceScore: null,
				filteredOut: false,
			})),
		},
		[
			[USDC, "500000000000000000000000000"],
			[WETH, "1000000000000000000"],
		],
		labels.map((label) => ({ tx: hash(label), priced: true })),
		0
	);
}

describe("prune", () => {
	test("drops what lies below the depths, and keeps what later settlements still use", () => {
		const store = storeWith([
			{ label: "a", block: 100 },
			{ label: "r", block: 200, router: true },
			{ label: "b", block: 250 },
			{ label: "d", block: 260 },
			{ label: "c", block: 320 },
		]);
		settle(store, 1, 95, ["a"]);
		settle(store, 2, 195, ["r"]);
		// Started before the auction depth; c, settled after it, still needs its prices.
		settle(store, 3, 245, ["b", "c"]);
		settle(store, 4, 255, ["d"]);

		store.prune(150, 300);

		assert.deepEqual(store.chainRange(), { from: 150, to: 1_000 });
		assert.deepEqual(store.auctionRange(), { from: 300, to: 1_000 });
		assert.deepEqual(
			store.batchTxs({ from: 1, to: 1_000 }).map(({ tx }) => tx),
			["r", "b", "d", "c"].map(hash)
		);
		// The router settlement keeps its auction while it is in the chain data: its attribution
		// may need the auction's winner.
		assert.equal(store.competitionLink(hash("r"))?.auctionId, 2);
		assert.equal(store.apiWinner(hash("r")), SOLVER);
		for (const label of ["a", "b", "d"]) assert.equal(store.competitionLink(hash(label)), null);
		const auctions = [...store.solutionsByStart({ from: 1, to: 1_000 })].map(
			(row) => row.auctionId
		);
		assert.deepEqual([...new Set(auctions)], [2, 3]);
		const [trade] = store.tradeRows({ from: 320, to: 320 });
		assert.equal(new TradeValuer(store.nativeUsdPoints()).value(trade).pricedSides, 2);
		// The answer in force at block 150 stays, and so does the last anchor before it, so block
		// 149 keeps its time.
		assert.deepEqual(
			store.nativeUsdPoints().map(({ block }) => block),
			[140, 350]
		);
		assert.deepEqual(anchorBlocks(store), [140, 200, 350, 1_000]);
		assert.equal(store.timeOf(149), 298);
	});

	test("drops the orders and fees of trades below the auction depth with the detail range", () => {
		const store = storeWith([
			{ label: "a", block: 100 },
			{ label: "b", block: 600 },
		]);
		store.setDetailRange({ from: 1, to: 1_000 });
		store.saveOrders(
			["a", "b"].map((label, i) => ({
				uid: `${hash(label)}${"0".repeat(48)}`,
				block: [100, 600][i],
				detail: { kind: "sell", appClass: null, partnerFees: [], quote: null },
			}))
		);
		for (const [label, block] of [
			["a", 100],
			["b", 600],
		] as const) {
			store.saveTradeFees(`${hash(label)}${"0".repeat(48)}`, [
				{
					block,
					logIndex: 1,
					fees: [
						{
							policy: "volume",
							factor: 0.0002,
							maxVolumeFactor: null,
							partner: false,
							amount: "1",
							token: USDC,
						},
					],
				},
			]);
		}

		store.prune(50, 300);

		assert.deepEqual(store.detailRange(), { from: 300, to: 1_000 });
		const details = [...store.tradeDetails({ from: 1, to: 1_000 })];
		// a's trade stays with the chain data, but its order and fees go, to be looked up again
		// if the auction range ever reaches it.
		assert.deepEqual(
			details.map(({ block, found, feesChecked, fees }) => [block, found, feesChecked, fees]),
			[
				[100, null, null, null],
				[600, 1, 1, `0 1 ${USDC}`],
			]
		);
	});
});

describe("trade rows", () => {
	test("carry the native prices their own auction gave their tokens", () => {
		const store = storeWith([
			{ label: "a", block: 100 },
			{ label: "b", block: 200 },
			{ label: "c", block: 300 },
		]);
		settle(store, 1, 95, ["a"]);
		// b's auction priced USDC only, and c has no competition.
		store.saveCompetition(
			{
				auctionId: 2,
				startBlock: 195,
				txHashes: [hash("b")],
				prices: new Map(),
				solutions: [],
			},
			[[USDC, "400000000000000000000000000"]],
			[{ tx: hash("b"), priced: true }],
			0
		);
		const range = { from: 1, to: 1_000 };
		const prices = (rows: { sellPrice: string | null; buyPrice: string | null }[]) =>
			rows.map(({ sellPrice, buyPrice }) => [sellPrice, buyPrice]);
		const expected = [
			["500000000000000000000000000", "1000000000000000000"],
			["400000000000000000000000000", null],
			[null, null],
		];
		assert.deepEqual(prices([...store.tradeRows(range)]), expected);
		assert.deepEqual(prices([...store.tradeDetails(range)]), expected);
		const valuer = new TradeValuer(store.nativeUsdPoints());
		assert.deepEqual(
			[...store.tradeRows(range)].map((trade) => valuer.value(trade).pricedSides),
			[2, 1, 0]
		);
	});
});

describe("schema", () => {
	test("a version 2 database is upgraded in place, and its trades and auctions are filled in later", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "v2.db");
		const tx = hash("a");
		const v2 = new DatabaseSync(path);
		v2.exec(`
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
			CREATE TABLE addresses (id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE);
			CREATE TABLE settlements (block INTEGER NOT NULL, log_index INTEGER NOT NULL,
				tx BLOB NOT NULL, solver INTEGER NOT NULL, trades INTEGER NOT NULL,
				swaps INTEGER NOT NULL, sender INTEGER, recipient INTEGER, gas_used INTEGER,
				fee INTEGER, tx_batches INTEGER, PRIMARY KEY (block, log_index)) WITHOUT ROWID;
			CREATE TABLE trades (block INTEGER NOT NULL, log_index INTEGER NOT NULL,
				settlement_log_index INTEGER NOT NULL, sell_token INTEGER NOT NULL,
				buy_token INTEGER NOT NULL, sell_amount TEXT NOT NULL, buy_amount TEXT NOT NULL,
				limit_sell_amount TEXT, limit_buy_amount TEXT, fee_amount TEXT,
				PRIMARY KEY (block, log_index)) WITHOUT ROWID;
			CREATE TABLE eth_usd (block INTEGER PRIMARY KEY, answer INTEGER NOT NULL);
			CREATE TABLE auctions (id INTEGER PRIMARY KEY, start_block INTEGER NOT NULL);
			CREATE TABLE solutions (auction_id INTEGER NOT NULL, position INTEGER NOT NULL,
				solver INTEGER NOT NULL, ranking INTEGER NOT NULL, winner INTEGER NOT NULL, tx BLOB,
				PRIMARY KEY (auction_id, position)) WITHOUT ROWID;
			INSERT INTO addresses VALUES (1, '${SOLVER}'), (2, '${USDC}'), (3, '${WETH}');
			INSERT INTO settlements VALUES (500, 2, unhex('${tx.slice(2)}'), 1, 1, 1, 1, NULL,
				400000, 1000, 1);
			INSERT INTO trades VALUES (500, 1, 2, 2, 3, '1000000000', '500000000000000000',
				NULL, NULL, NULL);
			INSERT INTO auctions VALUES (7, 495);
			INSERT INTO solutions VALUES (7, 0, 1, 1, 1, unhex('${tx.slice(2)}'));
			PRAGMA user_version = 2;
		`);
		v2.close();

		const store = new Store(path);
		const [trade] = store.tradeRows({ from: 1, to: 1_000 });
		assert.equal(trade.sellAmount, "1000000000");
		assert.deepEqual(store.uidGap(), { from: 500, to: 500 });
		assert.deepEqual(store.unscoredAuctions({ from: 1, to: 1_000 }), [7]);
		const [solution] = store.solutionsByStart({ from: 1, to: 1_000 });
		assert.equal(solution.filteredOut, null);

		const orderUid = `${tx}${"0".repeat(48)}`;
		store.fillOrderUids({ from: 500, to: 500 }, new Map([["500:1", orderUid]]));
		assert.equal(store.uidGap(), null);
		store.close();
		// Reopened, it is current.
		const reopened = new Store(path);
		assert.equal(reopened.uidGap(), null);
		reopened.close();
	});

	test("a version 3 database is Base's, and its chain range gets Base's block times", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "v3.db");
		const range = { from: 1_000, to: 44_199 };
		const current = new Store(path);
		current.commitChunk(
			{
				range,
				settlements: [],
				trades: [],
				txs: [],
				prices: [{ block: 1_000, answer: 2_000e8 }],
				anchors: [],
			},
			range
		);
		// What version 3 was: no anchors and no chain id, and the prices under their old name.
		current.db.exec(`
			DROP TABLE anchors;
			ALTER TABLE native_usd RENAME TO eth_usd;
			DELETE FROM meta WHERE key = 'chain_id';
			PRAGMA user_version = 3;
		`);
		current.close();

		const store = new Store(path);
		assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 4);
		const chainId = store.db.prepare("SELECT value FROM meta WHERE key = 'chain_id'").get();
		assert.equal(chainId?.value, "8453");
		assert.deepEqual(anchorBlocks(store), [1_000, 44_199]);
		// Exact inside the range and past its end, where the clock goes on 2 seconds a block.
		for (const block of [1_000, 20_001, 44_199, 50_000]) {
			assert.equal(store.timeOf(block), BASE_GENESIS + 2 * block);
		}
		assert.deepEqual(
			store.nativeUsdPoints().map(({ block, answer }) => [block, answer]),
			[[1_000, 2_000e8]]
		);
		store.close();
	});

	test("a database of another network is refused", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "bnb.db");
		const store = new Store(path);
		store.db.exec("UPDATE meta SET value = '56' WHERE key = 'chain_id'");
		store.close();
		assert.throws(() => new Store(path), /is a BNB Chain database; this indexer covers Base/);
	});
});
