import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { exportCoverage, exportedSurplus, leaderboardCsv } from "./exports.ts";
import { surplusAndCost } from "./surplus.ts";
import { buildView } from "./view.ts";
import type { Period } from "./view.ts";

const END = Date.UTC(2026, 9, 3, 15, 21, 51);
const DAY = 86_400_000;

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
		end: { block: 52_125_782, time: END },
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

function exported(s: Snapshot, period: Period) {
	const view = buildView(s, period, "batches");
	const figures = surplusAndCost(s, view);
	const coverage = exportCoverage(view, figures);
	return { coverage, csv: leaderboardCsv(view.rows, figures, coverage).split("\n") };
}

const one = (coverage: Snapshot["coverage"]) =>
	snapshot(coverage, [solver("a", { batches: days(180, 1), trades: days(180, 1) })]);

describe("exportCoverage", () => {
	it("marks a source only where it covers less than the window", () => {
		// 42 days of auction data, 8 of them with surplus.
		const s = one({ chainDays: 180, auctionDays: 42, surplusDays: 8 });

		const week = exported(s, "7d").coverage;
		assert.equal(week.start, END - 7 * DAY);
		assert.equal(week.end, END);
		// Both sources cover the whole week, so they start with it.
		assert.equal(week.auctionFrom, week.start);
		assert.equal(week.surplusFrom, week.start);
		assert.deepEqual(week.marks, { auction: "", surplus: "" });
		assert.deepEqual(week.footnotes, []);

		const month = exported(s, "30d").coverage;
		assert.equal(month.auctionFrom, month.start);
		assert.equal(month.surplusFrom, END - 8 * DAY);
		assert.deepEqual(month.marks, { auction: "", surplus: "‡" });
		assert.deepEqual(month.footnotes, [{ key: "surplus", covered: 8 }]);

		const quarter = exported(s, "90d").coverage;
		assert.equal(quarter.auctionFrom, END - 42 * DAY);
		assert.deepEqual(quarter.marks, { auction: "†", surplus: "‡" });
		assert.deepEqual(quarter.footnotes, [
			{ key: "auction", covered: 42 },
			{ key: "surplus", covered: 8 },
		]);
	});

	it("gives surplus the auction footnote when both cover the same days", () => {
		const quarter = exported(one({ chainDays: 180, auctionDays: 53, surplusDays: 53 }), "90d");
		assert.deepEqual(quarter.coverage.marks, { auction: "†", surplus: "†" });
		assert.deepEqual(quarter.coverage.footnotes, [{ key: "auctionAndSurplus", covered: 53 }]);
		assert.equal(quarter.coverage.surplusFrom, quarter.coverage.auctionFrom);

		// No auction data, so no surplus either: one footnote says both have none.
		const day = exported(one({ chainDays: 180, auctionDays: 0, surplusDays: 0 }), "24h");
		assert.deepEqual(day.coverage.marks, { auction: "†", surplus: "†" });
		assert.deepEqual(day.coverage.footnotes, [{ key: "auctionAndSurplus", covered: 0 }]);
		assert.equal(day.coverage.auctionFrom, null);
		assert.equal(day.coverage.surplusFrom, null);
	});
});

describe("leaderboardCsv", () => {
	const s = snapshot({ chainDays: 1, auctionDays: 1, surplusDays: 1 }, [
		solver("a", {
			batches: [4],
			trades: [8],
			swaps: [12],
			gas: [4_000_000],
			cost: [0.1234],
			volume: [10_000],
			entered: [50],
			won: [20],
			surplus: [12.4],
			surplusTrades: [8],
			surplusVolume: [10_000],
			unusualSurplus: [5],
			unusualTrades: [1],
			unusualVolume: [500],
		}),
		// Its surplus days hold no trades with surplus: nothing to report, not $0.
		solver("b", {
			name: 'B "Best"',
			batches: [6],
			trades: [6],
			swaps: [6],
			gas: [1_200_000],
			cost: [0.06],
			volume: [0],
			surplus: [0],
			surplusTrades: [0],
			surplusVolume: [0],
		}),
	]);

	it("writes money with cents, rates as fractions and the coverage on every row", () => {
		const [header, b, a] = exported(s, "24h").csv;
		assert.equal(
			header,
			"rank,solver,share_pct,batches,trades,volume_usd,gas_per_trade,cost_usd,cost_per_trade_usd,dex_swaps_per_trade,avg_batch_value_usd,trades_per_batch,entered_pct,win_rate_pct,surplus_usd,surplus_per_trade_usd,surplus_bps,typical_surplus_per_trade_usd,typical_surplus_bps,unusual_surplus_share,window_start_utc,window_end_utc,auction_data_from_utc,surplus_data_from_utc"
		);
		const window =
			"2026-10-02T15:21:51Z,2026-10-03T15:21:51Z,2026-10-02T15:21:51Z,2026-10-02T15:21:51Z";
		// Typical leaves out the unusual trade: $7.40 over 7 trades and $9,500.
		assert.equal(
			a,
			`2,"A",40.00,4,8,10000,500000,0.12,0.0154,1.50,2500,2.00,50.0,40.0,12.40,1.55,12.4,1.06,7.8,0.403,${window}`
		);
		assert.equal(
			b,
			`1,"B ""Best""",60.00,6,6,0,200000,0.06,0.0100,1.00,0,1.00,,,,,,,,,${window}`
		);
	});

	it("leaves the columns of a source without data empty", () => {
		const [, a] = exported(
			snapshot({ chainDays: 1, auctionDays: 0, surplusDays: 0 }, [
				solver("a", {
					batches: [4],
					trades: [8],
					swaps: [12],
					gas: [4_000_000],
					cost: [0.1234],
				}),
			]),
			"24h"
		).csv;
		assert.equal(
			a,
			'1,"A",100.00,4,8,,500000,0.12,0.0154,1.50,,2.00,,,,,,,,,2026-10-02T15:21:51Z,2026-10-03T15:21:51Z,,'
		);
	});
});

describe("exportedSurplus", () => {
	it("reports surplus only for a solver with surplus trades", () => {
		const figures = surplusAndCost(s24(), buildView(s24(), "24h", "batches"));
		assert.equal(exportedSurplus(figures.rows.get("a")), 3);
		assert.equal(exportedSurplus(figures.rows.get("b")), null);
		assert.equal(exportedSurplus(undefined), null);
	});
});

function s24() {
	return snapshot({ chainDays: 1, auctionDays: 1, surplusDays: 1 }, [
		solver("a", {
			batches: [1],
			trades: [1],
			surplus: [3],
			surplusTrades: [1],
			surplusVolume: [9],
		}),
		solver("b", { batches: [1], trades: [1], surplus: [0], surplusTrades: [0] }),
	]);
}
