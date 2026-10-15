"use client";

import { Fragment, useEffect, useState } from "react";

import { useTranslations } from "next-intl";

import {
	aboveWinner,
	auctionOutcome,
	auctionSolutions,
	filteredOutcome,
	solutionState,
	TRACK_ANCHOR,
	TRACK_START,
	trackLanes,
	trackPosition,
} from "@fiberscope/core";
import type { AuctionSolutions, SolutionsRow } from "@fiberscope/core";

import { useDashboard, useHover } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { arrow } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/**
 * Solver | track | Score | Below winner, on wide pages. Without a track (several winners, a lone
 * solution) its column stays empty, so the figures keep their place from one auction to the next.
 */
const WIDE_GRID = "grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_84px_104px] gap-4";
/** Solver | Score | Below: compact pages leave the track out. */
const COMPACT_GRID = "grid grid-cols-[minmax(0,1fr)_70px_88px] gap-2";
/**
 * How far above or below the centre line a mark moves when it would overlap another
 * (`trackLanes`): a 5px mark then clears a 9px one by 1px and stays inside the 31px row.
 */
const LANE_PX = 8;
/** The track's gridlines, one per decade of its log scale: 0.01%, 0.1%, 1% and 10%. */
const GRIDLINES = {
	backgroundImage: "repeating-linear-gradient(90deg,var(--ln) 0 1px,transparent 1px 25%)",
	backgroundSize: `calc(100% - ${TRACK_START + TRACK_ANCHOR}px) 100%`,
	backgroundPosition: `${TRACK_START}px 0`,
	backgroundRepeat: "no-repeat",
};

/**
 * A place on the track (`trackPosition`, null for the anchor) as a CSS length: the anchor, or the
 * log scale from its 0.01% gridline to 100%, `TRACK_ANCHOR` in from the right edge.
 */
function trackLeft(position: number | null): string {
	return position === null
		? `${TRACK_ANCHOR}px`
		: `calc(${TRACK_START}px + (100% - ${TRACK_START + TRACK_ANCHOR}px) * ${position})`;
}

/**
 * The solutions of the auction selected on the tape: a sentence, then one row per solver, with
 * its best solution's score, how far below the winning score it came and a log track with all
 * of the solver's solutions. Several winners settle different orders, so they get scores without
 * gaps or track, the solvers that won apart from those that did not; a lone solution has nothing
 * to plot, and compact pages leave the track out. Close or Escape closes them.
 */
export function Solutions({
	id,
	compact,
	rankIndex,
	onClose,
}: {
	/** The open auction, one of the tape's; null while the solutions are closed. */
	id: number | null;
	compact: boolean;
	rankIndex: Map<string, number>;
	onClose: () => void;
}) {
	const t = useTranslations("Enter.solutions");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { network, snapshot } = useDashboard();

	const auction = id === null ? null : auctionSolutions(snapshot!, id);
	const sentence = useSentence(auction);
	// CoW Explorer and Close: 24px tall from offset padding on wide pages, at least 44px square
	// on compact ones.
	const hit = compact ? "min-h-11 min-w-11 justify-center" : "-my-1 py-1";
	// CoW Explorer opens the settlement of the first winner that settled.
	const href = auction?.tx
		? `https://explorer.cow.fi/${network.explorerSlug}/tx/${auction.tx}`
		: null;

	return (
		<div
			id="fs-solutions"
			role={auction ? "region" : undefined}
			aria-label={auction ? t("label", { id: f.int(auction.id) }) : undefined}
			onKeyDown={(event) => {
				// Escape anywhere in the solutions closes them, as Close does.
				if (event.key === "Escape" && auction) {
					event.preventDefault();
					onClose();
				}
			}}
			className={auction ? "mt-7 border-t border-ln2 pt-3.5" : undefined}
		>
			{auction ? (
				<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
						<h3 className="text-[15px] font-medium">{t("title")}</h3>
						<span className="font-mono text-[12px] leading-[normal] font-medium whitespace-nowrap text-mu">
							{t("heading", { id: f.int(auction.id), time: f.clock(auction.time) })}
						</span>
					</div>
					<div className="flex gap-5 font-mono text-[12px] leading-[normal] font-medium">
						{href ? (
							<a
								href={href}
								target="_blank"
								rel="noopener"
								className={`inline-flex items-center whitespace-nowrap quiet ${hit}`}
							>
								{tc.rich("cowExplorer", { arrow })}
							</a>
						) : null}
						<button
							type="button"
							onClick={onClose}
							className={`inline-flex items-center quiet ${hit}`}
						>
							{t("close")}
						</button>
					</div>
				</div>
			) : null}
			{/*
			 * The sentence is the solutions' live region, so it stays mounted, empty, while they are
			 * closed: a region that arrives with its text is not read out, one that fills is.
			 */}
			<p
				aria-live="polite"
				className={
					auction
						? "mt-2 max-w-[720px] text-[15px] leading-[1.55] text-pretty text-mu"
						: undefined
				}
			>
				{sentence}
			</p>
			{auction ? (
				<SolutionsTable auction={auction} compact={compact} rankIndex={rankIndex} />
			) : null}
		</div>
	);
}

/**
 * How the auction went: its solutions and solvers, the winner and its score, how far below it the
 * best rival scored or who tied it, and the solutions the fairness filter removed, with how far
 * above the winner one scored when it did.
 */
function useSentence(auction: AuctionSolutions | null): string | null {
	const t = useTranslations("Enter.solutions");
	const f = useFormat();
	if (!auction) return null;

	const [winner] = auction.winners;
	// A solver can win with more than one solution; the sentence names it once.
	const winning = [
		...new Map(auction.winners.map((w) => [w.solver.id, w.solver.label])).values(),
	];
	const removed = filteredOutcome(auction);
	// Prose words a bound: the best rival scored "less than 0.01%" lower, not "<0.01%".
	const gap = f.gap(auction.rival?.gap ?? null);
	const bound = gap.startsWith("<") ? "below" : gap.startsWith(">") ? "above" : "none";
	const above = f.gap(removed?.above ?? null);
	return [
		// Each outcome's sentence takes what it says from the same values.
		t(auctionOutcome(auction), {
			head: t("head", {
				solutions: auction.solutions,
				solvers: auction.solvers,
				solver: auction.rows[0]?.label ?? "",
			}),
			winner: winner?.solver.label ?? "",
			// Without a score, a winner just won.
			scored: auction.winners.every((w) => w.score !== null) ? "yes" : "no",
			score: f.score(winner?.score ?? null),
			rival: auction.rival?.solver.label ?? "",
			bound,
			gap: bound === "none" ? gap : gap.slice(1),
			ties: auction.ties.length,
			rivals: f.list(auction.ties.map((solver) => t("possessive", { solver: solver.label }))),
			winners: f.list(winning),
			winningSolvers: winning.length,
			wins: auction.winners.length,
			// With every solution a winner, no losing solution needs explaining.
			losers: auction.solutions > auction.winners.length ? "yes" : "no",
			scores: f.list(auction.winners.map((w) => f.score(w.score))),
		}),
		removed
			? t(removed.kind, {
					solver: removed.solvers[0].label,
					solvers: f.list(removed.solvers.map((solver) => solver.label)),
					count: removed.count,
					total: removed.total,
					// A removed solution that scored above the winner: "less than 0.01%" higher.
					bound: above.startsWith("<") ? "below" : "none",
					gap: above.startsWith("<") ? above.slice(1) : above,
				})
			: null,
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * The legend, one row per solver with its best solution's score and gap and, on the track, all of
 * its solutions, then the axis and the note. With several winners, the rows that won come first,
 * under Won, the others under Did not win.
 */
function SolutionsTable({
	auction,
	compact,
	rankIndex,
}: {
	auction: AuctionSolutions;
	compact: boolean;
	rankIndex: Map<string, number>;
}) {
	const t = useTranslations("Enter.solutions");
	const f = useFormat();
	const { network } = useDashboard();
	const { hovered, setHovered } = useHover();

	// The track plots the gaps below a single winning score, on wide pages: a lone solution has
	// none to plot.
	const track = auction.single && auction.solutions > 1 && !compact;
	const grid = compact ? COMPACT_GRID : WIDE_GRID;
	// Without a track, the figures skip its empty column on wide pages.
	const figures = !compact && !track ? "col-start-3" : "";
	const [trackWidth, trackRef] = useWidth();
	// A filtered-out solution that scored above the winner is marked "‹" on the track.
	const above =
		track && auction.rows.some((row) => row.solutions.some((s) => aboveWinner(s) !== null));

	return (
		<>
			{track ? (
				<div className="mt-[18px] flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] leading-[normal] font-medium text-mu">
					<span className="flex items-center gap-2">
						<span className="size-2 rounded-[2px] bg-fg" />
						{t("legend.won")}
					</span>
					<span className="flex items-center gap-2">
						<span className="size-[9px] rounded-full bg-fg" />
						{t("legend.best")}
					</span>
					<span className="flex items-center gap-2">
						<span className="size-[5px] rounded-full bg-fg/50" />
						{t("legend.others")}
					</span>
					<span className="flex items-center gap-2">
						<span className="size-[9px] rounded-full border-[1.5px] border-fg" />
						{t("legend.filtered")}
					</span>
					{above ? (
						<span className="flex items-center gap-2">
							<span aria-hidden="true" className="text-[13px] text-fa">
								‹
							</span>
							{t("legend.above")}
						</span>
					) : null}
				</div>
			) : null}
			<div className="mt-3.5 tabular-nums">
				{/* A table to assistive tech, as the leaderboard: each figure goes with its column. */}
				<div role="table" aria-label={t("title")}>
					<div role="row" className={`${grid} items-end pb-2 label`}>
						<span role="columnheader">{t("columns.solver")}</span>
						{track ? <span role="columnheader">{t("columns.track")}</span> : null}
						<span role="columnheader" className={`text-right ${figures}`}>
							{t("columns.score")}
						</span>
						<span role="columnheader" className="text-right">
							{t(compact ? "columns.belowShort" : "columns.below")}
						</span>
					</div>
					{auction.rows.map((row, index) => {
						// The row's figures are its first solution's in CoW's ranking: its best, or
						// the winning one.
						const [first] = row.solutions;
						const state = solutionState(first);
						const hot = isHot(hovered, row.id, rankIndex.get(row.id) ?? -1);
						return (
							<Fragment key={row.id}>
								{auction.wonRows !== null &&
								(index === 0 || index === auction.wonRows) ? (
									<div
										role="row"
										className="border-t border-ln pt-3.5 pb-1.5 font-mono text-[10.5px] leading-[normal] font-medium tracking-[.06em] text-mu uppercase"
									>
										<span role="cell">
											{t(index === 0 ? "groups.won" : "groups.lost")}
										</span>
									</div>
								) : null}
								<div
									role="row"
									onMouseEnter={() => setHovered(row.id)}
									onMouseLeave={() => setHovered(null)}
									className={`${grid} min-h-[31px] items-center border-t border-ln`}
								>
									<span role="cell" className="flex min-w-0 items-baseline gap-2">
										<span
											title={row.label}
											className={`truncate text-[13.5px] font-medium transition-colors duration-200 ${row.unnamed ? "font-mono" : ""} ${hot ? "text-hvt" : ""}`}
										>
											{row.label}
										</span>
										{row.solutions.length > 1 ? (
											<span className="flex-none font-mono text-[11px] leading-[normal] font-medium text-mu">
												{t("count", { count: row.solutions.length })}
											</span>
										) : null}
									</span>
									{track ? (
										<Track row={row} hot={hot} width={trackWidth} />
									) : null}
									<span
										role="cell"
										className={`text-right font-mono text-[12.5px] leading-[normal] font-medium ${figures} ${first.filteredOut ? "text-mu" : ""}`}
									>
										{f.score(first.score)}
										{/* A winner that scored higher with a solution that did not win. */}
										{row.bestScore !== null ? (
											<span className="block text-[11px] text-mu">
												{t("value.best", { score: f.score(row.bestScore) })}
											</span>
										) : null}
									</span>
									{/*
									 * "—" where no gap is given: several winners, or no score. Above the
									 * winner, two items that wrap as a list: each "·" sits in its item's
									 * 14px ::after, and the list ends 14px past the clipped edge, so no
									 * line ends in one.
									 */}
									<span
										role="cell"
										className={`text-right font-mono leading-[normal] font-medium whitespace-nowrap ${compact ? "text-[11.5px]" : "text-[12.5px]"} ${first.filteredOut || state === "none" ? "text-mu" : ""}`}
									>
										{state === "above" ? (
											<span className="block overflow-x-clip">
												<span className="-mr-3.5 flex flex-wrap justify-end">
													{[
														t("value.filtered"),
														t("value.above", {
															gap: f.gap(aboveWinner(first)),
														}),
													].map((item) => (
														<span
															key={item}
															className="after:inline-block after:w-3.5 after:text-center after:content-['·']"
														>
															{item}
														</span>
													))}
												</span>
											</span>
										) : state === "gap" || state === "none" ? (
											f.gap(first.gap)
										) : (
											t(`value.${state}`)
										)}
									</span>
								</div>
							</Fragment>
						);
					})}
				</div>
				{/* The track cells say where each solution sits in words, so the axis is not read out. */}
				{track ? (
					<div
						aria-hidden="true"
						className={`${grid} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
					>
						<span />
						{/* Each decade's label is centred on its gridline; 100% ends the track. */}
						<span ref={trackRef} className="relative h-3.5">
							{(["a", "b", "c", "d"] as const).map((key, decade) => (
								<span
									key={key}
									className="absolute -translate-x-1/2"
									style={{ left: trackLeft(decade / 4) }}
								>
									{t(`axis.${key}`)}
								</span>
							))}
							<span className="absolute right-0">{t("axis.e")}</span>
						</span>
						<span />
						<span />
					</div>
				) : (
					<div className="border-t border-ln2" />
				)}
			</div>
			<p className="mt-3 foot-line">
				{compact
					? t("noteCompact")
					: t("note", { native: network.native.symbol, track: track ? "yes" : "no" })}
			</p>
		</>
	);
}

/**
 * A solver's solutions on the log track below the winning score: the winning one an 8px square
 * on the anchor at the left end, its best a 9px dot, its others 5px dots at 50%; filtered-out
 * ones hollow. A tie and a score above the winner sit on the anchor too, the latter marked "‹"
 * outside the track. Marks that would overlap at the track's `width` move above or below the
 * centre line (`trackLanes`); those with no room left are counted in a "+N" instead.
 */
function Track({ row, hot, width }: { row: SolutionsRow; hot: boolean; width: number }) {
	const t = useTranslations("Enter.solutions");
	const f = useFormat();
	// The solutions with a place on the track, in CoW's ranking, with their size in px as drawn
	// below. The winning solution and the row's best stay on the centre line. A solution without
	// a score has no place.
	const marks = row.solutions.flatMap((solution, index) => {
		const best = index === 0;
		if (solution.winner) return [{ solution, best, position: null, size: 8, fixed: true }];
		if (solution.gap === null) return [];
		return [
			{
				solution,
				best,
				position: trackPosition(solution.gap),
				size: best ? 9 : 5,
				fixed: best,
			},
		];
	});
	const lanes = trackLanes(marks, width);
	const skipped = marks.filter((_, index) => lanes[index] === null);
	// "+N" follows the rightmost of the marks left out; the anchor is the track's left end.
	const rightmost = skipped.reduce<number | null>(
		(max, { position }) =>
			position !== null && (max === null || position > max) ? position : max,
		null
	);

	return (
		<span role="cell" className="flex self-stretch">
			<span
				role="img"
				aria-label={t("dot", {
					solver: row.label,
					solutions: row.solutions
						.map((solution) =>
							t("dotItem", {
								score: f.score(solution.score),
								state: solutionState(solution),
								gap: f.gap(aboveWinner(solution) ?? solution.gap),
							})
						)
						.join("; "),
				})}
				className="relative flex-1"
				style={GRIDLINES}
			>
				{marks.map(({ solution, best, position }, index) => {
					const lane = lanes[index];
					if (lane === null) return null;
					const place = {
						left: trackLeft(position),
						top: `calc(50% + ${lane * LANE_PX}px)`,
					};
					if (solution.winner) {
						return (
							<span
								key={index}
								className={`absolute z-2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] transition-colors duration-200 ${hot ? "bg-teal" : "bg-fg"}`}
								style={place}
							/>
						);
					}
					const look = solution.filteredOut
						? `bg-bg ${best ? "border-[1.5px]" : "border"} ${hot ? "border-teal" : "border-fg"}`
						: best
							? hot
								? "bg-teal"
								: "bg-fg"
							: "bg-fg/50";
					return (
						<span
							key={index}
							className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${best ? "z-1 size-[9px]" : "size-[5px]"} ${look}`}
							style={place}
						/>
					);
				})}
				{/* Outside the track's left end, as "›" marks a value past an axis's end. */}
				{row.solutions.some((s) => aboveWinner(s) !== null) ? (
					<span
						aria-hidden="true"
						className="absolute top-1/2 right-full -translate-x-[3px] -translate-y-[52%] font-mono text-[13px] leading-[normal] font-medium text-fa"
					>
						‹
					</span>
				) : null}
				{skipped.length > 0 ? (
					<span
						aria-hidden="true"
						className="absolute top-1/2 -translate-y-1/2 font-mono text-[10px] leading-[normal] font-medium text-mu"
						style={{ left: `calc(${trackLeft(rightmost)} + 7px)` }}
					>
						{t("more", { count: skipped.length })}
					</span>
				) : null}
			</span>
		</span>
	);
}

/** The width of an element, followed through resizes: attach `ref` to it. 0 until measured. */
function useWidth(): [number, (node: HTMLElement | null) => void] {
	const [node, ref] = useState<HTMLElement | null>(null);
	const [width, setWidth] = useState(0);

	useEffect(() => {
		if (!node) return;
		// The observer also measures once when it starts.
		const observer = new ResizeObserver(() => setWidth(node.clientWidth));
		observer.observe(node);
		return () => observer.disconnect();
	}, [node]);

	return [width, ref];
}
