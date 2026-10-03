import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Snapshot } from "@fiberscope/core";

import { ROUTER, SETTLEMENT } from "./chain.ts";
import { BLOCKS_PER_DAY, timeOf, WETH } from "./config.ts";
import { Registry } from "./registry.ts";
import type { RegistryEntry } from "./registry.ts";
import { buildSnapshot } from "./snapshot.ts";
import { Store } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** Three whole days of chain data, from block 1: bucket 2 starts there, bucket 0 ends here. */
const END = 3 * BLOCKS_PER_DAY;

const ARC = "0xa1c1";
const RIZZOLVER = "0x8f58";
const RIZZOLVER_RETIRED = "0x4dd1";
const SECTOR = "0x5c35";
const CURVE = "0x821a";
/** A per-transaction account that sends router settlements; never a solver. */
const HELPER = "0x9598";
/** An address no registry lists. */
const STRANGER = "0xdead";

const CMS: RegistryEntry[] = [
	{ address: ARC, env: "prod", active: true, solverId: "arc", name: "Arc" },
	{
		address: RIZZOLVER_RETIRED,
		env: "prod",
		active: false,
		solverId: "rizzolver",
		name: "Rizzolver",
	},
	{ address: SECTOR, env: "prod", active: true, solverId: "sector", name: "Sector Finance" },
	{ address: SECTOR, env: "barn", active: false, solverId: "sector", name: "Sector Finance" },
	{ address: CURVE, env: "prod", active: false, solverId: "curve", name: "Curve" },
];
const OVERRIDES: RegistryEntry[] = [
	{ address: RIZZOLVER, env: "prod", active: true, solverId: "rizzolver", name: "Rizzolver" },
];

interface Settled {
	tx: string;
	block: number;
	/** The Settlement event's solver: the address that called `settle`. */
	solver: string;
	swaps: number;
	trades?: number;
	logIndex?: number;
	/** The transaction's sender; the solver by default. */
	sender?: string;
	/** The transaction's recipient; the settlement contract by default. */
	recipient?: string;
}

/** Oldest first. Sector and Curve never settle; the stranger is not in the registry. */
const SETTLED: Settled[] = [
	{ tx: "0xold", block: 100, solver: ARC, swaps: 4 },
	{
		tx: "0xrouted-old",
		block: 50_000,
		solver: ROUTER,
		sender: HELPER,
		recipient: RIZZOLVER,
		swaps: 5,
	},
	// 52 batches of Arc in bucket 0; the newest, 0xarc0, at END − 1,000.
	...Array.from({ length: 52 }, (_, i) => ({
		tx: `0xarc${i}`,
		block: END - 1_000 - i,
		solver: ARC,
		swaps: 1,
	})).reverse(),
	{ tx: "0xstranger", block: END - 30, solver: STRANGER, swaps: 1 },
	// A buffer settlement: no trade, so no batch.
	{ tx: "0xbuffer", block: END - 20, solver: ARC, trades: 0, swaps: 7 },
	// Two batches in one transaction.
	{ tx: "0xpair", block: END - 15, logIndex: 3, solver: ARC, swaps: 1 },
	{ tx: "0xpair", block: END - 15, logIndex: 7, solver: ARC, swaps: 6 },
	// Neither sender nor recipient is a solver: the auction's winning solution (Arc's) decides.
	{ tx: "0xwon", block: END - 10, solver: ROUTER, sender: HELPER, recipient: ROUTER, swaps: 3 },
	{
		tx: "0xrouted",
		block: END - 5,
		solver: ROUTER,
		sender: HELPER,
		recipient: RIZZOLVER,
		swaps: 2,
	},
];

async function build(): Promise<Snapshot> {
	const store = new Store(":memory:");
	const range = { from: 1, to: END };
	store.commitChunk(
		{
			range,
			settlements: SETTLED.map(({ tx, block, solver, swaps, trades = 1, logIndex = 10 }) => ({
				tx,
				logIndex,
				block,
				solver,
				trades,
				swaps,
			})),
			trades: SETTLED.flatMap(({ tx, block, trades = 1, logIndex = 10 }) =>
				Array.from({ length: trades }, (_, i) => ({
					tx,
					logIndex: logIndex - trades + i,
					block,
					settlementLogIndex: logIndex,
					sellToken: USDC,
					buyToken: WETH,
					sellAmount: "1000000000",
					buyAmount: "500000000000000000",
				}))
			),
			txs: [...new Map(SETTLED.map((s) => [s.tx, s])).values()].map((s) => ({
				tx: s.tx,
				block: s.block,
				sender: s.sender ?? s.solver,
				recipient: s.recipient ?? SETTLEMENT,
				gasUsed: 400_000,
				gasPrice: "1",
				l1Fee: "1",
			})),
			prices: [],
		},
		range
	);
	store.saveCompetition(
		{
			auctionId: 1,
			startBlock: END - 14,
			deadlineBlock: END - 11,
			txHashes: ["0xwon"],
			prices: new Map(),
			solutions: [
				{
					solver: ARC,
					score: "1",
					ranking: 1,
					winner: true,
					filteredOut: false,
					tx: "0xwon",
				},
			],
		},
		[],
		[{ tx: "0xwon", priced: false }],
		0
	);
	store.setLastRunAt(Date.now());
	const { snapshot } = await buildSnapshot({
		store,
		registry: new Registry(CMS, OVERRIDES),
		refreshMinutes: 10,
		symbols: async () =>
			new Map([
				[USDC, "USDC"],
				[WETH, "WETH"],
			]),
	});
	return snapshot;
}

describe("snapshot", () => {
	test("a solver's daily swaps are the DEX swaps of the batches credited to it", async () => {
		const { coverage, solvers } = await build();
		assert.equal(coverage.chainDays, 3);
		const byId = new Map(solvers.map((solver) => [solver.id, solver]));
		assert.deepEqual(byId.get("arc")?.batches, [55, 0, 1]);
		assert.deepEqual(byId.get("arc")?.swaps, [62, 0, 4]);
		assert.deepEqual(byId.get("rizzolver")?.batches, [1, 1, 0]);
		assert.deepEqual(byId.get("rizzolver")?.swaps, [2, 5, 0]);
		assert.deepEqual(byId.get(STRANGER)?.swaps, [1, 0, 0]);
		// The network's swaps: every batch's, without the buffer settlement's 7.
		const total = solvers.flatMap((solver) => solver.swaps).reduce((a, b) => a + b, 0);
		assert.equal(total, 74);
	});

	test("the latest settlements are the newest 50 batches of all solvers, newest first", async () => {
		const { latestSettlements } = await build();
		assert.equal(latestSettlements.length, 50);
		assert.deepEqual(latestSettlements[0], {
			tx: "0xrouted",
			block: END - 5,
			time: timeOf(END - 5) * 1000,
			trades: 1,
			pair: { sell: "USDC", buy: "WETH" },
			volume: null,
			gas: 400_000,
			solver: "rizzolver",
			swaps: 2,
		});
		assert.deepEqual(
			latestSettlements.slice(0, 5).map(({ tx, solver, swaps }) => ({ tx, solver, swaps })),
			[
				{ tx: "0xrouted", solver: "rizzolver", swaps: 2 },
				{ tx: "0xwon", solver: "arc", swaps: 3 },
				// The later Settlement event of the transaction first.
				{ tx: "0xpair", solver: "arc", swaps: 6 },
				{ tx: "0xpair", solver: "arc", swaps: 1 },
				{ tx: "0xstranger", solver: STRANGER, swaps: 1 },
			]
		);
		assert.deepEqual(
			latestSettlements.slice(5).map((settlement) => settlement.tx),
			Array.from({ length: 45 }, (_, i) => `0xarc${i}`)
		);
	});

	test("the registry lists every registry solver, also the ones that never settled", async () => {
		const { registry } = await build();
		assert.deepEqual(registry, [
			{
				id: "rizzolver",
				name: "Rizzolver",
				// Active through the override; the CMS only lists a retired address.
				active: true,
				addresses: [
					{ env: "prod", address: RIZZOLVER, active: true },
					{ env: "prod", address: RIZZOLVER_RETIRED, active: false },
				],
				lastSettlement: { tx: "0xrouted", block: END - 5, time: timeOf(END - 5) * 1000 },
				batches: 2,
			},
			{
				id: "arc",
				name: "Arc",
				active: true,
				addresses: [{ env: "prod", address: ARC, active: true }],
				lastSettlement: { tx: "0xwon", block: END - 10, time: timeOf(END - 10) * 1000 },
				batches: 56,
			},
			{
				id: "sector",
				name: "Sector Finance",
				active: true,
				addresses: [
					{ env: "prod", address: SECTOR, active: true },
					{ env: "barn", address: SECTOR, active: false },
				],
				lastSettlement: null,
				batches: 0,
			},
			{
				id: "curve",
				name: "Curve",
				active: false,
				addresses: [{ env: "prod", address: CURVE, active: false }],
				lastSettlement: null,
				batches: 0,
			},
		]);
	});
});
