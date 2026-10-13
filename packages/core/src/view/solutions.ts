import { shortAddress } from "../format.ts";
import type { Snapshot } from "../snapshot.ts";
import { solverRef } from "./view.ts";
import type { SolverRef } from "./view.ts";

/**
 * Inside one of the latest auctions: every solution, by solver, against the winning score.
 * Scores are in USD at the auction's ETH/USD rate.
 */
export interface SolutionPoint {
	/** USD; null when CoW's API gave none. */
	score: number | null;
	filteredOut: boolean;
	winner: boolean;
	/**
	 * How far below the winning score, (winning score − score) ÷ winning score, a 0–1 ratio; null
	 * for the winning solution and in auctions without a single winner. Negative when a
	 * filtered-out solution scored above the winner.
	 */
	gap: number | null;
}

export interface SolutionsRow extends SolverRef {
	/** Its solutions in CoW's ranking; the first, its best, gives the row's figures. */
	solutions: SolutionPoint[];
}

export interface AuctionSolutions {
	id: number;
	/** The auction's start (Unix ms). */
	time: number;
	/** The first winner's settlement; null when none settled. */
	tx: string | null;
	/** Solutions in the auction. */
	solutions: number;
	/** Solvers that submitted them. */
	solvers: number;
	/** The winning solutions, in CoW's ranking. */
	winners: { solver: SolverRef; score: number | null }[];
	/**
	 * One winning solution, with a score above zero: the rows show how far below it they came.
	 * With several winners, a losing solution competed only with the winner whose orders it
	 * would also have settled, which the scores do not say, so there are no gaps.
	 */
	single: boolean;
	/**
	 * One row per solver, in the order of its best solution in CoW's ranking: the winners, then
	 * the others by score, then the filtered-out ones.
	 */
	rows: SolutionsRow[];
	/** The best solution from another solver that passed the filter; only when `single`. */
	rival: { solver: SolverRef; gap: number } | null;
	/** The solvers with filtered-out solutions, in row order. */
	filtered: { solver: SolverRef; filtered: number; solutions: number }[];
}

/** The solutions of one of `snapshot.latestAuctions`; null when it is not among them. */
export function auctionSolutions(snapshot: Snapshot, id: number): AuctionSolutions | null {
	const auction = snapshot.latestAuctions.find((a) => a.id === id);
	if (!auction) return null;
	const refs = new Map(snapshot.solvers.map((s) => [s.id, solverRef(s)]));
	const refOf = (solver: string): SolverRef =>
		refs.get(solver) ?? { id: solver, label: shortAddress(solver), unnamed: true };

	const winning = auction.solutions.filter((s) => s.winner);
	// Gaps are measured against a single winning score above zero.
	const only = winning.length === 1 ? (winning[0]?.score ?? null) : null;
	const best = only !== null && only > 0 ? only : null;
	const rows = new Map<string, SolutionsRow>();
	for (const solution of auction.solutions) {
		let row = rows.get(solution.solver);
		if (!row) {
			row = { ...refOf(solution.solver), solutions: [] };
			rows.set(solution.solver, row);
		}
		const winner = solution.winner === true;
		row.solutions.push({
			score: solution.score,
			filteredOut: solution.filteredOut === true,
			winner,
			gap:
				best !== null && !winner && solution.score !== null
					? (best - solution.score) / best
					: null,
		});
	}
	const ordered = [...rows.values()];
	const rival =
		best !== null
			? ordered.find((row) => !row.solutions[0]!.winner && !row.solutions[0]!.filteredOut)
			: undefined;
	const rivalGap = rival?.solutions[0]?.gap ?? null;
	return {
		id: auction.id,
		time: auction.time,
		tx: auction.winners[0]?.tx ?? null,
		solutions: auction.solutions.length,
		solvers: ordered.length,
		winners: winning.map((s) => ({ solver: refOf(s.solver), score: s.score })),
		single: best !== null,
		rows: ordered,
		rival: rival && rivalGap !== null ? { solver: refOf(rival.id), gap: rivalGap } : null,
		filtered: ordered
			.map((row) => ({
				solver: refOf(row.id),
				filtered: row.solutions.filter((s) => s.filteredOut).length,
				solutions: row.solutions.length,
			}))
			.filter((f) => f.filtered > 0),
	};
}

/** The track's left end: gaps of 0.01% or less, ties and scores above the winner sit there. */
const TRACK_LOW = 1e-4;

/**
 * Where a gap sits on the solutions' track, from 0 (0.01% or less below the winning score) to 1
 * (100% below): a log scale, one quarter per decade, since the close races are the ones that
 * matter.
 */
export function trackPosition(gap: number): number {
	const position = (Math.log10(Math.max(gap, TRACK_LOW)) - Math.log10(TRACK_LOW)) / 4;
	return Math.min(1, position);
}
