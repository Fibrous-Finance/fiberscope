import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { networkActivity, networkBars } from "./network.ts";
import { buildView, DAY_MS } from "./view.ts";
import type { Measure, Period } from "./view.ts";

const END = Date.UTC(2026, 9, 3, 9, 49);

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

function snapshot(chainDays: number, auctionDays: number, solvers: SnapshotSolver[]): Snapshot {
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_115_823, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays, auctionDays, surplusDays: auctionDays },
		auctions: {
			count: Array.from({ length: auctionDays }, () => 100),
			solutions: Array.from({ length: auctionDays }, () => 900),
		},
		solvers,
		latestAuctions: [],
		latestSettlements: [],
		registry: [],
	};
}

function activity(s: Snapshot, period: Period, measure: Measure) {
	return networkActivity(s, buildView(s, period, measure));
}

// Newest first, 14 days: the 7 days of the window, then the 7 before them.
const twoWeeks = snapshot(14, 0, [
	solver("a", { batches: [20, 20, 10, 10, 10, 10, 10, 5, 5, 5, 5, 5, 5, 0] }),
	solver("b", { batches: [10, 0, 10, 10, 10, 10, 0, 5, 5, 5, 5, 5, 5, 0] }),
]);

describe("networkActivity", () => {
	it("adds up every solver per day, oldest first, over the period's history", () => {
		const a = activity(twoWeeks, "7d", "batches");
		assert.equal(a.days.length, 30);
		assert.equal(a.days[0], END - 29 * DAY_MS);
		assert.equal(a.days[29], END);
		assert.equal(a.window, 7);
		// 30 days drawn, 14 with data: the oldest 16 have none. The 14th day back had no batches,
		// which is a 0, not a gap.
		assert.equal(a.first, 16);
		assert.deepEqual(
			a.totals.slice(0, 16),
			Array.from({ length: 16 }, () => null)
		);
		assert.deepEqual(
			a.totals.slice(16),
			[0, 10, 10, 10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 30]
		);
	});

	it("averages the period per day and compares it with the period before", () => {
		const week = activity(twoWeeks, "7d", "batches");
		// 140 batches this week, 60 the week before.
		assert.equal(week.covered, 7);
		assert.equal(week.perDay, 20);
		assert.ok(Math.abs((week.change ?? 0) - (140 / 60 - 1) * 100) < 1e-9);

		const day = activity(twoWeeks, "24h", "batches");
		assert.equal(day.perDay, 30);
		assert.equal(day.change, 50);
		assert.equal(day.window, 1);
		assert.equal(day.days.length, 30);
	});

	it("has no change without a covered period before, or when that period was empty", () => {
		assert.equal(activity(twoWeeks, "30d", "batches").change, null);

		const quiet = snapshot(2, 0, [solver("a", { batches: [4, 0] })]);
		assert.equal(activity(quiet, "24h", "batches").change, null);
		assert.equal(activity(quiet, "24h", "batches").perDay, 4);
	});

	it("leaves the days without data empty and averages over the days with it", () => {
		const s = snapshot(30, 3, [
			solver("a", { batches: Array.from({ length: 30 }, () => 2), volume: [600, 300, 0] }),
			solver("b", { batches: Array.from({ length: 30 }, () => 1), volume: [200, 0, 0] }),
		]);
		// Volume reaches 3 days back, so the week is averaged over those 3 and has no earlier week.
		const volume = activity(s, "7d", "volume");
		assert.equal(volume.first, 27);
		assert.deepEqual(volume.totals.slice(26), [null, 0, 300, 800]);
		assert.equal(volume.covered, 3);
		assert.equal(volume.perDay, 1100 / 3);
		assert.equal(volume.change, null);
		assert.deepEqual(volume.shares.get("a")?.slice(26), [null, 0, 1, 0.75]);
		assert.deepEqual(volume.shares.get("b")?.slice(26), [null, 0, 0, 0.25]);

		// Batches cover the whole history.
		const batches = activity(s, "7d", "batches");
		assert.equal(batches.first, 0);
		assert.ok(batches.totals.every((total) => total === 3));
	});

	it("draws 180 days for 180D, volume only where its 90 days of data reach", () => {
		const s = snapshot(180, 90, [
			solver("a", {
				batches: Array.from({ length: 180 }, () => 1),
				volume: Array.from({ length: 90 }, () => 50),
			}),
		]);
		const volume = activity(s, "180d", "volume");
		assert.equal(volume.days.length, 180);
		assert.equal(volume.window, 180);
		assert.equal(volume.first, 90);
		assert.equal(volume.covered, 90);
		assert.equal(volume.perDay, 50);
		assert.equal(volume.change, null);
		assert.equal(activity(s, "180d", "batches").first, 0);
	});

	it("gives each ranked solver its share of every day", () => {
		const a = activity(twoWeeks, "7d", "batches");
		assert.deepEqual([...a.shares.keys()], ["a", "b"]);
		const b = a.shares.get("b") ?? [];
		// A day nobody settled is a share of 0, not a gap.
		assert.deepEqual(b.slice(15), [
			null,
			0,
			0.5,
			0.5,
			0.5,
			0.5,
			0.5,
			0.5,
			0,
			0.5,
			0.5,
			0.5,
			0.5,
			0,
			1 / 3,
		]);
		a.days.forEach((_, k) => {
			const sum = (a.shares.get("a")?.[k] ?? 0) + (b[k] ?? 0);
			const shareless = a.totals[k] === null || a.totals[k] === 0;
			assert.ok(Math.abs(sum - (shareless ? 0 : 1)) < 1e-9);
		});
	});
});

describe("networkBars", () => {
	it("splits the bars at the window, scales them to the busiest day and skips days without data", () => {
		const bars = networkBars({ totals: [null, 25, 50, 100], window: 2 }, null);
		assert.deepEqual(bars, {
			earlier: "M1.15 76.00H1.85V100H1.15Z",
			window: "M2.15 52.00H2.85V100H2.15ZM3.15 4.00H3.85V100H3.15Z",
			hovered: "",
		});
	});

	it("draws the hovered day on its own, wherever it is", () => {
		const totals = [10, 20, 40];
		assert.deepEqual(networkBars({ totals, window: 1 }, 2), {
			earlier: "M0.15 76.00H0.85V100H0.15ZM1.15 52.00H1.85V100H1.15Z",
			window: "",
			hovered: "M2.15 4.00H2.85V100H2.15Z",
		});
		assert.equal(networkBars({ totals, window: 1 }, 0).hovered, "M0.15 76.00H0.85V100H0.15Z");
		// Nothing to hover on a day without data.
		assert.equal(networkBars({ totals: [null, 5], window: 1 }, 0).hovered, "");
	});
});
