"use client";

import { useTranslations } from "next-intl";

import { NETWORKS } from "@fiberscope/core";
import type { Entrant } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { LatestSettlements } from "@/components/enter/LatestSettlements";
import { Tape } from "@/components/enter/Tape";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Name | bar | values: the bar rows and their axis. */
const BAR_GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_clamp(84px,12vw,150px)] gap-4";

/**
 * Who enters, who wins: how often each solver enters and wins, the latest auctions and the latest
 * settlements of every solver.
 */
export function Enter() {
	const t = useTranslations("Enter");
	const tc = useTranslations("Common");
	const f = useFormat();
	const view = useView();
	const { snapshot, layout, status } = useDashboard();
	const top = view.competition?.entrants[0];
	// No auction data in the window (or no solver entered): the empty sentence alone, then
	// Latest settlements.
	const competition = top ? view.competition : null;
	const hasTape = view.tape.auctions.length > 0;
	// Auction data covers fewer days than the window: the sentence opens with the covered span.
	const coverage =
		competition && view.coverage.auction < view.days
			? { covered: view.coverage.auction, days: view.days }
			: null;

	// The rank in `view.rows` decides whether "N others" in the legend highlights a solver.
	const rankIndex = new Map(view.rows.map((row, index) => [row.id, index]));
	const slug = NETWORKS[snapshot!.network].explorerSlug;
	const explorer = (tx: string | null) =>
		tx ? `https://explorer.cow.fi/${slug}/tx/${tx}` : undefined;

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
		hasTape ? t(layout.compact ? "noteCompact" : "note") : null,
		missing.length > 0
			? t("noAuctions", {
					names: new Intl.ListFormat(f.locale, { type: "unit", style: "short" }).format(
						missing.map((row) => row.label)
					),
				})
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
					<Bars entrants={competition.entrants} rankIndex={rankIndex} />
					{hasTape ? (
						<Tape
							tape={view.tape}
							compact={layout.compact}
							rankIndex={rankIndex}
							explorer={explorer}
						/>
					) : null}
					<FootLine source={t("source")}>{note}</FootLine>
				</>
			) : null}
			{snapshot!.latestSettlements.length > 0 ? (
				<LatestSettlements rankIndex={rankIndex} />
			) : null}
		</Section>
	);
}

/** Entered (light) and won (solid) share of all auctions, one row per solver. */
function Bars({ entrants, rankIndex }: { entrants: Entrant[]; rankIndex: Map<string, number> }) {
	const t = useTranslations("Enter");
	const f = useFormat();
	const { hovered, setHovered } = useHover();

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
				{entrants.map((entrant) => {
					const hot = isHot(hovered, entrant.id, rankIndex.get(entrant.id) ?? -1);
					return (
						<div
							key={entrant.id}
							onMouseEnter={() => setHovered(entrant.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${BAR_GRID} h-[31px] items-center border-t border-ln`}
						>
							<span
								className={`truncate text-[13.5px] font-medium ${entrant.unnamed ? "font-mono" : ""} ${hot ? "text-teal" : ""}`}
							>
								{entrant.label}
							</span>
							<span
								role="img"
								aria-label={t("bar", {
									participation: f.percent(entrant.participation),
									wonShare: f.percent(entrant.wonShare),
								})}
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
								{t.rich("rates", {
									participation: f.percent(entrant.participation),
									winRate: f.percent(entrant.winRate),
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
					<span className="relative h-3.5">
						<span className="absolute left-0">{f.percent(0)}</span>
						<span className="absolute left-1/2 -translate-x-1/2">{f.percent(0.5)}</span>
						{/* Below 760px the full label would run into "50%". */}
						<span className="absolute right-0">
							<span className="max-wide:hidden">
								{t("axis.end", { value: f.percent(1) })}
							</span>
							<span className="wide:hidden">{f.percent(1)}</span>
						</span>
					</span>
					<span className="text-right whitespace-nowrap">{t("axis.rates")}</span>
				</div>
			</div>
		</>
	);
}
