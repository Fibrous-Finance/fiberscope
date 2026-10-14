"use client";

import { useTranslations } from "next-intl";

import {
	costAxis,
	DASH,
	FEW_TRADES,
	gasAxis,
	sortRows,
	surplusAndCost,
	swapsAxis,
} from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { hoverIndex, isHot } from "@/components/dashboard/tones";
import { Surplus } from "@/components/surplus/Surplus";
import { Ticks } from "@/components/ui/axis";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Dot diameters in px, by √trades. */
const DOT_MIN = 7;
const DOT_MAX = 18;

/**
 * Desktop: name | gas track | gas value | cost track | cost value | swaps track | swaps value.
 * Compact: the cost and swaps tracks are hidden, and their values take the last two columns,
 * each wide enough for five characters ("14.50", "<0.1¢"). The desktop gap keeps each value
 * clear of the next panel's track.
 */
const GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_44px_38px_38px] gap-2 wide:grid-cols-[clamp(96px,16vw,190px)_minmax(0,1.25fr)_56px_minmax(0,1fr)_48px_minmax(0,1fr)_44px] wide:gap-6";

const VALUE = "text-right font-mono text-[12.5px] leading-[normal] font-medium";

/** A solver's dot, the same on every track. */
interface Dot {
	/** Diameter in px. */
	size: number;
	/** Fewer than `FEW_TRADES` trades. */
	hollow: boolean;
	/** Highlighted by the current hover. */
	hot: boolean;
}

/**
 * How efficiently: gas, transaction cost and DEX swaps per trade for every solver, lowest gas
 * first.
 */
export function Efficiency() {
	const t = useTranslations("Efficiency");
	const f = useFormat();
	const view = useView();
	const { network, snapshot } = useDashboard();
	const { hovered, setHovered } = useHover();
	const { average, lowest, minBatches } = view.gas;
	const swaps = view.swaps;
	const costs = surplusAndCost(snapshot!, view);
	// Costs come in USD per trade; the cost track runs in cents.
	const cost = costs.network.costPerTrade;
	const costCents = cost === null ? null : cost * 100;

	const rows = sortRows(view.rows, { key: "gas", direction: 1 })
		.filter((row) => row.gasPerTrade !== null)
		.map((row) => ({ ...row, costPerTrade: costs.rows.get(row.id)?.costPerTrade ?? null }));
	const gasScale = gasAxis(rows, average);
	const costScale = costAxis(rows, cost);
	const swapsScale = swapsAxis(rows, swaps.average);
	// Tick labels drop the trailing zeros Format.gas keeps: 1M, 1.5M.
	const tick = new Intl.NumberFormat(f.locale, { notation: "compact", maximumFractionDigits: 1 });
	const maxTrades = Math.max(...rows.map((row) => row.trades));

	const sentence =
		lowest && average !== null
			? [
					t(lowest.batches >= minBatches ? "sentence" : "sentenceAll", {
						solver: lowest.label,
						minBatches: f.int(minBatches),
						gas: f.gas(lowest.gasPerTrade),
						average: f.gas(average),
					}),
					swaps.average !== null
						? t("sentenceSwaps", { swaps: f.fixed(swaps.average, 2) })
						: null,
					cost !== null
						? t("sentenceCost", {
								cost: f.cost(cost),
								l1: network.l1DataFee ? "yes" : "no",
							})
						: null,
				]
					.filter(Boolean)
					.join(" ")
			: null;

	return (
		<Section id="eff">
			<div className="max-w-[720px]">
				<h2 className="section-title">{t("title")}</h2>
				{sentence ? <p className="mt-3 answer">{sentence}</p> : null}
			</div>
			<div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] leading-[normal] font-medium text-mu">
				{average !== null ? (
					<span className="flex items-center gap-2">
						<span className="h-3 border-l border-dashed border-act" />
						{t("legend.average")}
					</span>
				) : null}
				<span className="flex items-center gap-2">
					<span className="size-[9px] rounded-full border-[1.5px] border-fg" />
					{t("legend.few", { count: FEW_TRADES })}
				</span>
				<span className="flex items-center gap-2">
					<span className="flex items-center gap-[3px]">
						<span className="size-1.5 rounded-full bg-fg" />
						<span className="size-3 rounded-full bg-fg" />
					</span>
					{t("legend.size")}
				</span>
			</div>
			<div className="mt-[18px]">
				<div
					className={`${GRID} items-end pb-2 font-mono text-[11px] leading-[normal] font-medium tracking-[0.06em] text-mu uppercase`}
				>
					<span />
					<span className="col-span-2">
						{t("header.gas", { average: f.gas(average) })}
					</span>
					<span className="col-span-2 max-wide:hidden">
						{t("header.cost", { average: f.cost(cost) })}
					</span>
					<span className="col-span-2 max-wide:hidden">
						{swaps.average !== null
							? t("header.swaps", { average: f.fixed(swaps.average, 2) })
							: null}
					</span>
					<span className="text-right wide:hidden">{t("header.costShort")}</span>
					<span className="text-right wide:hidden">{t("header.swapsShort")}</span>
				</div>
				{rows.map((row) => {
					const gas = row.gasPerTrade ?? 0;
					const perTrade = row.swapsPerTrade;
					const dot: Dot = {
						size: DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(row.trades / maxTrades),
						hollow: row.trades < FEW_TRADES,
						hot: isHot(hovered, row.id, hoverIndex(row, view.measure)),
					};
					return (
						<div
							key={row.id}
							onMouseEnter={() => setHovered(row.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${GRID} h-[31px] items-center border-t border-ln`}
						>
							<span
								className={`truncate text-[13.5px] font-medium ${row.unnamed ? "font-mono" : ""} ${dot.hot ? "text-hvt" : ""}`}
							>
								{row.label}
							</span>
							<Track
								value={gas}
								average={average}
								max={gasScale.max}
								dot={dot}
								label={t("dot", { gas: f.gas(gas), trades: row.trades })}
							/>
							<span className={VALUE}>{f.gas(gas)}</span>
							<Track
								value={row.costPerTrade === null ? null : row.costPerTrade * 100}
								average={costCents}
								max={costScale.max}
								dot={dot}
								label={t("costDot", {
									cost: f.cost(row.costPerTrade),
									trades: row.trades,
								})}
								className="max-wide:hidden"
							/>
							<span className={VALUE}>{f.cost(row.costPerTrade)}</span>
							<Track
								value={perTrade}
								average={swaps.average}
								max={swapsScale.max}
								dot={dot}
								label={
									perTrade !== null
										? t("swapsDot", {
												swaps: f.fixed(perTrade, 2),
												trades: row.trades,
											})
										: undefined
								}
								className="max-wide:hidden"
							/>
							<span className={VALUE}>
								{perTrade !== null ? f.fixed(perTrade, 2) : DASH}
							</span>
						</div>
					);
				})}
				<div
					className={`${GRID} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
				>
					<span />
					<Ticks
						ticks={gasScale.ticks.map((value) => ({
							label: tick.format(value),
							x: value / gasScale.max,
						}))}
					/>
					<span />
					<Ticks
						className="max-wide:hidden"
						ticks={costScale.ticks.map((value) => ({
							label: value === 0 ? "0" : `${f.int(value)}¢`,
							x: value / costScale.max,
						}))}
					/>
					<span />
					<Ticks
						className="max-wide:hidden"
						ticks={swapsScale.ticks.map((value) => ({
							label: f.int(value),
							x: value / swapsScale.max,
						}))}
					/>
					<span />
				</div>
			</div>
			<FootLine
				source={t("source", { network: network.name, native: network.native.symbol })}
			>
				<span className="max-wide:hidden">{t("note")}</span>
				<span className="wide:hidden">{t("noteCompact")}</span>
			</FootLine>
			<Surplus />
		</Section>
	);
}

/**
 * A solver's dot on one track, against the dashed network average. A value beyond the axis sits
 * at its end, with "›" just after the track; nearer it on compact pages, whose narrower gap would
 * otherwise put it against the value ("›4.78M").
 */
function Track({
	value,
	average,
	max,
	dot,
	label,
	className = "",
}: {
	/** The solver's value in the axis unit; null draws no dot. */
	value: number | null;
	/** The network average in the axis unit. */
	average: number | null;
	/** The axis end. */
	max: number;
	dot: Dot;
	/** What the dot says, for screen readers. */
	label?: string;
	className?: string;
}) {
	return (
		<span
			role={value !== null ? "img" : undefined}
			aria-label={value !== null ? label : undefined}
			className={`relative h-full ${className}`}
		>
			{average !== null ? (
				<span
					className="absolute inset-y-1 border-l border-dashed border-act"
					style={{ left: `${Math.min(1, average / max) * 100}%` }}
				/>
			) : null}
			{value !== null ? (
				<span
					className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] transition-colors duration-200 ${dot.hollow ? "bg-bg" : dot.hot ? "bg-teal" : "bg-fg"} ${dot.hot ? "border-teal" : "border-fg"}`}
					style={{
						left: `${Math.min(1, value / max) * 100}%`,
						width: dot.size,
						height: dot.size,
					}}
				/>
			) : null}
			{value !== null && value > max ? (
				<span
					aria-hidden="true"
					className="absolute top-1/2 left-full translate-x-1 -translate-y-[52%] font-mono text-[13px] leading-[normal] font-medium text-fa wide:translate-x-2"
				>
					›
				</span>
			) : null}
		</span>
	);
}
