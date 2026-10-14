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
	/**
	 * The settlement of the first winner that settled; null when none did. A winner that never
	 * settled has no transaction, though a co-winner's may.
	 */
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
	/**
	 * The other solvers whose best solution passed the filter with the winning score, in row
	 * order; empty unless `single`.
	 */
	ties: SolverRef[];
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
		tx: auction.winners.find((w) => w.tx !== null)?.tx ?? null,
		solutions: auction.solutions.length,
		solvers: ordered.length,
		winners: winning.map((s) => ({ solver: refOf(s.solver), score: s.score })),
		single: best !== null,
		rows: ordered,
		rival: rival && rivalGap !== null ? { solver: refOf(rival.id), gap: rivalGap } : null,
		ties: ordered
			.filter((row) => solutionState(row.solutions[0]!) === "same")
			.map((row) => refOf(row.id)),
		filtered: ordered
			.map((row) => ({
				solver: refOf(row.id),
				filtered: row.solutions.filter((s) => s.filteredOut).length,
				solutions: row.solutions.length,
			}))
			.filter((f) => f.filtered > 0),
	};
}

/**
 * Which of the solutions' sentences (`enter.solutions.<outcome>`) tells how the auction went: no
 * winner; a single solution, which won; one winner and how far below it the best rival scored,
 * or a tie; one winner whose rivals the filter all removed; one winner with no rival to measure
 * (only its own solutions, or no score to measure against); several winners.
 */
export type AuctionOutcome =
	"none" | "oneSolution" | "single" | "singleTie" | "singleNoRival" | "singleOnly" | "multi";

export function auctionOutcome(auction: AuctionSolutions): AuctionOutcome {
	const { winners, rival } = auction;
	if (winners.length === 0) return "none";
	if (winners.length > 1) return "multi";
	if (auction.solutions === 1) return "oneSolution";
	if (rival) return rival.gap <= 0 ? "singleTie" : "single";
	// No rival: either the filter removed every other solver's solutions, or there is nothing to
	// say about them.
	const others = auction.rows.filter((row) => !row.solutions.some((s) => s.winner));
	return others.length > 0 && others.every((row) => row.solutions.every((s) => s.filteredOut))
		? "singleNoRival"
		: "singleOnly";
}

/**
 * How the solutions' sentence (`enter.solutions.<kind>`) names the solutions the fairness filter
 * removed.
 */
export interface FilteredOutcome {
	/**
	 * One solver's only solution, some of its solutions, both of its two or all of its three or
	 * more; or solutions from several solvers.
	 */
	kind: "filteredOne" | "filteredSome" | "filteredBoth" | "filteredAll" | "filteredMany";
	/** The solvers whose solutions it removed, in row order. */
	solvers: SolverRef[];
	/** The solutions it removed. */
	count: number;
	/** Every solution of those solvers. */
	total: number;
}

/** The filtered-out solutions as the sentence names them; null when the filter removed none. */
export function filteredOutcome(auction: AuctionSolutions): FilteredOutcome | null {
	const { filtered } = auction;
	if (filtered.length === 0) return null;
	const count = filtered.reduce((sum, f) => sum + f.filtered, 0);
	const total = filtered.reduce((sum, f) => sum + f.solutions, 0);
	const kind =
		filtered.length > 1
			? "filteredMany"
			: count < total
				? "filteredSome"
				: total === 1
					? "filteredOne"
					: total === 2
						? "filteredBoth"
						: "filteredAll";
	return { kind, solvers: filtered.map((f) => f.solver), count, total };
}

/**
 * What a solution's "Below winner" says: it won, the filter removed it, it matched the single
 * winning score, how far below that score it came, or nothing (several winners, or no score).
 */
export type SolutionState = "won" | "filtered" | "same" | "gap" | "none";

export function solutionState(solution: SolutionPoint): SolutionState {
	if (solution.winner) return "won";
	if (solution.filteredOut) return "filtered";
	if (solution.gap === null) return "none";
	return solution.gap <= 0 ? "same" : "gap";
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

/** A mark on the solutions' track: where it sits (0–1, `trackPosition`) and its size in px. */
export interface TrackMark {
	position: number;
	size: number;
}

/** The lanes a mark can take, in the order tried: the centre line, above it, below it. */
const TRACK_LANES = [0, -1, 1] as const;

/**
 * Lanes for one row's marks on the solutions' track, so marks that would overlap at this width
 * sit above and below each other instead of merging: two hollow rings a few px apart read as "∞".
 * Each mark, in the order given (the row's best first), takes the first lane where it keeps 1px
 * clear of the marks already there, and stays on the centre line when no lane has room. Before the
 * track is measured (`width` 0), every mark is on the centre line.
 */
export function trackLanes(marks: readonly TrackMark[], width: number): number[] {
	if (width <= 0) return marks.map(() => 0);
	const placed: { x: number; radius: number; lane: number }[] = [];
	return marks.map(({ position, size }) => {
		const x = position * width;
		const radius = size / 2;
		const lane =
			TRACK_LANES.find((lane) =>
				placed.every(
					(mark) => mark.lane !== lane || Math.abs(mark.x - x) >= mark.radius + radius + 1
				)
			) ?? 0;
		placed.push({ x, radius, lane });
		return lane;
	});
}
