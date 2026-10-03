"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { networkBars } from "@fiberscope/core";
import type { Measure, NetworkActivity, Period } from "@fiberscope/core";

import { useFormat } from "@/lib/format";

/**
 * All solvers together: the measure per day of the period and its change on the period before,
 * then one bar per day over the small multiples' days, the period's days bolder (darker in the
 * light theme, lighter in the dark one). Hovering the chart reads out the day under the pointer.
 */
export function Network({
	activity,
	period,
	measure,
	asOf,
}: {
	activity: NetworkActivity;
	period: Period;
	measure: Measure;
	/** While delayed, the time the data runs to; the caption and note then read "to {asOf}". */
	asOf?: string;
}) {
	const t = useTranslations("Change.network");
	const tc = useTranslations("Common");
	const f = useFormat();
	const [day, setDay] = useState<number | null>(null);

	const { days, totals, first, window, covered, perDay, change } = activity;
	const count = days.length;
	const hovered = day !== null && day < count ? day : null;
	const bars = networkBars(activity, hovered);
	const amount = (value: number) => (measure === "volume" ? f.usd(value) : f.int(value));
	const noun = tc(`measure.${measure}`);
	const date = (index: number) => f.day(days[index]);

	const unit = t(`unit.${measure}`, { count: Math.round(perDay) });
	const span = asOf ? t("spanTo", { days: covered, asOf }) : t("span", { days: covered });
	const caption =
		change === null
			? t("captionFirst", { unit, span })
			: t("caption", {
					unit,
					span,
					change: f.points(change),
					previousPeriod: tc(`previousPeriod.${period}`),
				});

	const hoveredTotal = hovered === null ? null : totals[hovered];
	const readout =
		hovered === null
			? t("idle", { noun, days: count })
			: hoveredTotal === null
				? t("noData", { date: date(hovered) })
				: t(`day.${measure}`, {
						date: date(hovered),
						value: measure === "volume" ? f.usd(hoveredTotal) : hoveredTotal,
					});

	// The oldest days have no data when the measure's history is shorter than the chart.
	const note =
		first > 0
			? t("starts", { measure, date: date(first) })
			: window < count
				? asOf
					? t("windowTo", { days: window, asOf })
					: t("window", { days: window })
				: "";
	const known = totals.filter((total) => total !== null);

	return (
		<div className="mt-9 border-t border-ln pt-4 pb-[22px]">
			<div className="flex items-baseline justify-between gap-3 text-[13px]">
				<span className="font-medium">{t("title")}</span>
				<span
					aria-live="polite"
					className="font-mono text-[11px] leading-[normal] font-medium whitespace-nowrap text-mu"
				>
					{readout}
				</span>
			</div>
			<div className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
				<span className="font-mono text-[24px] leading-[normal] font-medium tracking-[-0.04em]">
					{amount(perDay)}
				</span>
				<span className="font-mono text-[11.5px] leading-[normal] font-medium text-mu">
					{caption}
				</span>
			</div>
			{/* 48px (wide 72px) of bars above the 1px baseline. */}
			<div
				role="img"
				aria-label={t("chart", {
					noun,
					start: date(first),
					end: date(count - 1),
					min: amount(Math.min(...known)),
					max: amount(Math.max(...known)),
				})}
				onMouseMove={(event) => {
					const box = event.currentTarget.getBoundingClientRect();
					if (box.width === 0) return;
					const index = Math.floor(((event.clientX - box.left) / box.width) * count);
					setDay(Math.max(0, Math.min(count - 1, index)));
				}}
				onMouseLeave={() => setDay(null)}
				className="relative mt-3 h-[49px] cursor-crosshair border-b border-ln2 wide:h-[73px]"
			>
				<svg
					viewBox={`0 0 ${count} 100`}
					preserveAspectRatio="none"
					className="absolute inset-0 block size-full"
				>
					<path
						d={bars.earlier}
						className="fill-[color-mix(in_oklab,var(--fg)_22%,var(--bg))]"
					/>
					<path
						d={bars.window}
						className="fill-[color-mix(in_oklab,var(--fg)_56%,var(--bg))]"
					/>
					<path d={bars.hovered} className="fill-teal" />
				</svg>
			</div>
			<div className="mt-1.5 flex justify-between gap-3 font-mono text-[11px] leading-[normal] font-medium text-fa">
				<span>{date(0)}</span>
				<span className="text-center">{note}</span>
				<span>{date(count - 1)}</span>
			</div>
		</div>
	);
}
