import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NETWORK } from "./config.ts";
import type { Competition, ExecutedFee, OrderDetail, OrderTrade } from "./cow.ts";
import {
	backfillDetails,
	catchUpDetails,
	detailCatchUpRequests,
	processDetailRange,
	withPartners,
} from "./details.ts";
import type { DetailSource, DetailStats } from "./details.ts";
import type { BlockRange } from "./rules.ts";
import { Store } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const SOLVER = "0x5050505050505050505050505050505050505050";
const QUOTER = "0x6060606060606060606060606060606060606060";
/** Now in Unix seconds, and the block taken to be the head then. */
const NOW = Math.floor(Date.now() / 1000);
const HEAD = 10_000_000;

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
}

/** An order uid spelled from a readable label. */
function uid(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(112, "0")}`;
}

/**
 * Commits one-trade batches, each filling the order of its label, as the chain data of `range`,
 * whose blocks come every 2 seconds up to HEAD at NOW.
 */
function ingest(store: Store, range: BlockRange, settled: { label: string; block: number }[]) {
	const current = store.chainRange();
	store.commitChunk(
		{
			range,
			settlements: settled.map(({ label, block }) => ({
				tx: hash(label),
				logIndex: 2,
				block,
				solver: SOLVER,
				trades: 1,
				swaps: 1,
			})),
			trades: settled.map(({ label, block }) => ({
				tx: hash(label),
				logIndex: 1,
				block,
				settlementLogIndex: 2,
				sellToken: USDC,
				buyToken: WETH,
				sellAmount: "1000000000",
				buyAmount: "500000000000000000",
				orderUid: uid(label),
			})),
			txs: settled.map(({ label, block }) => ({
				tx: hash(label),
				block,
				sender: SOLVER,
				recipient: NETWORK.contracts.settlement,
				gasUsed: 500_000,
				fee: "500001",
			})),
			prices: [{ block: range.from, answer: 2_000e8 }],
			anchors: [range.from, range.to].map((block) => ({
				block,
				time: NOW - 2 * (HEAD - block),
			})),
		},
		{
			from: Math.min(current?.from ?? range.from, range.from),
			to: Math.max(current?.to ?? range.to, range.to),
		}
	);
	store.setAuctionRange(store.chainRange()!);
}

function competition(auctionId: number, startBlock: number, labels: string[]): Competition {
	return {
		auctionId,
		startBlock,
		txHashes: labels.map(hash),
		prices: new Map([
			[WETH, "1000000000000000000"],
			[USDC, "500000000000000000000000000"],
		]),
		solutions: [
			...labels.map((label, i) => ({
				solver: SOLVER,
				ranking: i + 1,
				winner: true,
				tx: hash(label),
				score: String(2_000 - i),
				referenceScore: "1500",
				filteredOut: false,
			})),
			{
				solver: QUOTER,
				ranking: labels.length + 1,
				winner: false,
				tx: null,
				score: "900",
				referenceScore: null,
				filteredOut: true,
			},
		],
	};
}

/** Stores a competition the way the previous schema did: its solutions without scores. */
function saveUnscored(store: Store, auction: Competition): void {
	store.saveCompetition(
		auction,
		[...auction.prices],
		auction.txHashes.map((tx) => ({ tx, priced: true })),
		0
	);
	store.db.prepare("UPDATE auctions SET scored = 0 WHERE id = ?").run(auction.auctionId);
	store.db
		.prepare(
			"UPDATE solutions SET score = NULL, reference_score = NULL, filtered_out = NULL WHERE auction_id = ?"
		)
		.run(auction.auctionId);
}

function fee(policy: ExecutedFee["policy"], amount: string): ExecutedFee {
	return {
		policy,
		factor: 0.001,
		maxVolumeFactor: policy === "volume" ? null : 0.01,
		amount,
		token: WETH,
	};
}

/** Answers like the API and records what it was asked. */
function fakeApi(
	competitions: Competition[],
	orders: Map<string, OrderDetail>,
	trades: Map<string, OrderTrade[]>
): DetailSource & { askedTrades: string[]; askedOrders: string[] } {
	const askedTrades: string[] = [];
	const askedOrders: string[] = [];
	return {
		askedTrades,
		askedOrders,
		async competition(id) {
			return competitions.find((c) => c.auctionId === id) ?? null;
		},
		async orders(uids) {
			askedOrders.push(...uids);
			return new Map(uids.flatMap((u) => (orders.has(u) ? [[u, orders.get(u)!]] : [])));
		},
		async trades(orderUid) {
			askedTrades.push(orderUid);
			return trades.get(orderUid) ?? [];
		},
	};
}

function order(partnerFees: OrderDetail["partnerFees"]): OrderDetail {
	return {
		kind: "sell",
		appClass: "market",
		partnerFees,
		quote: {
			solver: QUOTER,
			verified: true,
			sellAmount: "1000000000",
			buyAmount: "499000000000000000",
			feeAmount: "1000",
		},
	};
}

function stats(): DetailStats {
	return { scores: 0, orders: 0, fees: 0, seconds: 0 };
}

/** The fee rows of the trade in `block`, as [partner, amount] pairs in their stored order. */
function feesAt(store: Store, block: number): [number | null, string][] {
	return (
		store.db
			.prepare(
				"SELECT partner, amount FROM trade_fees WHERE block = ? AND log_index = 1 ORDER BY position"
			)
			.all(block) as { partner: number | null; amount: string }[]
	).map((row) => [row.partner, row.amount]);
}

function feesChecked(store: Store, block: number): number | null {
	const row = store.db
		.prepare("SELECT fees_checked AS checked FROM trades WHERE block = ? AND log_index = 1")
		.get(block) as { checked: number | null };
	return row.checked;
}

describe("partner fees", () => {
	test("are the last fees, one per partner fee of the order's app data", () => {
		const fees = [fee("priceImprovement", "0"), fee("volume", "5775"), fee("volume", "28873")];
		assert.deepEqual(
			withPartners(fees, ["volume"]).map((f) => f.partner),
			[false, false, true]
		);
		assert.deepEqual(
			withPartners(fees, []).map((f) => f.partner),
			[false, false, false]
		);
	});

	test("are unclear when the last fees do not match the app data", () => {
		const fees = [fee("priceImprovement", "0"), fee("volume", "5775")];
		assert.deepEqual(
			withPartners(fees, ["surplus"]).map((f) => f.partner),
			[null, null]
		);
		assert.deepEqual(
			withPartners([fee("volume", "1")], ["volume", "volume"]).map((f) => f.partner),
			[null]
		);
	});
});

describe("detail lookups", () => {
	test("score auctions, look up orders, and store each trade's fees", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 199 }, [
			{ label: "partnered", block: 100 },
			{ label: "plain", block: 120 },
			{ label: "jit", block: 150 },
		]);
		const auction = competition(1, 100, ["partnered", "plain", "jit"]);
		saveUnscored(store, auction);
		const api = fakeApi(
			[auction],
			new Map([
				[uid("partnered"), order(["volume"])],
				[uid("plain"), order([])],
			]),
			new Map([
				[
					uid("partnered"),
					[
						{
							block: 100,
							logIndex: 1,
							fees: [
								fee("priceImprovement", "0"),
								fee("volume", "5775"),
								fee("volume", "28873"),
							],
						},
					],
				],
				[uid("plain"), [{ block: 120, logIndex: 1, fees: [fee("surplus", "7")] }]],
			])
		);

		assert.equal(await processDetailRange(store, api, { from: 100, to: 199 }, stats()), true);

		assert.deepEqual(
			[...store.solutionsByStart({ from: 100, to: 199 })].map((row) => row.filteredOut),
			[0, 0, 0, 1]
		);
		assert.deepEqual(store.unscoredAuctions({ from: 100, to: 199 }), []);
		assert.deepEqual(feesAt(store, 100), [
			[0, "0"],
			[0, "5775"],
			[1, "28873"],
		]);
		assert.deepEqual(feesAt(store, 120), [[0, "7"]]);
		// The just-in-time order is not in the order book, so its trade has no fees to look up.
		assert.equal(feesChecked(store, 150), 0);
		assert.deepEqual(api.askedTrades, [uid("plain"), uid("partnered")]);
		const details = [...store.tradeDetails({ from: 100, to: 199 })];
		assert.deepEqual(
			details.map((row) => [row.found, row.quoteSolver]),
			[
				[1, QUOTER],
				[1, QUOTER],
				[0, null],
			]
		);

		// Nothing is left to look up.
		await processDetailRange(store, api, { from: 100, to: 199 }, stats());
		assert.equal(api.askedTrades.length, 2);
		assert.equal(api.askedOrders.length, 3);
	});

	test("a trade the API does not list yet is looked up again only while it is recent", async () => {
		const store = new Store(":memory:");
		// 1,000 blocks are 2,000 seconds: past the finality window. 10 blocks are within it.
		const range = { from: HEAD - 1_000, to: HEAD };
		ingest(store, range, [
			{ label: "old", block: HEAD - 1_000 },
			{ label: "new", block: HEAD - 10 },
		]);
		const api = fakeApi(
			[],
			new Map([
				[uid("old"), order([])],
				[uid("new"), order([])],
			]),
			new Map()
		);
		await processDetailRange(store, api, range, stats());
		await processDetailRange(store, api, range, stats());
		assert.equal(feesChecked(store, HEAD - 1_000), 0);
		assert.equal(feesChecked(store, HEAD - 10), null);
		assert.deepEqual(api.askedTrades, [uid("new"), uid("old"), uid("new")]);
	});

	test("a range with trades still without an order uid gets only its scores", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 199 }, [{ label: "a", block: 100 }]);
		store.db.exec("UPDATE trades SET order_uid = NULL");
		const auction = competition(1, 100, ["a"]);
		saveUnscored(store, auction);
		const api = fakeApi([auction], new Map([[uid("a"), order([])]]), new Map());
		assert.equal(await processDetailRange(store, api, { from: 100, to: 199 }, stats()), false);
		assert.deepEqual(store.unscoredAuctions({ from: 100, to: 199 }), []);
		assert.deepEqual(api.askedOrders, []);
	});
});

describe("detail catch-up", () => {
	test("counts ahead the requests it makes", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 4_199 }, [
			{ label: "checked", block: 1_500 },
			{ label: "unlisted", block: 1_800 },
			{ label: "new", block: 2_500 },
			{ label: "newer", block: 3_000 },
		]);
		// The details reach block 1,999. The catch-up starts 300 blocks (10 minutes) lower, to look
		// again for the fees of the trade the API did not list yet; the trade below it is done.
		store.setDetailRange({ from: 100, to: 1_999 });
		store.saveOrders([
			{ uid: uid("checked"), block: 1_500, detail: order([]) },
			{ uid: uid("unlisted"), block: 1_800, detail: order([]) },
		]);
		store.saveTradeFees(uid("checked"), [{ block: 1_500, logIndex: 1, fees: [] }]);
		const auction = competition(1, 2_600, ["new"]);
		saveUnscored(store, auction);
		const blocks = { unlisted: 1_800, new: 2_500, newer: 3_000 };
		const api = fakeApi(
			[auction],
			new Map(Object.keys(blocks).map((label) => [uid(label), order([])])),
			new Map(
				Object.entries(blocks).map(([label, block]) => [
					uid(label),
					[{ block, logIndex: 1, fees: [fee("volume", "1")] }],
				])
			)
		);
		let requests = 0;
		const counting: DetailSource = {
			async competition(id) {
				requests++;
				return api.competition(id);
			},
			async orders(uids) {
				requests++;
				return api.orders(uids);
			},
			async trades(orderUid) {
				requests++;
				return api.trades(orderUid);
			},
		};

		// One auction to score, one request for the two new orders and one for each of their
		// trades, and one for the trades of the order whose fees were not listed.
		assert.equal(detailCatchUpRequests(store), 5);
		await catchUpDetails(store, counting, stats());
		assert.equal(requests, 5);
		assert.deepEqual(store.detailRange(), { from: 100, to: 4_199 });
		assert.equal(detailCatchUpRequests(store), 0);
	});
});

describe("detail backfill", () => {
	test("a stopped backfill keeps only whole block ranges and resumes below them", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 4_199 }, [
			{ label: "d", block: 150 },
			{ label: "c", block: 1_000 },
			{ label: "b", block: 1_500 },
			{ label: "a", block: 3_000 },
		]);
		const blocks = { a: 3_000, b: 1_500, c: 1_000, d: 150 };
		const api = fakeApi(
			[],
			new Map(Object.keys(blocks).map((label) => [uid(label), order([])])),
			new Map(
				Object.entries(blocks).map(([label, block]) => [
					uid(label),
					[{ block, logIndex: 1, fees: [fee("volume", "1")] }],
				])
			)
		);
		const stop = new AbortController();
		const stopping: DetailSource = {
			...api,
			async trades(orderUid) {
				if (orderUid === uid("b")) stop.abort();
				return api.trades(orderUid);
			},
		};
		const watch = { auctionsDone: true, uidsDone: true };
		await backfillDetails(store, stopping, 100, watch, stats(), stop.signal);
		assert.deepEqual(store.detailRange(), { from: 2_200, to: 4_199 });

		await backfillDetails(store, api, 100, watch, stats(), new AbortController().signal);
		assert.deepEqual(store.detailRange(), { from: 100, to: 4_199 });
		assert.equal(feesChecked(store, 150), 1);
	});
});
