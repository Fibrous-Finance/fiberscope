import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { backfillAuctions, processAuctionRange } from "./auctions.ts";
import type { AuctionStats, CompetitionSource } from "./auctions.ts";
import { NATIVE_ETH, NETWORK, WETH } from "./config.ts";
import type { Competition } from "./cow.ts";
import { TradeValuer } from "./facts.ts";
import type { BlockRange } from "./rules.ts";
import { Store } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOLVER = "0x5050505050505050505050505050505050505050";

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
}

interface Settled {
	tx: string;
	block: number;
	buy?: string;
}

/** Commits one-trade batches (1,000 USDC for 0.5 WETH by default) as the chain data of `range`. */
function ingest(store: Store, range: BlockRange, settled: Settled[]): void {
	const current = store.chainRange();
	store.commitChunk(
		{
			range,
			settlements: settled.map(({ tx, block }) => ({
				tx,
				logIndex: 2,
				block,
				solver: SOLVER,
				trades: 1,
				swaps: 1,
			})),
			trades: settled.map(({ tx, block, buy }) => ({
				tx,
				logIndex: 1,
				block,
				settlementLogIndex: 2,
				sellToken: USDC,
				buyToken: buy ?? WETH,
				sellAmount: "1000000000",
				buyAmount: "500000000000000000",
			})),
			txs: settled.map(({ tx, block }) => ({
				tx,
				block,
				sender: SOLVER,
				recipient: NETWORK.contracts.settlement,
				gasUsed: 500_000,
				fee: "500001",
			})),
			prices: [{ block: range.from, answer: 2_000e8 }],
		},
		{
			from: Math.min(current?.from ?? range.from, range.from),
			to: Math.max(current?.to ?? range.to, range.to),
		}
	);
}

function competition(auctionId: number, txHashes: string[]): Competition {
	return {
		auctionId,
		startBlock: 90,
		txHashes,
		prices: new Map([
			[WETH, "1000000000000000000"],
			[USDC, "500000000000000000000000000"],
		]),
		solutions: txHashes.map((tx, i) => ({ solver: SOLVER, ranking: i + 1, winner: true, tx })),
	};
}

/** Answers like the API, a little later, and records every transaction it was asked about. */
function fakeApi(competitions: Competition[]): CompetitionSource & { asked: string[] } {
	const byTx = new Map(competitions.flatMap((c) => c.txHashes.map((tx) => [tx, c] as const)));
	const asked: string[] = [];
	return {
		asked,
		async competitionByTx(tx) {
			asked.push(tx);
			await sleep(5);
			return byTx.get(tx) ?? null;
		},
	};
}

function stats(): AuctionStats {
	return { lookups: 0, missing: 0, seconds: 0 };
}

describe("competition lookups", () => {
	test("a multi-winner auction is looked up once, from its first settlement", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 199 }, [
			{ tx: hash("a"), block: 100 },
			{ tx: hash("b"), block: 101 },
			{ tx: hash("c"), block: 150 },
		]);
		const api = fakeApi([competition(1, [hash("a"), hash("b")]), competition(2, [hash("c")])]);
		await processAuctionRange(store, api, { from: 100, to: 199 }, stats());
		assert.deepEqual(api.asked, [hash("a"), hash("c")]);
		assert.deepEqual(store.competitionLink(hash("b"))?.auctionId, 1);
		const valuer = new TradeValuer(store);
		for (const trade of store.tradeRows({ from: 100, to: 199 })) {
			assert.equal(valuer.value(trade).pricedSides, 2, trade.tx);
		}
	});

	test("a settlement ingested after its auction was fetched is looked up again", async () => {
		const store = new Store(":memory:");
		const api = fakeApi([competition(1, [hash("a"), hash("d")])]);
		ingest(store, { from: 100, to: 199 }, [{ tx: hash("a"), block: 100 }]);
		await processAuctionRange(store, api, { from: 100, to: 199 }, stats());
		assert.equal(store.competitionLink(hash("d"))?.priced, false);

		ingest(store, { from: 200, to: 299 }, [{ tx: hash("d"), block: 200 }]);
		await processAuctionRange(store, api, { from: 100, to: 299 }, stats());
		assert.deepEqual(api.asked, [hash("a"), hash("d")]);
		assert.equal(store.competitionLink(hash("d"))?.priced, true);
	});

	test("a trade buying native ETH is priced with WETH", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 199 }, [{ tx: hash("e"), block: 100, buy: NATIVE_ETH }]);
		await processAuctionRange(
			store,
			fakeApi([competition(1, [hash("e")])]),
			{ from: 100, to: 199 },
			stats()
		);
		const [trade] = store.tradeRows({ from: 100, to: 199 });
		const { usd, pricedSides } = new TradeValuer(store).value(trade);
		assert.equal(pricedSides, 2);
		assert.ok(Math.abs(usd! - 1_000) < 1e-9);
	});

	test("a miss is looked up again only while it is recent", async () => {
		const store = new Store(":memory:");
		const head = Math.floor((Date.now() / 1000 - NETWORK.genesisTime) / NETWORK.blockTime);
		ingest(store, { from: 100, to: head }, [
			{ tx: hash("old"), block: 100 },
			{ tx: hash("new"), block: head - 10 },
		]);
		const api = fakeApi([]);
		await processAuctionRange(store, api, { from: 100, to: head }, stats());
		await processAuctionRange(store, api, { from: 100, to: head }, stats());
		assert.deepEqual(api.asked, [hash("old"), hash("new"), hash("new")]);
	});
});

describe("auction backfill", () => {
	test("a stopped backfill keeps only whole block ranges and resumes below them", async () => {
		const store = new Store(":memory:");
		ingest(store, { from: 100, to: 4_199 }, [
			{ tx: hash("d"), block: 150 },
			{ tx: hash("c"), block: 1_000 },
			{ tx: hash("b"), block: 1_500 },
			{ tx: hash("a"), block: 3_000 },
		]);
		const api = fakeApi(
			["a", "b", "c", "d"].map((label, i) => competition(i + 1, [hash(label)]))
		);
		const stop = new AbortController();
		const stopping: CompetitionSource = {
			async competitionByTx(tx) {
				if (tx === hash("c")) stop.abort();
				return api.competitionByTx(tx);
			},
		};
		await backfillAuctions(store, stopping, 100, { done: true }, stats(), stop.signal);
		assert.deepEqual(store.auctionRange(), { from: 2_200, to: 4_199 });

		await backfillAuctions(
			store,
			api,
			100,
			{ done: true },
			stats(),
			new AbortController().signal
		);
		assert.deepEqual(store.auctionRange(), { from: 100, to: 4_199 });
		assert.deepEqual(api.asked, [hash("a"), hash("c"), hash("b"), hash("d")]);
	});
});
