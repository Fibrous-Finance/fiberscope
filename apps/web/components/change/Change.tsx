"use client";

import { useTranslations } from "next-intl";

import { linePath } from "@fiberscope/core";
import type { Row } from "@fiberscope/core";

import { useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** The small multiples show this many solvers, ranked by the active measure. */
const MULTIPLES = 8;

/** Is it changing: who has led the daily measure, and each top solver's daily share. */
export function Change() {
	const t = useTranslations("Change");
	const tc = useTranslations("Common");
	const f = useFormat();
	const view = useView();
	const { hovered, setHovered } = useHover();

	const measure = tc(`measure.${view.measure}`);
	const run = view.leaderRun;
	const gain = view.biggestGain;
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
		const previousPeriod = tc(`previousPeriod.${view.period}`);
		const points = tc("points", { value: f.points(gain.points) });
		sentences.push(
			gain.isLeader
				? t("leaderGain", { previousPeriod, points })
				: t("gain", { previousPeriod, solver: gain.solver.label, points })
		);
	}

	const tiles = view.rows.slice(0, MULTIPLES);
	// Every tile shares one scale: 0 to the next 10% above the highest daily share.
	const max = Math.max(0.1, Math.ceil(Math.max(...tiles.flatMap((r) => r.daily)) * 10) / 10);
	const start = f.day(view.history[0]);
	const end = f.day(view.history[view.history.length - 1]);

	return (
		<Section id="change">
			<div className="max-w-[720px]">
				<h2 className="section-title">{t("title")}</h2>
				<p className="mt-3 answer">{sentences.join(" ")}</p>
			</div>
			<div className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(min(100%,150px),1fr))] gap-x-8 wide:grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))]">
				{tiles.map((row, index) => (
					<Multiple
						key={row.id}
						row={row}
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
				<FootLine source={t("range", { start, end })}>
					{t("note", { measure, count: tiles.length, max: f.percent(max), start })}
				</FootLine>
			</div>
		</Section>
	);
}

/** One solver's tile: window share, change since the first day, and the daily line. */
function Multiple({
	row,
	max,
	hot,
	measure,
	start,
	end,
	onHover,
}: {
	row: Row;
	/** Top of the shared y-scale. */
	max: number;
	hot: boolean;
	/** The measure noun and the first and last days, for the chart's text summary. */
	measure: string;
	start: string;
	end: string;
	onHover: (id: string | null) => void;
}) {
	const t = useTranslations("Change");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { line, area, endY } = linePath(row.daily, 0, max, 100, 40);
	const first = row.daily[0];
	const last = row.daily[row.daily.length - 1];

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
					<path d={area} className={hot ? "fill-teal/10" : "fill-fg/10"} />
					<path
						d={line}
						fill="none"
						strokeWidth={1.5}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
						className={`transition-colors duration-200 ${hot ? "stroke-teal" : "stroke-fg"}`}
					/>
				</svg>
				<span
					className={`absolute -right-[3px] -mt-[3px] size-1.5 rounded-full ${hot ? "bg-teal" : "bg-fg"}`}
					style={{ top: `${endY}%` }}
				/>
			</div>
		</div>
	);
}
