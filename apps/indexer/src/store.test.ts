import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ROUTER } from "./chain.ts";
import { WETH } from "./config.ts";
import { TradeValuer } from "./facts.ts";
import { Store } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOLVER = "0x5050505050505050505050505050505050505050";

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
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
		assert.deepEqual(
			[
				...new Set(
					store.solutionsByStart({ from: 1, to: 1_000 }).map((row) => row.auctionId)
				),
			],
			[2, 3]
		);
		const [trade] = store.tradeRows({ from: 320, to: 320 });
		assert.equal(new TradeValuer(store).value(trade).pricedSides, 2);
		// The answer in force at block 150 stays.
		assert.deepEqual(
			store.ethUsdPoints().map(({ block }) => block),
			[140, 350]
		);
	});
});
