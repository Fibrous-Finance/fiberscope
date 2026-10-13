"use client";

import { useTranslations } from "next-intl";

import {
	auctionOutcome,
	auctionSolutions,
	filteredOutcome,
	NETWORKS,
	solutionState,
	trackPosition,
} from "@fiberscope/core";
import type { SolutionsRow } from "@fiberscope/core";

import { useDashboard, useHover } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { arrow } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Solver | track | Score | Below winner: the gaps to a single winner, on wide pages. */
const TRACK_GRID = "grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_84px_104px] gap-4";
/** Solver | Score | Below winner: several winners leave no gaps to plot. */
const FLAT_GRID = "grid grid-cols-[clamp(96px,16vw,190px)_84px_104px] gap-4";
/** Solver | Score | Below: compact pages leave the track out. */
const COMPACT_GRID = "grid grid-cols-[minmax(0,1fr)_70px_88px] gap-2";

/**
 * The solutions of the auction selected on the tape: a sentence, then one row per solver, in the
 * order of its best solution in CoW's ranking, with that solution's score, how far below the
 * winning score it came and a log track with all of the solver's solutions. Several winners
 * settle different orders, so they get scores without gaps or track; compact pages leave the
 * track out.
 */
export function Solutions({
	id,
	compact,
	rankIndex,
	onClose,
}: {
	/** The auction, one of the tape's. */
	id: number;
	compact: boolean;
	rankIndex: Map<string, number>;
	onClose: () => void;
}) {
	const t = useTranslations("Enter.solutions");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { snapshot } = useDashboard();
	const { hovered, setHovered } = useHover();

	const auction = auctionSolutions(snapshot!, id);
	if (!auction) return null;

	// The track plots the gaps below a single winning score, on wide pages.
	const track = auction.single && !compact;
	const grid = compact ? COMPACT_GRID : track ? TRACK_GRID : FLAT_GRID;
	// CoW Explorer and Close: 24px tall from offset padding on wide pages, 44px on compact ones.
	const hit = compact ? "min-h-11" : "-my-1 py-1";
	// CoW Explorer opens the first winner's settlement.
	const href = auction.tx
		? `https://explorer.cow.fi/${NETWORKS[snapshot!.network].explorerSlug}/tx/${auction.tx}`
		: null;
	const number = f.int(auction.id);
	const [winner] = auction.winners;
	const removed = filteredOutcome(auction);
	const head = t("head", {
		solutions: auction.solutions,
		solvers: auction.solvers,
		solver: auction.rows[0]?.label ?? "",
	});
	const sentence = [
		// Each outcome's sentence takes what it says from the same values.
		t(auctionOutcome(auction), {
			head,
			winner: winner?.solver.label ?? "",
			score: f.score(winner?.score ?? null),
			rival: auction.rival?.solver.label ?? "",
			gap: f.gap(auction.rival?.gap ?? null),
			winners: f.list(auction.winners.map((w) => w.solver.label)),
			scores: f.list(auction.winners.map((w) => f.score(w.score))),
		}),
		removed
			? t(removed.kind, {
					solver: removed.solvers[0].label,
					solvers: f.list(removed.solvers.map((solver) => solver.label)),
					count: removed.count,
					total: removed.total,
				})
			: null,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			id="fs-solutions"
			role="region"
			aria-label={t("label", { id: number })}
			className="mt-7 border-t border-ln2 pt-3.5"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
				<div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
					<h3 className="text-[15px] font-medium">{t("title")}</h3>
					<span className="font-mono text-[12px] leading-[normal] font-medium whitespace-nowrap text-mu">
						{t("heading", { id: number, time: f.clock(auction.time) })}
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
			<p
				aria-live="polite"
				className="mt-2 max-w-[720px] text-[15px] leading-[1.55] text-pretty text-mu"
			>
				{sentence}
			</p>
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
						<span className="size-[5px] rounded-full bg-fg/45" />
						{t("legend.others")}
					</span>
					<span className="flex items-center gap-2">
						<span className="size-[9px] rounded-full border-[1.5px] border-fg" />
						{t("legend.filtered")}
					</span>
				</div>
			) : null}
			<div className="mt-3.5 tabular-nums">
				<div className={`${grid} items-end pb-2 label`}>
					<span>{t("columns.solver")}</span>
					{track ? <span>{t("columns.track")}</span> : null}
					<span className="text-right">{t("columns.score")}</span>
					<span className="text-right">
						{t(compact ? "columns.belowShort" : "columns.below")}
					</span>
				</div>
				{auction.rows.map((row) => {
					// The row's figures are its best solution's, the first in CoW's ranking.
					const [best] = row.solutions;
					const state = solutionState(best);
					const hot = isHot(hovered, row.id, rankIndex.get(row.id) ?? -1);
					return (
						<div
							key={row.id}
							onMouseEnter={() => setHovered(row.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${grid} min-h-[31px] items-center border-t border-ln`}
						>
							<span className="flex min-w-0 items-baseline gap-2">
								<span
									className={`truncate text-[13.5px] font-medium transition-colors duration-200 ${row.unnamed ? "font-mono" : ""} ${hot ? "text-teal" : ""}`}
								>
									{row.label}
								</span>
								{row.solutions.length > 1 ? (
									<span className="flex-none font-mono text-[11px] leading-[normal] font-medium text-mu">
										{t("count", { count: row.solutions.length })}
									</span>
								) : null}
							</span>
							{track ? <Track row={row} hot={hot} /> : null}
							<span
								className={`text-right font-mono text-[12.5px] leading-[normal] font-medium ${best.filteredOut ? "text-mu" : ""}`}
							>
								{f.score(best.score)}
							</span>
							<span
								className={`text-right font-mono leading-[normal] font-medium whitespace-nowrap ${compact ? "text-[11.5px]" : "text-[12.5px]"} ${best.filteredOut ? "text-mu" : ""}`}
							>
								{state === "gap"
									? f.gap(best.gap)
									: state === "none"
										? null
										: t(`value.${state}`)}
							</span>
						</div>
					);
				})}
				{track ? (
					<div
						className={`${grid} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
					>
						<span />
						<span className="relative h-3.5">
							<span className="absolute left-0">{t("axis.a")}</span>
							<span className="absolute left-1/4 -translate-x-1/2">
								{t("axis.b")}
							</span>
							<span className="absolute left-1/2 -translate-x-1/2">
								{t("axis.c")}
							</span>
							<span className="absolute left-3/4 -translate-x-1/2">
								{t("axis.d")}
							</span>
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
				{compact ? t("noteCompact") : t("note", { track: track ? "yes" : "no" })}
			</p>
		</div>
	);
}

/**
 * A solver's solutions on the log track below the winning score: the winning one an 8px square
 * at the left end, its best a 9px dot, its others 5px dots at 45%; filtered-out ones hollow.
 */
function Track({ row, hot }: { row: SolutionsRow; hot: boolean }) {
	const t = useTranslations("Enter.solutions");
	const f = useFormat();

	return (
		<span
			role="img"
			aria-label={t("dot", {
				solver: row.label,
				solutions: row.solutions
					.map((solution) =>
						t("dotItem", {
							score: f.score(solution.score),
							state: solutionState(solution),
							gap: f.gap(solution.gap),
						})
					)
					.join("; "),
			})}
			className="relative self-stretch bg-[repeating-linear-gradient(90deg,var(--ln)_0_1px,transparent_1px_25%)]"
		>
			{row.solutions.map((solution, index) => {
				if (solution.winner) {
					return (
						<span
							key={index}
							className={`absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-[2px] transition-colors duration-200 ${hot ? "bg-teal" : "bg-fg"}`}
						/>
					);
				}
				// A solution without a score has no place on the track.
				if (solution.gap === null) return null;
				const best = index === 0;
				const look = solution.filteredOut
					? `bg-bg ${best ? "border-[1.5px]" : "border"} ${hot ? "border-teal" : "border-fg"}`
					: best
						? hot
							? "bg-teal"
							: "bg-fg"
						: "bg-fg/45";
				return (
					<span
						key={index}
						className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-200 ${best ? "size-[9px]" : "size-[5px]"} ${look}`}
						style={{ left: `${trackPosition(solution.gap) * 100}%` }}
					/>
				);
			})}
		</span>
	);
}
