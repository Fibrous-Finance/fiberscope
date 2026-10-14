"use client";

import { useRef, useState } from "react";

import { useTranslations } from "next-intl";

import { auctionDetails } from "@fiberscope/core";
import type { DetailFigures, Entrant } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { hoverIndex, isHot } from "@/components/dashboard/tones";
import { LatestSettlements } from "@/components/enter/LatestSettlements";
import { Quotes } from "@/components/enter/Quotes";
import { Solutions } from "@/components/enter/Solutions";
import { Tape, tapeAuctions } from "@/components/enter/Tape";
import { Ticks } from "@/components/ui/axis";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/**
 * Name | bar | values: the bar rows and their axis. Wide pages widen the values for the third
 * figure, filtered out.
 */
const BAR_GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_clamp(84px,12vw,150px)] gap-4 wide:grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_clamp(84px,18vw,220px)]";

/**
 * Who enters, who wins: how often each solver enters, wins and has its solutions filtered out,
 * the latest auctions with the solutions of the selected one, whose quotes trades were placed
 * with, and the latest settlements of every solver.
 */
export function Enter() {
	const t = useTranslations("Enter");
	const tc = useTranslations("Common");
	const f = useFormat();
	const view = useView();
	const { snapshot, layout, status } = useDashboard();
	// The auction picked on the tape, by id: new data shifts the columns, and the pick stays on
	// its auction until it leaves the tape. Without a pick, the latest auction is selected.
	const [picked, setPicked] = useState<number | null>(null);
	// The selected auction's solutions, open under the tape.
	const [open, setOpen] = useState(false);
	const tapeRef = useRef<HTMLDivElement>(null);

	const top = view.competition?.entrants[0];
	// No auction data in the window (or no solver entered): the empty sentence alone, then
	// Quotes and Latest settlements.
	const competition = top ? view.competition : null;
	const auctions = tapeAuctions(view.tape, layout.compact);
	const selected = auctions.find((auction) => auction.id === picked) ?? auctions.at(-1);
	// Auction data covers fewer days than the window: the sentence opens with the covered span.
	const coverage =
		competition && view.coverage.auction < view.days
			? { covered: view.coverage.auction, days: view.days }
			: null;
	// Auction details cover some but not all of the window: on wide pages the filtered-out label
	// gets a dagger, and a footnote under the footer line says how many days they cover. Without
	// any, the figures read "—" and there is no span to name.
	const details = auctionDetails(snapshot!, view);
	const partial = details.coverage > 0 && details.coverage < view.days;

	// The place in `view.rows` decides whether "N others" in the legend highlights a solver.
	const rankIndex = new Map(view.rows.map((row) => [row.id, hoverIndex(row, view.measure)]));

	const sentence =
		competition && top
			? [
					coverage ? t("coverage", coverage) : null,
					t("sentence", {
						entrants: f.fixed(competition.entrantsPerAuction, 1),
						solutions: Math.round(competition.solutionsPerAuction),
					}),
					t("top", {
						solver: top.label,
						participation: f.percent(top.participation),
						winRate: f.percent(top.winRate),
					}),
				]
					.filter(Boolean)
					.join(" ")
			: t("empty", {
					period: tc(`period.${view.period}`),
					// While delayed: "the 24 hours to 09:49 UTC".
					delayed: status.delayed ? "yes" : "no",
					asOf: status.asOf ?? "",
				});

	const missing = competition?.withoutAuctions ?? [];
	const note = [
		selected ? t(layout.compact ? "noteCompact" : "note") : null,
		missing.length > 0
			? t("noAuctions", { names: f.list(missing.map((row) => row.label)) })
			: null,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<Section id="enter">
			<div className="max-w-[720px]">
				<h2 className="section-title">{t("title")}</h2>
				<p className="mt-3 answer">{sentence}</p>
			</div>
			{competition ? (
				<>
					<Bars
						entrants={competition.entrants}
						rankIndex={rankIndex}
						details={details.solvers}
						partial={partial}
						compact={layout.compact}
					/>
					{selected ? (
						<>
							<Tape
								ref={tapeRef}
								auctions={auctions}
								rows={view.tape.rows}
								rankIndex={rankIndex}
								selected={selected.id}
								open={open}
								onSelect={setPicked}
								onOpenChange={setOpen}
							/>
							{/* Mounted while closed too: its sentence is a live region. */}
							<Solutions
								id={open ? selected.id : null}
								compact={layout.compact}
								rankIndex={rankIndex}
								onClose={() => {
									setOpen(false);
									// Close takes itself away: the focus goes back to the tape.
									tapeRef.current?.focus({ preventScroll: true });
								}}
							/>
						</>
					) : null}
					<FootLine source={t("source")}>{note}</FootLine>
					{partial && !layout.compact ? (
						<p id="fn-filtered" className="mt-1.5 foot-line">
							{t("filteredFootnote", { covered: details.coverage, days: view.days })}
						</p>
					) : null}
				</>
			) : null}
			<Quotes rankIndex={rankIndex} />
			{snapshot!.latestSettlements.length > 0 ? (
				<LatestSettlements rankIndex={rankIndex} />
			) : null}
		</Section>
	);
}

/**
 * Entered (light) and won (solid) share of all auctions, one row per solver; on wide pages the
 * figures end with the share of its solutions the fairness filter removed.
 */
function Bars({
	entrants,
	rankIndex,
	details,
	partial,
	compact,
}: {
	entrants: Entrant[];
	rankIndex: Map<string, number>;
	/** Every solver's auction details over the window's days with them. */
	details: Map<string, DetailFigures>;
	/** Those days are fewer than the window's. */
	partial: boolean;
	compact: boolean;
}) {
	const t = useTranslations("Enter");
	const f = useFormat();
	const { hovered, setHovered } = useHover();
	const ticks = [0, 0.5, 1].map((x) => ({ x, label: f.percent(x) }));

	return (
		<>
			<div className="mt-7 flex gap-[22px] font-mono text-[12px] leading-[normal] font-medium text-mu">
				<span className="flex items-center gap-2">
					<span className="h-2 w-4 rounded-[2px] bg-fg/18" />
					{t("legend.entered")}
				</span>
				<span className="flex items-center gap-2">
					<span className="h-2 w-4 rounded-[2px] bg-fg" />
					{t("legend.won")}
				</span>
			</div>
			<div className="mt-3.5">
				{/*
				 * The values' key heads their column, right-aligned over the bars' column and
				 * theirs, on compact pages over the whole row; where it wraps, it breaks at a "·".
				 * Its "†" points at the footnote under the chart.
				 */}
				<div className={`${BAR_GRID} pb-2 label`}>
					<span
						aria-describedby={partial && !compact ? "fn-filtered" : undefined}
						className="col-span-full text-right text-balance wide:col-[2/-1]"
					>
						{t(compact ? "axis.rates" : "axis.ratesFiltered", {
							partial: partial ? "yes" : "no",
						})}
					</span>
				</div>
				{entrants.map((entrant) => {
					const hot = isHot(hovered, entrant.id, rankIndex.get(entrant.id) ?? -1);
					// Filtered out: one decimal, exactly zero as "0%", and "—" for a solver without
					// solutions in the days with auction details.
					const share = details.get(entrant.id)?.filteredShare ?? null;
					const figures = {
						participation: f.percent(entrant.participation),
						wonShare: f.percent(entrant.wonShare),
						winRate: f.percent(entrant.winRate),
						filtered: share === 0 ? f.percent(0) : f.percent(share, 1),
					};
					return (
						<div
							key={entrant.id}
							onMouseEnter={() => setHovered(entrant.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${BAR_GRID} h-[31px] items-center border-t border-ln`}
						>
							<span
								title={entrant.label}
								className={`truncate text-[13.5px] font-medium ${entrant.unnamed ? "font-mono" : ""} ${hot ? "text-hvt" : ""}`}
							>
								{entrant.label}
							</span>
							<span
								role="img"
								aria-label={t(
									compact || share === null ? "bar" : "barFiltered",
									figures
								)}
								className="relative h-2.5 bg-[repeating-linear-gradient(90deg,var(--ln)_0_1px,transparent_1px_25%)]"
							>
								<span
									className="absolute inset-y-0 left-0 rounded-[2px] bg-fg/18"
									style={{ width: `${entrant.participation * 100}%` }}
								/>
								<span
									className={`absolute inset-y-0 left-0 rounded-[2px] transition-colors duration-200 ${hot ? "bg-teal" : "bg-fg"}`}
									style={{ width: `${entrant.wonShare * 100}%` }}
								/>
							</span>
							<span className="text-right font-mono text-[12.5px] leading-[normal] font-medium whitespace-nowrap text-mu">
								{t.rich(compact ? "rates" : "ratesFiltered", {
									...figures,
									win: (chunks) => <span className="text-fg">{chunks}</span>,
								})}
							</span>
						</div>
					);
				})}
				<div
					className={`${BAR_GRID} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
				>
					<span />
					{/* Compact tracks have no room for the words. */}
					<Ticks ticks={ticks} className="wide:hidden" />
					<Ticks
						ticks={ticks}
						end={t("axis.end", { value: f.percent(1) })}
						className="max-wide:hidden"
					/>
					<span />
				</div>
			</div>
		</>
	);
}
