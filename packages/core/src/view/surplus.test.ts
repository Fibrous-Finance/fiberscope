import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { surplusAndCost } from "./surplus.ts";
import { buildView } from "./view.ts";
import type { Period } from "./view.ts";

const END = Date.UTC(2026, 9, 3, 9, 49);

const days = (n: number, value: number) => Array.from({ length: n }, () => value);

function solver(id: string, s: Partial<SnapshotSolver> = {}): SnapshotSolver {
	return {
		id,
		name: id.toUpperCase(),
		addresses: [{ env: "prod", address: `0x${id.padEnd(40, "0")}` }],
		batches: [],
		trades: [],
		swaps: [],
		gas: [],
		volume: [],
		surplus: [],
		surplusTrades: [],
		surplusVolume: [],
		cost: [],
		entered: [],
		won: [],
		latestSettlements: [],
		...s,
	};
}

function snapshot(coverage: Snapshot["coverage"], solvers: SnapshotSolver[]): Snapshot {
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_115_823, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage,
		auctions: {
			count: days(coverage.auctionDays, 100),
			solutions: days(coverage.auctionDays, 900),
		},
		solvers,
		latestAuctions: [],
		latestSettlements: [],
		registry: [],
	};
}

function figures(s: Snapshot, period: Period) {
	return surplusAndCost(s, buildView(s, period, "batches"));
}

/** 10 chain days, 7 auction days, 3 of them with order terms read. */
const partial = snapshot({ chainDays: 10, auctionDays: 7, surplusDays: 3 }, [
	solver("a", {
		batches: days(10, 10),
		trades: days(10, 20),
		cost: days(10, 2),
		volume: days(7, 1_000),
		surplus: days(3, 5),
		surplusTrades: days(3, 10),
		surplusVolume: days(3, 800),
	}),
]);

describe("surplusAndCost", () => {
	it("takes surplus over the window's surplus days and cost over its chain days", () => {
		const week = figures(partial, "7d");
		assert.deepEqual(week.coverage, { surplus: 3, cost: 7, costRate: 7 });
		assert.deepEqual(week.rows.get("a"), {
			surplus: 15,
			surplusTrades: 30,
			surplusPerTrade: 0.5,
			surplusRate: 15 / 2_400,
			cost: 14,
			costPerTrade: 14 / 140,
			costPerBatch: 14 / 70,
			costRate: 14 / 7_000,
		});

		// The month reaches every chain day for cost, and still only 3 days for surplus.
		const month = figures(partial, "30d");
		assert.deepEqual(month.coverage, { surplus: 3, cost: 10, costRate: 7 });
		const a = month.rows.get("a")!;
		assert.equal(a.surplus, 15);
		assert.equal(a.cost, 20);
		assert.equal(a.costPerTrade, 0.1);
		// Cost per dollar compares cost and volume over the same 7 auction days.
		assert.equal(a.costRate, 14 / 7_000);

		const day = figures(partial, "24h");
		assert.deepEqual(day.coverage, { surplus: 1, cost: 1, costRate: 1 });
		assert.equal(day.rows.get("a")?.surplus, 5);
	});

	it("has no surplus without surplus days, and no average without trades to divide by", () => {
		const unread = figures(
			snapshot({ chainDays: 2, auctionDays: 2, surplusDays: 0 }, [
				solver("a", { batches: [1, 1], trades: [1, 1], cost: [0.02, 0.02] }),
			]),
			"7d"
		);
		assert.equal(unread.coverage.surplus, 0);
		const a = unread.rows.get("a")!;
		assert.deepEqual(
			[a.surplus, a.surplusTrades, a.surplusPerTrade, a.surplusRate],
			[null, null, null, null]
		);
		assert.equal(a.cost, 0.04);
		// Priced volume is missing too, so there is no cost per dollar.
		assert.equal(a.costRate, null);

		// Surplus days, but none of the solver's trades was priced: zero, and no averages.
		const unpriced = figures(
			snapshot({ chainDays: 1, auctionDays: 1, surplusDays: 1 }, [
				solver("a", {
					batches: [1],
					trades: [1],
					cost: [0.01],
					volume: [0],
					surplus: [0],
					surplusTrades: [0],
					surplusVolume: [0],
				}),
			]),
			"24h"
		);
		const b = unpriced.rows.get("a")!;
		assert.deepEqual(
			[b.surplus, b.surplusTrades, b.surplusPerTrade, b.surplusRate],
			[0, 0, null, null]
		);

		// Without chain data nothing is ranked, and the network has nothing to average.
		const empty = figures(snapshot({ chainDays: 0, auctionDays: 0, surplusDays: 0 }, []), "7d");
		assert.equal(empty.rows.size, 0);
		assert.deepEqual(empty.network, {
			surplus: null,
			surplusTrades: null,
			surplusPerTrade: null,
			surplusRate: null,
			cost: 0,
			costPerTrade: null,
			costPerBatch: null,
			costRate: null,
		});
	});

	it("averages the network over all trades, not over solvers", () => {
		const s = snapshot({ chainDays: 1, auctionDays: 1, surplusDays: 1 }, [
			solver("big", {
				batches: [30],
				trades: [30],
				cost: [0.9],
				volume: [90_000],
				surplus: [90],
				surplusTrades: [30],
				surplusVolume: [90_000],
			}),
			solver("small", {
				batches: [10],
				trades: [70],
				cost: [0.1],
				volume: [7_000],
				surplus: [10],
				surplusTrades: [70],
				surplusVolume: [5_000],
			}),
			// Settled only before the window: not ranked, adds nothing.
			solver("gone", { batches: [0], trades: [0], cost: [0] }),
		]);
		const { rows, network } = figures(s, "24h");
		assert.deepEqual([...rows.keys()], ["big", "small"]);
		assert.equal(rows.get("big")?.surplusPerTrade, 3);
		assert.equal(rows.get("small")?.surplusPerTrade, 10 / 70);
		// 100 over 100 trades, not the mean of 3 and 0.14.
		assert.equal(network.surplusPerTrade, 1);
		assert.equal(network.surplusRate, 100 / 95_000);
		assert.equal(network.costPerTrade, 1 / 100);
		assert.equal(network.costPerBatch, 1 / 40);
		assert.equal(network.costRate, 1 / 97_000);
		// The small solver's trades beat their limits by more per dollar, though less per trade.
		assert.ok(rows.get("small")!.surplusRate! > rows.get("big")!.surplusRate!);
	});
});
