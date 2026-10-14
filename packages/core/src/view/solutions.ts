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
	/**
	 * Its solutions in CoW's ranking, which puts the winning ones first; the first, its best, gives
	 * the row's figures, so a winner's row shows its winning solution.
	 */
	solutions: SolutionPoint[];
	/**
	 * With several winners, a winner's best score when another of its solutions scored higher
	 * than the winning one; null otherwise.
	 */
	bestScore: number | null;
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
	 * One row per solver. With one winning solution, in the order of its best solution in CoW's
	 * ranking: the winner, then the others by score, then the filtered-out ones. With several,
	 * the winners by their winning solution's score, then the others by their best's: a
	 * filtered-out solution counts by its score there, as nothing is measured against a winner.
	 */
	rows: SolutionsRow[];
	/**
	 * With several winning solutions, how many of the rows won, when some did not: those come
	 * first, under the sub-head Won, and the rest under Did not win. Null without sub-heads: one
	 * winning solution, or every solver won.
	 */
	wonRows: number | null;
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
			row = { ...refOf(solution.solver), solutions: [], bestScore: null };
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
	let ordered = [...rows.values()];
	let wonRows: number | null = null;
	// Several winners settle different orders, so CoW's ranking reads as one list it is not: the
	// solvers that won come first, then the others, each by the score its row shows. A winner can
	// have scored higher with a solution that did not win; its row gives that too.
	if (winning.length > 1) {
		const won = ordered.filter((row) => row.solutions.some((s) => s.winner)).sort(byScore);
		const lost = ordered.filter((row) => !row.solutions.some((s) => s.winner)).sort(byScore);
		for (const row of won) {
			const score = row.solutions[0]!.score;
			const top = Math.max(...row.solutions.map((s) => s.score ?? -Infinity));
			if (score !== null && top > score) row.bestScore = top;
		}
		ordered = [...won, ...lost];
		wonRows = lost.length > 0 ? won.length : null;
	}
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
		wonRows,
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

/** Rows by the score they show, highest first, and those without one last; ties keep their order. */
function byScore(a: SolutionsRow, b: SolutionsRow): number {
	const x = a.solutions[0]!.score;
	const y = b.solutions[0]!.score;
	if (x === y) return 0;
	if (x === null) return 1;
	if (y === null) return -1;
	return y - x;
}

/**
 * Which of the solutions' sentences (`enter.solutions.<outcome>`) tells how the auction went: no
 * winner; a single solution, which won; one winner and how far below it the best rival scored,
 * or a tie; one winner whose rivals the filter all removed; one winner with no rival to measure
 * (only its own solutions, or no score to measure against); several winners, one solution each;
 * several winning solutions where a solver won with more than one, so the sentence names it once.
 */
export type AuctionOutcome =
	| "none"
	| "oneSolution"
	| "single"
	| "singleTie"
	| "singleNoRival"
	| "singleOnly"
	| "multi"
	| "multiSolutions";

export function auctionOutcome(auction: AuctionSolutions): AuctionOutcome {
	const { winners, rival } = auction;
	if (winners.length === 0) return "none";
	if (winners.length > 1) {
		const solvers = new Set(winners.map((w) => w.solver.id)).size;
		return solvers < winners.length ? "multiSolutions" : "multi";
	}
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
	 * more; one solver's one solution that scored above the winner, the only one of its solutions
	 * or one of several; or solutions from several solvers.
	 */
	kind:
		| "filteredOne"
		| "filteredSome"
		| "filteredBoth"
		| "filteredAll"
		| "filteredAbove"
		| "filteredMany";
	/** The solvers whose solutions it removed, in row order. */
	solvers: SolverRef[];
	/** The solutions it removed. */
	count: number;
	/** Every solution of those solvers. */
	total: number;
	/** How far above the winning score the one removed solution scored (`filteredAbove`). */
	above: number | null;
}

/** The filtered-out solutions as the sentence names them; null when the filter removed none. */
export function filteredOutcome(auction: AuctionSolutions): FilteredOutcome | null {
	const { filtered } = auction;
	const [first] = filtered;
	if (!first) return null;
	const count = filtered.reduce((sum, f) => sum + f.filtered, 0);
	const total = filtered.reduce((sum, f) => sum + f.solutions, 0);
	// A single removed solution that scored above the winner: the sentence says by how much.
	const removed =
		filtered.length === 1 && count === 1
			? auction.rows
					.find((row) => row.id === first.solver.id)
					?.solutions.find((s) => s.filteredOut)
			: undefined;
	const above = removed ? aboveWinner(removed) : null;
	const kind =
		filtered.length > 1
			? "filteredMany"
			: above !== null
				? "filteredAbove"
				: count < total
					? "filteredSome"
					: total === 1
						? "filteredOne"
						: total === 2
							? "filteredBoth"
							: "filteredAll";
	return { kind, solvers: filtered.map((f) => f.solver), count, total, above };
}

/**
 * What a solution's "Below winner" says: it won; the filter removed it, after it scored above the
 * single winning score or not; it matched that score; how far below it came; or nothing (several
 * winners, or no score).
 */
export type SolutionState = "won" | "filtered" | "above" | "same" | "gap" | "none";

export function solutionState(solution: SolutionPoint): SolutionState {
	if (solution.winner) return "won";
	if (solution.filteredOut) return aboveWinner(solution) === null ? "filtered" : "above";
	if (solution.gap === null) return "none";
	return solution.gap <= 0 ? "same" : "gap";
}

/**
 * How far above the single winning score a solution scored, a 0–1 ratio; null when it did not.
 * Only a filtered-out solution can: one that passed the filter with a higher score would have won.
 */
export function aboveWinner(solution: SolutionPoint): number | null {
	return solution.filteredOut && solution.gap !== null && solution.gap < 0 ? -solution.gap : null;
}

/** The log scale's left end, 0.01%: smaller gaps sit on it. */
const TRACK_LOW = 1e-4;

/**
 * Where a gap sits on the solutions' track: null for the anchor at its left edge, where a tie
 * and a score above the winner sit with the winning solution; otherwise on the log scale, from 0
 * (0.01% or less below the winning score) to 1 (100% below), one quarter per decade, since the
 * close races are the ones that matter.
 */
export function trackPosition(gap: number): number | null {
	if (gap <= 0) return null;
	const position = (Math.log10(Math.max(gap, TRACK_LOW)) - Math.log10(TRACK_LOW)) / 4;
	return Math.min(1, position);
}

/**
 * The track's anchor, in px from its left edge: half the 9px best solution's width, so a mark
 * there stays inside the track.
 */
export const TRACK_ANCHOR = 4.5;
/**
 * Where the track's log scale starts, at its 0.01% gridline, clear of the anchor's marks. Its
 * 100% end is `TRACK_ANCHOR` in from the right edge.
 */
export const TRACK_START = 20;

/** A place on a solutions' track `width` px wide (`trackPosition`), in px from its left edge. */
function trackX(position: number | null, width: number): number {
	if (position === null) return TRACK_ANCHOR;
	return TRACK_START + position * (width - TRACK_START - TRACK_ANCHOR);
}

/**
 * A mark on the solutions' track: its place (`trackPosition`, null on the anchor), its size in
 * px, and whether it stays on the centre line whatever it overlaps, as the row's best and the
 * winning solution do.
 */
export interface TrackMark {
	position: number | null;
	size: number;
	fixed: boolean;
}

/** The lanes a mark can take, in the order tried: the centre line, above it, below it. */
const TRACK_LANES = [0, -1, 1] as const;

/**
 * Lanes for one row's marks on the solutions' track, so marks that would overlap at this width
 * sit above and below each other instead of merging: two hollow rings a few px apart read as "∞".
 * The fixed marks take the centre line; then each other mark, in the order given, takes the first
 * lane where it keeps 1px clear of the marks already there. A mark with no room in any lane gets
 * none (null): it is not drawn, and the row counts it instead. Before the track is measured
 * (`width` 0), every mark is on the centre line.
 */
export function trackLanes(marks: readonly TrackMark[], width: number): (number | null)[] {
	if (width <= 0) return marks.map(() => 0);
	const placed = marks.flatMap(({ position, size, fixed }) =>
		fixed ? [{ x: trackX(position, width), radius: size / 2, lane: 0 }] : []
	);
	return marks.map(({ position, size, fixed }) => {
		if (fixed) return 0;
		const x = trackX(position, width);
		const radius = size / 2;
		const lane =
			TRACK_LANES.find((lane) =>
				placed.every(
					(mark) => mark.lane !== lane || Math.abs(mark.x - x) >= mark.radius + radius + 1
				)
			) ?? null;
		if (lane !== null) placed.push({ x, radius, lane });
		return lane;
	});
}
