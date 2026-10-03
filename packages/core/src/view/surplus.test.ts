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
		unusualSurplus: [],
		unusualTrades: [],
		unusualVolume: [],
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
		// Each day, one of the ten trades beat its limit by more than a tenth of its value.
		unusualSurplus: days(3, 2),
		unusualTrades: days(3, 1),
		unusualVolume: days(3, 100),
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
			surplusVolume: 2_400,
			surplusRate: 15 / 2_400,
			unusualSurplus: 6,
			unusualTrades: 3,
			unusualShare: 0.4,
			unusualTradeShare: 0.1,
			typicalSurplus: 9,
			typicalTrades: 27,
			typicalSurplusPerTrade: 9 / 27,
			typicalSurplusRate: 9 / 2_100,
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
		assert.deepEqual(
			[a.unusualSurplus, a.unusualShare, a.typicalSurplus, a.typicalSurplusPerTrade],
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
		// No surplus, so no share of it is unusual.
		assert.deepEqual(
			[b.unusualSurplus, b.unusualShare, b.typicalSurplus, b.typicalSurplusPerTrade],
			[0, null, 0, null]
		);

		// Without chain data nothing is ranked, and the network has nothing to average.
		const empty = figures(snapshot({ chainDays: 0, auctionDays: 0, surplusDays: 0 }, []), "7d");
		assert.equal(empty.rows.size, 0);
		assert.deepEqual(empty.network, {
			surplus: null,
			surplusTrades: null,
			surplusPerTrade: null,
			surplusVolume: null,
			surplusRate: null,
			unusualSurplus: null,
			unusualTrades: null,
			unusualShare: null,
			unusualTradeShare: null,
			typicalSurplus: null,
			typicalTrades: null,
			typicalSurplusPerTrade: null,
			typicalSurplusRate: null,
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

	it("separates unusual surplus, so a few loose limits do not decide the comparison", () => {
		const s = snapshot({ chainDays: 1, auctionDays: 1, surplusDays: 1 }, [
			// Two of its 30 trades had limits far from the market and bring most of its surplus.
			solver("loose", {
				batches: [30],
				trades: [30],
				volume: [30_000],
				surplus: [300],
				surplusTrades: [30],
				surplusVolume: [30_000],
				unusualSurplus: [280],
				unusualTrades: [2],
				unusualVolume: [400],
			}),
			solver("tight", {
				batches: [20],
				trades: [30],
				volume: [30_000],
				surplus: [100],
				surplusTrades: [30],
				surplusVolume: [30_000],
				unusualSurplus: [0],
				unusualTrades: [0],
				unusualVolume: [0],
			}),
			// Every one of its trades is unusual: nothing typical is left to average.
			solver("odd", {
				batches: [1],
				trades: [1],
				volume: [50],
				surplus: [40],
				surplusTrades: [1],
				surplusVolume: [50],
				unusualSurplus: [40],
				unusualTrades: [1],
				unusualVolume: [50],
			}),
		]);
		const { rows, network } = figures(s, "24h");
		const loose = rows.get("loose")!;
		const tight = rows.get("tight")!;
		// In total, loose gives three times tight's surplus per trade; typically, a fifth of it.
		assert.equal(loose.surplusPerTrade, 10);
		assert.equal(tight.surplusPerTrade, 100 / 30);
		assert.equal(loose.unusualShare, 280 / 300);
		assert.equal(loose.typicalSurplus, 20);
		assert.equal(loose.typicalTrades, 28);
		assert.equal(loose.typicalSurplusPerTrade, 20 / 28);
		assert.equal(loose.typicalSurplusRate, 20 / 29_600);
		assert.equal(tight.unusualShare, 0);
		assert.equal(tight.typicalSurplusPerTrade, 100 / 30);
		assert.equal(tight.typicalSurplusRate, 100 / 30_000);

		const odd = rows.get("odd")!;
		assert.deepEqual(
			[odd.unusualShare, odd.typicalSurplus, odd.typicalTrades, odd.typicalSurplusPerTrade],
			[1, 0, 0, null]
		);
		assert.equal(odd.typicalSurplusRate, null);

		// The network's typical figures leave out every unusual trade.
		assert.equal(network.unusualSurplus, 320);
		assert.equal(network.unusualTrades, 3);
		assert.equal(network.unusualShare, 320 / 440);
		assert.equal(network.typicalSurplus, 120);
		assert.equal(network.typicalSurplusPerTrade, 120 / 58);
		assert.equal(network.typicalSurplusRate, 120 / 59_600);
	});
});
