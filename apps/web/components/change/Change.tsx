"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import { linePath, networkActivity } from "@fiberscope/core";
import type { Row } from "@fiberscope/core";

import { Network } from "@/components/change/Network";
import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { useDaySlider } from "@/components/ui/daySlider";
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
	} else {
		// Nothing settled in the last 24 hours, or two solvers tied for the most.
		const span = asOf ? t("network.spanTo", { days: 1, asOf }) : t("network.span", { days: 1 });
		sentences.push(t("leader.none", { measure, span }));
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
		shares: activity.shares.get(row.id) ?? [],
	}));
	// Every tile shares one scale: 0 to the highest daily share rounded up to a multiple of 10%.
	const highest = Math.max(
		...tiles.flatMap(({ shares }) => shares).filter((share) => share !== null)
	);
	const max = Math.max(0.1, Math.ceil(highest * 10) / 10);
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
				{tiles.map(({ row, shares }, index) => (
					<Multiple
						key={row.id}
						row={row}
						shares={shares}
						days={days}
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
			{/* This note sits 14px under the tiles, 2px closer than under other charts. */}
			<div className="-mt-0.5">
				<FootLine source={t("range", { start: f.day(days[0]), end })}>
					{t("note", { measure, count: tiles.length, max: f.percent(max), start })}
				</FootLine>
			</div>
		</Section>
	);
}

/**
 * One solver's tile: window share, change since the first day with data, and the daily line. The
 * line is a slider over the days: while one is picked, the share and the date of that day replace
 * the window's figures, and the end dot moves to it.
 */
function Multiple({
	row,
	shares,
	days,
	offset,
	max,
	hot,
	measure,
	start,
	end,
	onHover,
}: {
	row: Row;
	/** Daily share of the measure, oldest first; null on the days without data, which come first. */
	shares: (number | null)[];
	/** End time of each day, as the network chart draws them. */
	days: number[];
	/** Where the first day with data sits across the chart, 0–100. */
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
	const summary = useId();
	const daily = shares.filter((share) => share !== null);
	const { line, area } = linePath(daily, 0, max, 100 - offset, 40);
	const first = daily[0];
	const last = daily[daily.length - 1];
	const count = days.length;
	// The line's points spread evenly across the chart: the day under the pointer is the nearest.
	const slider = useDaySlider({ count, at: (across) => Math.round(across * (count - 1)) });
	const picked = slider.day !== null;
	// The day the slider stands on, the latest unless one is picked: the dot marks its share.
	const nowShare = shares[slider.now];
	const nowDate = f.day(days[slider.now]);

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
					{f.percent(picked ? nowShare : row.share, 1)}
				</span>
				<span className="font-mono text-[11.5px] leading-[normal] font-medium text-mu">
					{picked ? nowDate : tc("points", { value: f.points((last - first) * 100) })}
				</span>
			</div>
			<span id={summary} className="sr-only">
				{t("chart", {
					solver: row.label,
					measure,
					first: f.percent(first, 1),
					last: f.percent(last, 1),
					start,
					end,
				})}
			</span>
			{/* 44px (wide 64px) of chart above the 1px baseline. */}
			<div
				role="slider"
				tabIndex={0}
				aria-label={t("multiple.slider", { solver: row.label, measure, days: count })}
				aria-valuemin={1}
				aria-valuemax={count}
				aria-valuenow={slider.now + 1}
				aria-valuetext={
					nowShare === null
						? t("multiple.noData", { date: nowDate })
						: t("multiple.value", { date: nowDate, share: f.percent(nowShare, 1) })
				}
				aria-describedby={summary}
				{...slider.handlers}
				className="relative mt-3 h-[45px] touch-pan-y touch-pinch-zoom border-b border-ln2 wide:h-[65px]"
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
				{/* No dot on a picked day without data, where the line has no point. */}
				{nowShare !== null && (
					<span
						className={`absolute -mt-[3px] -ml-[3px] size-1.5 rounded-full ${hot ? "bg-teal" : "bg-fg"}`}
						style={{
							left: `${(100 * slider.now) / (count - 1)}%`,
							top: `${100 - (100 * nowShare) / max}%`,
						}}
					/>
				)}
			</div>
		</div>
	);
}
