import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuctionSolution, Snapshot, SnapshotSolver } from "../snapshot.ts";
import { auctionSolutions, trackPosition } from "./solutions.ts";

const END = Date.UTC(2026, 9, 13, 20, 12);

function solver(id: string, name: string): SnapshotSolver {
	return {
		id,
		name,
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
		solutions: [],
		filteredOut: [],
		losses: [],
		closeLosses: [],
		quotes: [],
		quotesVerified: [],
		quotesSettled: [],
		protocolFees: [],
		partnerFees: [],
		latestSettlements: [],
	};
}

/** An auction of the latest ones, with its solutions in CoW's ranking. */
function snapshot(id: number, solutions: AuctionSolution[]): Snapshot {
	const ids = [...new Set(solutions.map((s) => s.solver))];
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_566_513, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays: 1, auctionDays: 1, surplusDays: 1, detailDays: 1 },
		auctions: { count: [1], solutions: [solutions.length] },
		solvers: ids.map((solverId) => solver(solverId, solverId.toUpperCase())),
		latestAuctions: [
			{
				id,
				time: END,
				entered: ids,
				winners: solutions
					.filter((s) => s.winner)
					.map((s) => ({ solver: s.solver, tx: `0x${s.solver}` })),
				solutions,
			},
		],
		latestSettlements: [],
		registry: [],
	};
}

describe("auctionSolutions", () => {
	it("groups solutions by solver in CoW's ranking, with gaps below the single winner", () => {
		const s = snapshot(29_514_112, [
			{ solver: "nexroute", score: 4.5783, winner: true },
			{ solver: "kaiser", score: 4.5, filteredOut: true },
			{ solver: "helixbox", score: 4.5729 },
			{ solver: "kaiser", score: 4.4 },
			{ solver: "baseline", score: 4.6, filteredOut: true },
		]);
		const a = auctionSolutions(s, 29_514_112)!;
		assert.equal(a.single, true);
		assert.equal(a.tx, "0xnexroute");
		assert.deepEqual([a.solutions, a.solvers], [5, 4]);
		assert.deepEqual(
			a.rows.map((r) => [r.id, r.solutions.length]),
			[
				["nexroute", 1],
				["kaiser", 2],
				["helixbox", 1],
				["baseline", 1],
			]
		);
		// The best rival passed the filter: Kaisersolver's first solution did not.
		assert.equal(a.rival?.solver.id, "helixbox");
		assert.ok(Math.abs(a.rival!.gap - (4.5783 - 4.5729) / 4.5783) < 1e-12);
		assert.equal(a.rows[0]!.solutions[0]!.gap, null);
		assert.ok(a.rows[3]!.solutions[0]!.gap! < 0);
		assert.deepEqual(
			a.filtered.map((f) => [f.solver.id, f.filtered, f.solutions]),
			[
				["kaiser", 1, 2],
				["baseline", 1, 1],
			]
		);
	});

	it("gives a tie as a rival with no gap", () => {
		const s = snapshot(1, [
			{ solver: "a", score: 2, winner: true },
			{ solver: "b", score: 2 },
		]);
		assert.equal(auctionSolutions(s, 1)!.rival?.gap, 0);
	});

	it("gives no gaps with several winners, nor without a rival that passed the filter", () => {
		const several = snapshot(29_514_024, [
			{ solver: "nexroute", score: 0.0194, winner: true },
			{ solver: "sector", score: 0.0121, winner: true },
			{ solver: "rosato", score: 0.016 },
		]);
		const a = auctionSolutions(several, 29_514_024)!;
		assert.equal(a.single, false);
		assert.equal(a.rival, null);
		assert.deepEqual(
			a.rows.flatMap((r) => r.solutions.map((x) => x.gap)),
			[null, null, null]
		);
		const alone = snapshot(2, [
			{ solver: "a", score: 1, winner: true },
			{ solver: "b", score: 3, filteredOut: true },
		]);
		assert.equal(auctionSolutions(alone, 2)!.rival, null);
	});

	it("knows only the latest auctions", () => {
		assert.equal(auctionSolutions(snapshot(1, []), 2), null);
	});
});

describe("trackPosition", () => {
	it("places gaps on a log scale from 0.01% to 100%, a quarter per decade", () => {
		assert.equal(trackPosition(0.0001), 0);
		assert.equal(trackPosition(0.01), 0.5);
		assert.equal(trackPosition(1), 1);
		// Ties, gaps under 0.01% and scores above the winner sit at the left end.
		assert.equal(trackPosition(0), 0);
		assert.equal(trackPosition(-0.2), 0);
		assert.ok(Math.abs(trackPosition(0.001) - 0.25) < 1e-12);
	});
});
