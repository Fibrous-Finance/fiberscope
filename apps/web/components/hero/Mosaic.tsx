"use client";

import { useSyncExternalStore } from "react";

import { useFormatter, useTranslations } from "next-intl";

import { mosaic, MOSAIC_COMPACT, MOSAIC_WIDE, PERIODS } from "@fiberscope/core";
import type { Row, View } from "@fiberscope/core";

import { OTHERS, useDashboard, useHover } from "@/components/dashboard/context";
import { isHot, TEAL, tone } from "@/components/dashboard/tones";

import { useFormat } from "@/lib/format";

/** Solvers with a tone of their own; the legend groups everyone after them as "N others". */
const LEGEND_SIZE = 6;
/** The intro fades each rank in 60ms after the one before, for at most 8 steps. */
const INTRO_STAGGER_S = 0.06;
const INTRO_STEPS = 8;

/** The placeholder field: the mosaic's squares and gaps at its usual size. */
const GRID =
	"aspect-[1184/380] w-full bg-[linear-gradient(90deg,transparent_9px,var(--bg)_9px),linear-gradient(transparent_9px,var(--bg)_9px)] bg-size-[11px_11px] max-wide:aspect-[358/170]";

/** The mosaic only differs between the server and the client; nothing to subscribe to. */
function subscribeNothing() {
	return () => {};
}

/**
 * The batch mosaic: one square per unit of the measure, each solver a vertical block in rank
 * order, so the field reads like a share bar. Hovering a solver here or anywhere else on the page
 * turns its squares teal and shows its numbers above the field.
 */
export function Mosaic({ view, leader }: { view: View; leader: Row }) {
	const t = useTranslations("Hero.mosaic");
	const f = useFormat();
	const format = useFormatter();
	const { layout } = useDashboard();
	const { hovered, setHovered } = useHover();
	// Thousands of squares: draw them on the client only, into the space the server reserved.
	const mounted = useSyncExternalStore(
		subscribeNothing,
		() => true,
		() => false
	);

	const { rows, measure } = view;
	const field = mosaic(
		rows.map((row) => (measure === "volume" ? (row.volume ?? 0) : row[measure])),
		layout.contentWidth,
		layout.compact ? MOSAIC_COMPACT : MOSAIC_WIDE
	);
	const named = rows.slice(0, LEGEND_SIZE);
	const rest = rows.slice(LEGEND_SIZE);
	const restShare = f.percent(
		rest.reduce((sum, row) => sum + row.share, 0),
		1
	);
	const others = t("others", { count: rest.length });

	const hot = rows.find((row) => row.id === hovered);
	const readout = hot
		? t(`readout.${measure}`, {
				name: hot.label,
				value: measure === "volume" ? f.usd(hot.volume) : hot[measure],
				share: f.percent(hot.share, 1),
			})
		: hovered === OTHERS && rest.length > 0
			? t("rest", { count: rest.length, share: restShare })
			: t(`unit.${measure}`, { unit: field.unit });

	const summary = named.map((row) =>
		t("item", { name: row.label, share: f.percent(row.share, 1) })
	);
	if (rest.length > 0) summary.push(t("item", { name: others, share: restShare }));
	const label = t(`label.${measure}`, {
		total: measure === "volume" ? f.usd(view.total) : view.total,
		unit: field.unit,
		solvers: format.list(summary, { type: "unit", style: "short" }),
	});

	return (
		<div className="mt-[clamp(36px,5vw,60px)]">
			<div className="mb-3 flex items-baseline justify-between gap-4 font-mono text-[12px] leading-[normal] font-medium text-mu">
				<span className="flex min-w-0 items-baseline gap-2.5">
					<span
						className={`truncate text-[15px] font-medium text-fg ${leader.unnamed ? "font-mono" : "font-sans"}`}
					>
						{leader.label}
					</span>
					<span className="text-fg">{f.percent(leader.share, 1)}</span>
				</span>
				<span className="truncate text-right">{readout}</span>
			</div>
			<svg
				role="img"
				aria-label={label}
				viewBox={`0 0 ${field.width} ${field.height}`}
				onMouseLeave={() => setHovered(null)}
				className="block h-auto w-full"
			>
				{mounted
					? rows.map((row, i) => (
							<path
								key={row.id}
								d={field.paths[i]}
								onMouseEnter={() => setHovered(row.id)}
								className="[transition:opacity_.8s_ease,fill_.2s_ease]"
								style={{
									fill: isHot(hovered, row.id, i) ? TEAL : tone(i),
									opacity: layout.intro ? 1 : 0,
									transitionDelay: `${Math.min(i, INTRO_STEPS) * INTRO_STAGGER_S}s, 0s`,
								}}
							/>
						))
					: null}
			</svg>
			<ul className="mt-4 flex flex-wrap gap-x-[22px] gap-y-2">
				{named.map((row, i) => (
					<LegendItem
						key={row.id}
						color={isHot(hovered, row.id, i) ? TEAL : tone(i)}
						name={row.label}
						share={f.percent(row.share, 1)}
						mono={row.unnamed}
						active={hovered === row.id}
						onHover={(on) => setHovered(on ? row.id : null)}
					/>
				))}
				{rest.length > 0 ? (
					<LegendItem
						color={hovered === OTHERS ? TEAL : tone(LEGEND_SIZE)}
						name={others}
						share={restShare}
						active={hovered === OTHERS}
						onHover={(on) => setHovered(on ? OTHERS : null)}
					/>
				) : null}
			</ul>
		</div>
	);
}

function LegendItem({
	color,
	name,
	share,
	mono,
	active,
	onHover,
}: {
	color: string;
	name: string;
	share: string;
	mono?: boolean;
	active: boolean;
	onHover: (on: boolean) => void;
}) {
	return (
		<li
			onMouseEnter={() => onHover(true)}
			onMouseLeave={() => onHover(false)}
			className="flex cursor-default items-center gap-2 text-[13px] text-mu"
		>
			<span
				className="size-2.5 flex-none rounded-[2px] transition-colors duration-200"
				style={{ backgroundColor: color }}
			/>
			<span className={`${mono ? "font-mono" : ""} ${active ? "text-fg" : ""}`}>{name}</span>
			<span className="font-mono text-[12px] leading-[normal] font-medium">{share}</span>
		</li>
	);
}

/** Loading: the label row and an empty field where the mosaic will be. */
export function MosaicSkeleton() {
	return (
		<div aria-hidden="true" className="mt-[clamp(36px,5vw,60px)]">
			<div className="mb-3 flex justify-between">
				<span className="skeleton h-3.5 w-40 rounded-[6px]" />
				<span className="skeleton h-3 w-[110px] rounded-[6px]" />
			</div>
			<div className={`${GRID} bg-fg/7`} />
		</div>
	);
}

/** Nothing settled in the window: a faint empty field and the way to a longer window. */
export function EmptyMosaic() {
	const t = useTranslations("Hero.empty");
	const tc = useTranslations("Common");
	const { period, setPeriod } = useDashboard();
	const longer = PERIODS[PERIODS.indexOf(period) + 1];
	return (
		<div className={`${GRID} mt-[clamp(36px,5vw,60px)] grid place-items-center bg-fg/4`}>
			<div className="mx-4 box-content max-w-[420px] rounded-[14px] bg-bg px-[26px] py-[22px] text-center shadow-[0_0_0_1px_var(--ln2)]">
				<h2 className="text-[16px] font-semibold tracking-[-0.01em]">{t("title")}</h2>
				<p className="mt-1.5 mb-4 text-[14px] leading-[1.5] text-mu">
					{t("text", { network: tc("network"), period: tc(`period.${period}`) })}
				</p>
				{longer ? (
					<button type="button" onClick={() => setPeriod(longer)} className="btn-teal">
						{t("action", { period: tc(`period.${longer}`) })}
					</button>
				) : null}
			</div>
		</div>
	);
}
