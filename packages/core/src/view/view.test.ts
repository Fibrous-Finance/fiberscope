import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { buildView, DAY_MS, fractionOf, sortRows, tapeCell } from "./view.ts";

const END = Date.UTC(2026, 9, 2, 10, 35);

function solver(id: string, name: string | null, s: Partial<SnapshotSolver> = {}): SnapshotSolver {
	return {
		id,
		name,
		addresses: [{ env: "prod", address: `0x${id.padEnd(40, "0")}` }],
		batches: [],
		trades: [],
		swaps: [],
		gas: [],
		volume: [],
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
		end: { block: 52_074_002, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays, auctionDays },
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

describe("buildView", () => {
	it("sums each measure over the days its data covers", () => {
		const s = snapshot(3, 1, [
			solver("a", "A", {
				batches: [10, 20, 30],
				trades: [11, 22, 33],
				swaps: [5, 6, 7],
				gas: [1000, 2000, 3000],
				volume: [500],
				entered: [80],
				won: [40],
			}),
		]);
		const v = buildView(s, "7d", "batches");
		assert.deepEqual(v.coverage, { chain: 3, auction: 1 });
		const [a] = v.rows;
		assert.equal(a?.batches, 60);
		assert.equal(a?.trades, 66);
		assert.equal(a?.gasPerTrade, 6000 / 66);
		assert.equal(a?.volume, 500);
		// Average trade divides by the trades of the auction-covered day only.
		assert.equal(a?.averageTrade, 500 / 11);
		// So does batch value; swaps and trades per batch use every chain day.
		assert.equal(a?.batchValue, 500 / 10);
		assert.equal(a?.swapsPerTrade, 18 / 66);
		assert.equal(a?.tradesPerBatch, 66 / 60);
		assert.equal(v.swaps.average, 18 / 66);
		assert.equal(a?.participation, 0.8);
		assert.equal(a?.winRate, 0.5);
		assert.equal(a?.wonShare, 0.4);
		assert.equal(v.hasEarlierWindow, false);
	});

	it("compares with the earlier window only when the measure covers both windows", () => {
		const s = snapshot(2, 1, [
			solver("a", "A", { batches: [5, 1], volume: [9] }),
			solver("b", "B", { batches: [3, 9], volume: [1] }),
		]);
		const batches = buildView(s, "24h", "batches");
		assert.equal(batches.hasEarlierWindow, true);
		const [a, b] = batches.rows;
		assert.equal(a?.id, "a");
		// a was second yesterday and is first today: up one place; b the reverse.
		assert.equal(a?.rankChange, 1);
		assert.equal(b?.rankChange, -1);
		assert.ok(Math.abs((a?.shareChange ?? 0) - (5 / 8 - 1 / 10) * 100) < 1e-9);

		const volume = buildView(s, "24h", "volume");
		assert.equal(volume.hasEarlierWindow, false);
		assert.equal(volume.rows[0]?.rankChange, null);
		assert.equal(volume.rows[0]?.isNew, false);
		assert.equal(volume.biggestGain, null);
	});

	it("ranks the earlier window among every solver, including ones that left", () => {
		const s = snapshot(2, 0, [
			solver("gone", "Gone", { batches: [0, 50] }),
			solver("a", "A", { batches: [10, 5] }),
			solver("new", "New", { batches: [3, 0] }),
		]);
		const v = buildView(s, "24h", "batches");
		assert.deepEqual(
			v.rows.map((r) => [r.id, r.rankChange, r.isNew]),
			[
				["a", 1, false],
				["new", null, true],
			]
		);
	});

	it("names the biggest gainer and flags it when it is the daily leader", () => {
		const s = snapshot(2, 0, [
			solver("a", "A", { batches: [8, 2] }),
			solver("b", "B", { batches: [2, 8] }),
		]);
		const v = buildView(s, "24h", "batches");
		assert.equal(v.biggestGain?.solver.id, "a");
		assert.equal(v.biggestGain?.isLeader, true);
		assert.ok(Math.abs((v.biggestGain?.points ?? 0) - 60) < 1e-9);
	});

	it("follows the daily leader back to the start of its run", () => {
		const s = snapshot(5, 0, [
			solver("a", "A", { batches: [9, 9, 9, 1, 9] }),
			solver("b", "B", { batches: [1, 1, 1, 5, 1] }),
		]);
		const v = buildView(s, "24h", "batches");
		assert.equal(v.leaderRun?.solver.id, "a");
		assert.equal(v.leaderRun?.days, 3);
		assert.equal(v.leaderRun?.since, END - 2 * DAY_MS);
		assert.equal(v.leaderRun?.previous?.id, "b");
		assert.equal(v.leaderRun?.atLeast, false);

		const all = buildView(
			snapshot(2, 0, [solver("a", "A", { batches: [1, 1] })]),
			"24h",
			"batches"
		);
		assert.equal(all.leaderRun?.days, 2);
		assert.equal(all.leaderRun?.atLeast, true);
		assert.equal(all.leaderRun?.previous, null);
	});

	it("gives a tied day no leader, so a tie neither tops nor extends a run", () => {
		// Today A and B tie: no one topped it.
		const today = buildView(
			snapshot(2, 0, [
				solver("a", "A", { batches: [7, 9] }),
				solver("b", "B", { batches: [7, 1] }),
			]),
			"24h",
			"batches"
		);
		assert.equal(today.leaderRun, null);

		// B leads today and yesterday; the day before, A and B tied, so B took over from no one.
		const earlier = buildView(
			snapshot(4, 0, [
				solver("a", "A", { batches: [1, 1, 5, 9] }),
				solver("b", "B", { batches: [6, 6, 5, 1] }),
			]),
			"24h",
			"batches"
		);
		assert.equal(earlier.leaderRun?.solver.id, "b");
		assert.equal(earlier.leaderRun?.days, 2);
		assert.equal(earlier.leaderRun?.atLeast, false);
		assert.equal(earlier.leaderRun?.previous, null);
	});

	it("aligns daily shares with the history dates, oldest first", () => {
		const s = snapshot(3, 0, [
			solver("a", "A", { batches: [1, 3, 0] }),
			solver("b", "B", { batches: [1, 1, 4] }),
		]);
		const v = buildView(s, "24h", "batches");
		assert.deepEqual(v.history, [END - 2 * DAY_MS, END - DAY_MS, END]);
		assert.deepEqual(v.rows.find((r) => r.id === "a")?.daily, [0, 0.75, 0.5]);
	});

	it("lists every solver that entered an auction, with or without batches", () => {
		const s = snapshot(1, 1, [
			solver("a", "A", { batches: [10], entered: [90], won: [60] }),
			solver("b", "B", { batches: [0], entered: [50], won: [0] }),
			solver("c", "C", { batches: [2], entered: [0], won: [0] }),
		]);
		const v = buildView(s, "24h", "batches");
		assert.deepEqual(
			v.competition?.entrants.map((e) => [e.id, e.participation, e.winRate]),
			[
				["a", 0.9, 60 / 90],
				["b", 0.5, 0],
			]
		);
		assert.equal(v.competition?.entrantsPerAuction, 1.4);
		assert.equal(v.competition?.solutionsPerAuction, 9);
		assert.deepEqual(
			v.competition?.withoutAuctions.map((r) => r.id),
			["c"]
		);
		const c = v.rows.find((r) => r.id === "c");
		assert.deepEqual([c?.participation, c?.winRate, c?.wonShare], [null, null, null]);
	});

	it("picks the lowest gas per trade among busy solvers, else among all", () => {
		const busy = Array.from({ length: 1 }, () => 150);
		const s = snapshot(1, 0, [
			solver("lean", "Lean", { batches: [10], trades: [10], gas: [1_000_000] }),
			solver("busy", "Busy", { batches: busy, trades: busy, gas: [60_000_000] }),
		]);
		assert.equal(buildView(s, "24h", "batches").gas.lowest?.id, "busy");
		const quiet = snapshot(1, 0, [
			solver("lean", "Lean", { batches: [10], trades: [10], gas: [5000] }),
		]);
		assert.equal(buildView(quiet, "24h", "batches").gas.lowest?.id, "lean");
	});

	it("treats a window without batches as empty", () => {
		const v = buildView(snapshot(1, 1, [solver("a", "A", { batches: [0] })]), "24h", "batches");
		assert.equal(v.total, 0);
		assert.equal(v.rows.length, 0);
		assert.equal(v.headline, null);
	});

	it("labels unnamed solvers by their shortened prod address", () => {
		const s = snapshot(1, 0, [
			solver("0x588ef3de14875ff9c4fc74c9e2c308767d665e30", null, {
				addresses: [{ env: "prod", address: "0x588ef3de14875ff9c4fc74c9e2c308767d665e30" }],
				batches: [1],
			}),
		]);
		const [r] = buildView(s, "24h", "batches").rows;
		assert.equal(r?.label, "0x588e…5e30");
		assert.equal(r?.unnamed, true);
	});
});

describe("tapeCell", () => {
	const auction = {
		id: 1,
		time: END,
		entered: ["a", "b", "c"],
		winners: [
			{ solver: "a", tx: "0xaa" },
			{ solver: "b", tx: "0xbb" },
		],
	};
	it("opens the solver's own settlement when it won, else the first winner's", () => {
		assert.deepEqual(tapeCell(auction, "b"), { state: "won", tx: "0xbb" });
		assert.deepEqual(tapeCell(auction, "c"), { state: "entered", tx: "0xaa" });
		assert.deepEqual(tapeCell(auction, "d"), { state: "absent", tx: "0xaa" });
	});
});

describe("fractionOf", () => {
	it("uses the design's thresholds, and All only when one solver has everything", () => {
		assert.deepEqual(fractionOf(1), { key: "all" });
		assert.deepEqual(fractionOf(0.999), { key: "moreThanHalf" });
		assert.deepEqual(fractionOf(0.55), { key: "moreThanHalf" });
		assert.deepEqual(fractionOf(0.469), { key: "nearlyHalf" });
		assert.deepEqual(fractionOf(0.18), { key: "oneInFive" });
		assert.deepEqual(fractionOf(0.13), { key: "oneIn", n: 8 });
	});
});

describe("sortRows", () => {
	it("keeps rows without a value last in both directions", () => {
		const s = snapshot(1, 0, [
			solver("a", "A", { batches: [3], trades: [3], gas: [300] }),
			solver("b", "B", { batches: [2], trades: [0], gas: [0] }),
			solver("c", "C", { batches: [1], trades: [1], gas: [500] }),
		]);
		const { rows } = buildView(s, "24h", "batches");
		assert.deepEqual(
			sortRows(rows, { key: "gas", direction: 1 }).map((r) => r.id),
			["a", "c", "b"]
		);
		assert.deepEqual(
			sortRows(rows, { key: "gas", direction: -1 }).map((r) => r.id),
			["c", "a", "b"]
		);
	});
});
