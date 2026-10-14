"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import { networkBars } from "@fiberscope/core";
import type { Measure, NetworkActivity, Period } from "@fiberscope/core";

import { useDaySlider } from "@/components/ui/daySlider";

import { useFormat } from "@/lib/format";

/**
 * All solvers together: the measure per day of the period and its change on the period before,
 * then one bar per day over the small multiples' days, the period's days bolder (darker in the
 * light theme, lighter in the dark one). The bars are a slider over their days: the pointer, the
 * keys or a tap pick a day, and the readout shows it.
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
	const summary = useId();

	const { days, totals, first, window, covered, perDay, change } = activity;
	const count = days.length;
	// Each bar stands in its day's slot, so the day under the pointer is the slot it is in.
	const slider = useDaySlider({ count, at: (across) => Math.floor(across * count), hover: true });
	const picked = slider.day;
	const bars = networkBars(activity, picked);
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

	// The day the slider stands on; the readout shows it while it is picked.
	const nowDate = date(slider.now);
	const nowTotal = totals[slider.now];
	const nowValue = nowTotal === null ? null : measure === "volume" ? f.usd(nowTotal) : nowTotal;
	const readout =
		picked === null
			? t("idle", { noun, days: count })
			: nowValue === null
				? t("noData", { date: nowDate })
				: t(`day.${measure}`, { date: nowDate, value: nowValue });
	const valueText =
		nowValue === null
			? t("value.noData", { date: nowDate })
			: t(`value.${measure}`, { date: nowDate, value: nowValue });

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
				<span className="font-mono text-[11px] leading-[normal] font-medium whitespace-nowrap text-mu">
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
			<span id={summary} className="sr-only">
				{t("chart", {
					noun,
					start: date(first),
					end: date(count - 1),
					min: amount(Math.min(...known)),
					max: amount(Math.max(...known)),
				})}
			</span>
			{/* 48px (wide 72px) of bars above the 1px baseline. */}
			<div
				role="slider"
				tabIndex={0}
				aria-label={t("slider", { noun, days: count })}
				aria-valuemin={1}
				aria-valuemax={count}
				aria-valuenow={slider.now + 1}
				aria-valuetext={valueText}
				aria-describedby={summary}
				{...slider.handlers}
				className="relative mt-3 h-[49px] cursor-crosshair touch-pan-y touch-pinch-zoom border-b border-ln2 wide:h-[73px]"
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
					<path d={bars.picked} className="fill-teal" />
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
