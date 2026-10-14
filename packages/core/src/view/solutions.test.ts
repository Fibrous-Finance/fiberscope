import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuctionSolution, Snapshot, SnapshotSolver } from "../snapshot.ts";
import {
	auctionOutcome,
	auctionSolutions,
	filteredOutcome,
	solutionState,
	trackPosition,
} from "./solutions.ts";
import type { SolutionPoint } from "./solutions.ts";

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

	it("gives a tie as a rival with no gap, and names every solver that tied", () => {
		const s = snapshot(1, [
			{ solver: "a", score: 2, winner: true },
			{ solver: "b", score: 2 },
			{ solver: "c", score: 2 },
			{ solver: "d", score: 1.5 },
			// Filtered out above the winning score: no tie.
			{ solver: "e", score: 2.5, filteredOut: true },
		]);
		const a = auctionSolutions(s, 1)!;
		assert.equal(a.rival?.gap, 0);
		assert.deepEqual(
			a.ties.map((solver) => solver.id),
			["b", "c"]
		);
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
		assert.deepEqual(a.ties, []);
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

	it("links the settlement of the first winner that settled", () => {
		const s = snapshot(3, [
			{ solver: "a", score: 2, winner: true },
			{ solver: "b", score: 1, winner: true },
		]);
		s.latestAuctions[0]!.winners[0]!.tx = null;
		assert.equal(auctionSolutions(s, 3)!.tx, "0xb");
		s.latestAuctions[0]!.winners[1]!.tx = null;
		assert.equal(auctionSolutions(s, 3)!.tx, null);
	});

	it("knows only the latest auctions", () => {
		assert.equal(auctionSolutions(snapshot(1, []), 2), null);
	});
});

/** A fixture solver as the solutions name it. */
const ref = (id: string) => ({ id, label: id.toUpperCase(), unnamed: false });

describe("auctionOutcome", () => {
	const outcome = (solutions: AuctionSolution[]) =>
		auctionOutcome(auctionSolutions(snapshot(1, solutions), 1)!);

	it("measures a single winner against the best rival that passed the filter, or its tie", () => {
		assert.equal(
			outcome([
				{ solver: "a", score: 4.5783, winner: true },
				{ solver: "c", score: 4.5729 },
				{ solver: "b", score: 4.6, filteredOut: true },
			]),
			"single"
		);
		assert.equal(
			outcome([
				{ solver: "a", score: 2, winner: true },
				{ solver: "b", score: 2 },
			]),
			"singleTie"
		);
	});

	it("says no rival passed the filter only when it removed all other solvers' solutions", () => {
		assert.equal(
			outcome([
				{ solver: "a", score: 1, winner: true },
				{ solver: "b", score: 3, filteredOut: true },
				{ solver: "b", score: 2, filteredOut: true },
			]),
			"singleNoRival"
		);
		// The winner's own other solutions are not rivals.
		assert.equal(
			outcome([
				{ solver: "a", score: 1, winner: true },
				{ solver: "a", score: 0.9 },
			]),
			"singleOnly"
		);
		// A winning score of zero gives no gaps, though a rival passed the filter.
		assert.equal(
			outcome([
				{ solver: "a", score: 0, winner: true },
				{ solver: "b", score: 0 },
			]),
			"singleOnly"
		);
	});

	it("tells a lone winning solution, several winners and no winner apart", () => {
		assert.equal(outcome([{ solver: "a", score: 0.1048, winner: true }]), "oneSolution");
		assert.equal(
			outcome([
				{ solver: "a", score: 0.0194, winner: true },
				{ solver: "b", score: 0.0121, winner: true },
				{ solver: "c", score: 0.016 },
			]),
			"multi"
		);
		assert.equal(
			outcome([
				{ solver: "a", score: 1 },
				{ solver: "b", score: 0.5 },
			]),
			"none"
		);
	});
});

describe("filteredOutcome", () => {
	const winner: AuctionSolution = { solver: "w", score: 5, winner: true };
	const filtered = (...solutions: AuctionSolution[]) =>
		filteredOutcome(auctionSolutions(snapshot(1, [winner, ...solutions]), 1)!);

	it("names one solver's filtered-out solutions against all of its own", () => {
		assert.equal(filtered({ solver: "b", score: 4 }), null);
		assert.deepEqual(filtered({ solver: "b", score: 6, filteredOut: true }), {
			kind: "filteredOne",
			solvers: [ref("b")],
			count: 1,
			total: 1,
		});
		assert.deepEqual(
			filtered({ solver: "b", score: 4 }, { solver: "b", score: 6, filteredOut: true }),
			{ kind: "filteredSome", solvers: [ref("b")], count: 1, total: 2 }
		);
		assert.deepEqual(
			filtered(
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "b", score: 5.5, filteredOut: true }
			),
			{ kind: "filteredBoth", solvers: [ref("b")], count: 2, total: 2 }
		);
		assert.deepEqual(
			filtered(
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "b", score: 5.5, filteredOut: true },
				{ solver: "b", score: 5.2, filteredOut: true }
			),
			{ kind: "filteredAll", solvers: [ref("b")], count: 3, total: 3 }
		);
	});

	it("counts the solutions of several solvers together, in row order", () => {
		assert.deepEqual(
			filtered(
				{ solver: "c", score: 4 },
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "c", score: 5.5, filteredOut: true },
				{ solver: "b", score: 3, filteredOut: true }
			),
			{ kind: "filteredMany", solvers: [ref("c"), ref("b")], count: 3, total: 4 }
		);
	});
});

describe("solutionState", () => {
	const point = (fields: Partial<SolutionPoint>): SolutionPoint => ({
		score: 1,
		filteredOut: false,
		winner: false,
		gap: null,
		...fields,
	});

	it("says what a solution's Below winner shows", () => {
		assert.equal(solutionState(point({ winner: true })), "won");
		// A filtered-out solution can score above the winner; it still reads "Filtered out".
		assert.equal(solutionState(point({ filteredOut: true, gap: -0.2 })), "filtered");
		assert.equal(solutionState(point({ gap: 0 })), "same");
		assert.equal(solutionState(point({ gap: 0.0012 })), "gap");
		// Several winners: no gap to give.
		assert.equal(solutionState(point({})), "none");
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
