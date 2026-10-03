"use client";

import { useTranslations } from "next-intl";

import { linePath, networkActivity } from "@fiberscope/core";
import type { Row } from "@fiberscope/core";

import { Network } from "@/components/change/Network";
import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** The small multiples show this many solvers, ranked by the active measure. */
const MULTIPLES = 8;
/** A smaller change (percent) in the network's daily value reads as flat. */
const FLAT_CHANGE = 0.5;

/**
 * Is it changing: who has led the daily measure, all solvers' daily activity, and each top
 * solver's daily share.
 */
export function Change({
	asOf,
}: {
	/**
	 * While the data is delayed, the time it runs to ("09:49 UTC", "3 Oct, 09:49 UTC"): the
	 * network caption then reads "in the 24 hours to 09:49 UTC".
	 */
	asOf?: string;
}) {
	const t = useTranslations("Change");
	const tc = useTranslations("Common");
	const f = useFormat();
	const view = useView();
	const { snapshot } = useDashboard();
	const { hovered, setHovered } = useHover();
	const activity = networkActivity(snapshot!, view);

	const measure = tc(`measure.${view.measure}`);
	const previousPeriod = tc(`previousPeriod.${view.period}`);
	const run = view.leaderRun;
	const gain = view.biggestGain;
	const change = activity.change;
	const sentences: string[] = [];
	if (run) {
		const values = { solver: run.solver.label, measure, days: run.days };
		sentences.push(
			run.atLeast
				? t("leader.atLeast", values)
				: run.previous
					? t("leader.after", { ...values, previous: run.previous.label })
					: t("leader.alone", values)
		);
	}
	if (gain) {
		const points = tc("points", { value: f.points(gain.points) });
		sentences.push(
			gain.isLeader
				? t("leaderGain", { previousPeriod, points })
				: t("gain", { previousPeriod, solver: gain.solver.label, points })
		);
	}
	if (change !== null) {
		sentences.push(
			t("trend", {
				daily: view.days > 1 ? "yes" : "no",
				noun: measure,
				measure: view.measure,
				direction: Math.abs(change) < FLAT_CHANGE ? "flat" : change > 0 ? "up" : "down",
				change: f.fixed(Math.abs(change), 1),
				previousPeriod,
			})
		);
	}

	// The tiles draw the network chart's days. Days without data all come first, so dropping
	// them leaves each line on its days from `first` on, placed `offset` across the chart.
	const { days, first } = activity;
	const last = days.length - 1;
	const offset = (100 * first) / last;
	const tiles = view.rows.slice(0, MULTIPLES).map((row) => ({
		row,
		daily: (activity.shares.get(row.id) ?? []).filter((share) => share !== null),
	}));
	// Every tile shares one scale: 0 to the next 10% above the highest daily share.
	const max = Math.max(
		0.1,
		Math.ceil(Math.max(...tiles.flatMap((tile) => tile.daily)) * 10) / 10
	);
	const start = f.day(days[first]);
	const end = f.day(days[last]);

	return (
		<Section id="change">
			<div className="max-w-[720px]">
				<h2 className="section-title">{t("title")}</h2>
				<p className="mt-3 answer">{sentences.join(" ")}</p>
			</div>
			<Network activity={activity} period={view.period} measure={view.measure} asOf={asOf} />
			<div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,140px),1fr))] gap-x-5 wide:grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] wide:gap-x-8">
				{tiles.map(({ row, daily }, index) => (
					<Multiple
						key={row.id}
						row={row}
						daily={daily}
						offset={offset}
						max={max}
						hot={isHot(hovered, row.id, index)}
						measure={measure}
						start={start}
						end={end}
						onHover={setHovered}
					/>
				))}
			</div>
			{/* The design sets this note 14px under the tiles, 2px closer than under other charts. */}
			<div className="-mt-0.5">
				<FootLine source={t("range", { start: f.day(days[0]), end })}>
					{t("note", { measure, count: tiles.length, max: f.percent(max), start })}
				</FootLine>
			</div>
		</Section>
	);
}

/** One solver's tile: window share, change since the first day with data, and the daily line. */
function Multiple({
	row,
	daily,
	offset,
	max,
	hot,
	measure,
	start,
	end,
	onHover,
}: {
	row: Row;
	/** Daily share of the measure on the days with data, oldest first. */
	daily: number[];
	/** Where the first of those days sits across the chart, 0–100. */
	offset: number;
	/** Top of the shared y-scale. */
	max: number;
	hot: boolean;
	/** The measure noun and the first and last days with data, for the chart's text summary. */
	measure: string;
	start: string;
	end: string;
	onHover: (id: string | null) => void;
}) {
	const t = useTranslations("Change");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { line, area, endY } = linePath(daily, 0, max, 100 - offset, 40);
	const first = daily[0];
	const last = daily[daily.length - 1];

	return (
		<div
			onMouseEnter={() => onHover(row.id)}
			onMouseLeave={() => onHover(null)}
			className="min-w-0 border-t border-ln pt-4 pb-[22px]"
		>
			<div className="flex justify-between gap-2 text-[13px]">
				<span className={`truncate font-medium ${row.unnamed ? "font-mono" : ""}`}>
					{row.label}
				</span>
				<span className="font-mono text-[11px] leading-[normal] font-medium text-mu">
					{t("rank", { rank: row.rank })}
				</span>
			</div>
			<div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
				<span className="font-mono text-[24px] leading-[normal] font-medium tracking-[-0.04em]">
					{f.percent(row.share, 1)}
				</span>
				<span className="font-mono text-[11.5px] leading-[normal] font-medium text-mu">
					{tc("points", { value: f.points((last - first) * 100) })}
				</span>
			</div>
			{/* 44px (wide 64px) of chart above the 1px baseline. */}
			<div
				role="img"
				aria-label={t("chart", {
					solver: row.label,
					measure,
					first: f.percent(first, 1),
					last: f.percent(last, 1),
					start,
					end,
				})}
				className="relative mt-3 h-[45px] border-b border-ln2 wide:h-[65px]"
			>
				<svg
					viewBox="0 0 100 40"
					preserveAspectRatio="none"
					className="absolute inset-0 size-full overflow-visible"
				>
					{/* The line starts at the first day with data and runs to the right edge. */}
					<g transform={`translate(${offset} 0)`}>
						<path d={area} className={hot ? "fill-teal/10" : "fill-fg/10"} />
						<path
							d={line}
							fill="none"
							strokeWidth={1.5}
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
							className={`transition-colors duration-200 ${hot ? "stroke-teal" : "stroke-fg"}`}
						/>
					</g>
				</svg>
				<span
					className={`absolute -right-[3px] -mt-[3px] size-1.5 rounded-full ${hot ? "bg-teal" : "bg-fg"}`}
					style={{ top: `${endY}%` }}
				/>
			</div>
		</div>
	);
}
