import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuctionSolution, Snapshot, SnapshotSolver } from "../snapshot.ts";
import {
	aboveWinner,
	auctionOutcome,
	auctionSolutions,
	filteredOutcome,
	solutionState,
	trackLanes,
	trackPosition,
} from "./solutions.ts";
import type { SolutionPoint, TrackMark } from "./solutions.ts";

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

	it("puts several winners first and each group in score order, under sub-heads", () => {
		// #29,521,628, trimmed, and a filtered-out solution that CoW ranks last but that scored
		// above two others: with several winners nothing is measured against one, so it sorts by score.
		const s = snapshot(29_521_628, [
			{ solver: "nexroute", score: 0.0174203, winner: true },
			{ solver: "kaiser", score: 0.00130546, winner: true },
			{ solver: "helixbox", score: 0.0166384 },
			{ solver: "rosato", score: 0.0149391 },
			{ solver: "kaiser", score: 0.0134651 },
			{ solver: "kaiser", score: 0.0126354 },
			{ solver: "horadrim", score: 0.00875004 },
			{ solver: "baseline", score: 0.0155, filteredOut: true },
		]);
		const a = auctionSolutions(s, 29_521_628)!;
		assert.deepEqual(
			a.rows.map((r) => r.id),
			["nexroute", "kaiser", "helixbox", "baseline", "rosato", "horadrim"]
		);
		assert.equal(a.wonRows, 2);
		// Kaisersolver won with $0.00131 and scored $0.0135 with another solution: "best $0.0135".
		assert.deepEqual(
			a.rows.map((r) => r.bestScore),
			[null, 0.0134651, null, null, null, null]
		);
	});

	it("gives sub-heads only when some solver did not win", () => {
		// #29,521,720: Rizzolver won with two solutions, so Won holds its one row.
		const twice = auctionSolutions(
			snapshot(29_521_720, [
				{ solver: "rizzolver", score: 53.0278, winner: true },
				{ solver: "rizzolver", score: 0.615998, winner: true },
				{ solver: "sector", score: 51.2529 },
				{ solver: "kaiser", score: 50.7856 },
				{ solver: "kaiser", score: 35.0416 },
			]),
			29_521_720
		)!;
		assert.equal(twice.wonRows, 1);
		assert.deepEqual(
			twice.rows.map((r) => [r.id, r.solutions.length, r.bestScore]),
			[
				["rizzolver", 2, null],
				["sector", 1, null],
				["kaiser", 2, null],
			]
		);
		// #29,521,615: every solution won.
		const all = snapshot(29_521_615, [
			{ solver: "sector", score: 0.116631, winner: true },
			{ solver: "nexroute", score: 0.00748751, winner: true },
		]);
		assert.equal(auctionSolutions(all, 29_521_615)!.wonRows, null);
		// Every solver won, though one also scored higher with a solution that did not.
		const both = auctionSolutions(
			snapshot(4, [
				{ solver: "a", score: 2, winner: true },
				{ solver: "b", score: 1, winner: true },
				{ solver: "a", score: 3 },
			]),
			4
		)!;
		assert.equal(both.wonRows, null);
		assert.deepEqual(
			both.rows.map((r) => r.bestScore),
			[3, null]
		);
	});

	it("gives one winner's rows no sub-heads and no best", () => {
		const a = auctionSolutions(
			snapshot(5, [
				{ solver: "a", score: 2, winner: true },
				{ solver: "b", score: 1.5 },
				{ solver: "a", score: 2.5, filteredOut: true },
			]),
			5
		)!;
		assert.equal(a.wonRows, null);
		assert.deepEqual(
			a.rows.map((r) => r.bestScore),
			[null, null]
		);
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
		// A solver that won with two solutions, alone or next to another winner (Rizzolver twice in
		// #29,521,720 read "Rizzolver and Rizzolver won together").
		assert.equal(
			outcome([
				{ solver: "a", score: 53.0278, winner: true },
				{ solver: "a", score: 0.616, winner: true },
				{ solver: "b", score: 51.2529 },
			]),
			"multiSolutions"
		);
		assert.equal(
			outcome([
				{ solver: "a", score: 2, winner: true },
				{ solver: "b", score: 1, winner: true },
				{ solver: "a", score: 0.5, winner: true },
			]),
			"multiSolutions"
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
		assert.deepEqual(filtered({ solver: "b", score: 4, filteredOut: true }), {
			kind: "filteredOne",
			solvers: [ref("b")],
			count: 1,
			total: 1,
			above: null,
		});
		assert.deepEqual(
			filtered({ solver: "b", score: 4.5 }, { solver: "b", score: 4, filteredOut: true }),
			{ kind: "filteredSome", solvers: [ref("b")], count: 1, total: 2, above: null }
		);
		assert.deepEqual(
			filtered(
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "b", score: 5.5, filteredOut: true }
			),
			{ kind: "filteredBoth", solvers: [ref("b")], count: 2, total: 2, above: null }
		);
		assert.deepEqual(
			filtered(
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "b", score: 5.5, filteredOut: true },
				{ solver: "b", score: 5.2, filteredOut: true }
			),
			{ kind: "filteredAll", solvers: [ref("b")], count: 3, total: 3, above: null }
		);
	});

	it("says how far above the winner one removed solution scored", () => {
		// #29,521,759, trimmed: Arc won with $10.0613; Nexroute's $10.0722 is 0.11% above it.
		const s = snapshot(29_521_759, [
			{ solver: "arc", score: 10.0613, winner: true },
			{ solver: "rosato", score: 10.0601 },
			{ solver: "nexroute", score: 10.0722, filteredOut: true },
		]);
		const above = filteredOutcome(auctionSolutions(s, 29_521_759)!)!;
		assert.equal(above.kind, "filteredAbove");
		assert.deepEqual([above.solvers, above.count, above.total], [[ref("nexroute")], 1, 1]);
		assert.ok(Math.abs(above.above! - (10.0722 - 10.0613) / 10.0613) < 1e-12);
		// One of the solver's several solutions: "1 of B's 2 solutions scored 20% higher …".
		assert.deepEqual(
			filtered({ solver: "b", score: 4 }, { solver: "b", score: 6, filteredOut: true }),
			{ kind: "filteredAbove", solvers: [ref("b")], count: 1, total: 2, above: 0.2 }
		);
		// Two removed solutions keep the sentences that count them, above the winner or not.
		assert.equal(
			filtered(
				{ solver: "b", score: 6, filteredOut: true },
				{ solver: "b", score: 4, filteredOut: true }
			)?.kind,
			"filteredBoth"
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
			{ kind: "filteredMany", solvers: [ref("c"), ref("b")], count: 3, total: 4, above: null }
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
		assert.equal(solutionState(point({ filteredOut: true, gap: 0.1 })), "filtered");
		// Only a filtered-out solution can score above the winner: "Filtered out · 20% above".
		assert.equal(solutionState(point({ filteredOut: true, gap: -0.2 })), "above");
		assert.equal(solutionState(point({ gap: 0 })), "same");
		assert.equal(solutionState(point({ gap: 0.0012 })), "gap");
		// Several winners: no gap to give.
		assert.equal(solutionState(point({})), "none");
		assert.equal(solutionState(point({ filteredOut: true })), "filtered");
	});

	it("measures how far above the winner a filtered-out solution scored", () => {
		assert.equal(aboveWinner(point({ filteredOut: true, gap: -0.2 })), 0.2);
		assert.equal(aboveWinner(point({ filteredOut: true, gap: 0.1 })), null);
		assert.equal(aboveWinner(point({ gap: -0.2 })), null);
	});
});

describe("trackPosition", () => {
	it("places gaps on a log scale from 0.01% to 100%, a quarter per decade", () => {
		assert.equal(trackPosition(0.0001), 0);
		assert.equal(trackPosition(0.01), 0.5);
		assert.equal(trackPosition(1), 1);
		assert.ok(Math.abs(trackPosition(0.001)! - 0.25) < 1e-12);
		// Gaps under 0.01% sit on its gridline.
		assert.equal(trackPosition(0.00002), 0);
	});

	it("puts ties and scores above the winner on the anchor, with the winning solution", () => {
		assert.equal(trackPosition(0), null);
		assert.equal(trackPosition(-0.2), null);
	});
});

describe("trackLanes", () => {
	const mark = (position: number | null, size = 5, fixed = false): TrackMark => ({
		position,
		size,
		fixed,
	});

	it("keeps marks that don't touch on the centre line", () => {
		const marks = [mark(0.1, 9, true), mark(0.5), mark(0.52)];
		assert.deepEqual(trackLanes(marks, 400), [0, 0, 0]);
	});

	it("moves a mark that would overlap above, then below, the fixed ones staying put", () => {
		// Two hollow rings 4px apart (Kaisersolver's 61% and 64% in #29,521,541) drew an "∞".
		assert.deepEqual(
			trackLanes([mark(0.2, 9, true), mark(0.94), mark(0.945)], 800),
			[0, 0, -1]
		);
		// Next to a 9px best, a 5px mark needs 8px; a third goes below; a fourth has no room left
		// and is not drawn.
		const crowded = [mark(0.5, 9, true), mark(0.505), mark(0.51), mark(0.5)];
		assert.deepEqual(trackLanes(crowded, 400), [0, -1, 1, null]);
		// The fixed marks are placed first, wherever they come.
		assert.deepEqual(trackLanes([mark(0.5), mark(0.5, 9, true)], 400), [-1, 0]);
	});

	it("keeps the anchor apart from the log scale's start", () => {
		// The winning square on the anchor; a tie with it moves up; the 0.01% gridline is 15.5px
		// away, clear of the square.
		assert.deepEqual(trackLanes([mark(null, 8, true), mark(null), mark(0)], 400), [0, -1, 0]);
	});

	it("leaves out the marks no lane has room for", () => {
		// #29,521,619, trimmed: four of Kaisersolver's six solutions less than 1px apart. The
		// fourth has no lane left, so the row reads "+1".
		const s = snapshot(29_521_619, [
			{ solver: "kipseli", score: 24.8886, winner: true },
			{ solver: "kaiser", score: 16.7572 },
			{ solver: "kaiser", score: 16.7522 },
			{ solver: "kaiser", score: 16.7221 },
			{ solver: "kaiser", score: 16.7021 },
			{ solver: "kaiser", score: 7.05637 },
			{ solver: "kaiser", score: 6.96783 },
		]);
		const row = auctionSolutions(s, 29_521_619)!.rows[1]!;
		const marks = row.solutions.map((solution, index) =>
			mark(trackPosition(solution.gap!), index === 0 ? 9 : 5, index === 0)
		);
		assert.deepEqual(trackLanes(marks, 758), [0, -1, 1, null, 0, -1]);
	});

	it("keeps every mark on the centre line until the track is measured", () => {
		assert.deepEqual(trackLanes([mark(0.5, 9, true), mark(0.5)], 0), [0, 0]);
	});
});
