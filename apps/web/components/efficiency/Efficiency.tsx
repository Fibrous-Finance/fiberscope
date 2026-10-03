"use client";

import { useTranslations } from "next-intl";

import { DASH, FEW_TRADES, sortRows, swapsAxis } from "@fiberscope/core";

import { useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { Surplus } from "@/components/surplus/Surplus";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** The gas axis runs to at least 2M, in 500K ticks. */
const AXIS_MIN = 2_000_000;
const AXIS_STEP = 500_000;
/** Dot diameters in px, by √trades. */
const DOT_MIN = 7;
const DOT_MAX = 18;

/**
 * Desktop: name | gas track | gas value | swaps track | swaps value. Compact: the swaps track is
 * hidden and the swaps value takes the last column.
 */
const GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_46px_38px] gap-2.5 wide:grid-cols-[clamp(96px,16vw,190px)_minmax(0,1.7fr)_56px_minmax(0,1fr)_44px] wide:gap-4";

const VALUE = "text-right font-mono text-[12.5px] leading-[normal] font-medium";

/** How efficiently: gas and DEX swaps per trade for every solver, lowest gas first. */
export function Efficiency() {
	const t = useTranslations("Efficiency");
	const f = useFormat();
	const view = useView();
	const { hovered, setHovered } = useHover();
	const { average, max, lowest, minBatches } = view.gas;
	const swaps = view.swaps;

	const rows = sortRows(view.rows, { key: "gas", direction: 1 }).filter(
		(row) => row.gasPerTrade !== null
	);
	const axisMax = Math.max(AXIS_MIN, Math.ceil((max ?? 0) / AXIS_STEP) * AXIS_STEP);
	const ticks = Array.from({ length: axisMax / AXIS_STEP + 1 }, (_, i) => i * AXIS_STEP);
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
					<span>{t("header.gas", { average: f.gas(average) })}</span>
					<span />
					<span className="max-wide:hidden">
						{swaps.average !== null
							? t("header.swaps", { average: f.fixed(swaps.average, 2) })
							: null}
					</span>
					<span className="text-right wide:invisible">{t("header.swapsShort")}</span>
				</div>
				{rows.map((row) => {
					const gas = row.gasPerTrade ?? 0;
					const perTrade = row.swapsPerTrade;
					const hot = isHot(hovered, row.id, row.rank - 1);
					const size = DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(row.trades / maxTrades);
					const dot = `absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] transition-colors duration-200 ${row.trades < FEW_TRADES ? "bg-bg" : hot ? "bg-teal" : "bg-fg"} ${hot ? "border-teal" : "border-fg"}`;
					return (
						<div
							key={row.id}
							onMouseEnter={() => setHovered(row.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${GRID} h-[31px] items-center border-t border-ln`}
						>
							<span
								className={`truncate text-[13.5px] font-medium ${row.unnamed ? "font-mono" : ""} ${hot ? "text-teal" : ""}`}
							>
								{row.label}
							</span>
							<span
								role="img"
								aria-label={t("dot", { gas: f.gas(gas), trades: row.trades })}
								className="relative h-full"
							>
								{average !== null ? (
									<span
										className="absolute inset-y-1 border-l border-dashed border-act"
										style={{ left: `${(average / axisMax) * 100}%` }}
									/>
								) : null}
								<span
									className={dot}
									style={{
										left: `${(gas / axisMax) * 100}%`,
										width: size,
										height: size,
									}}
								/>
							</span>
							<span className={VALUE}>{f.gas(gas)}</span>
							<span
								role={perTrade !== null ? "img" : undefined}
								aria-label={
									perTrade !== null
										? t("swapsDot", {
												swaps: f.fixed(perTrade, 2),
												trades: row.trades,
											})
										: undefined
								}
								className="relative h-full max-wide:hidden"
							>
								{swaps.average !== null ? (
									<span
										className="absolute inset-y-1 border-l border-dashed border-act"
										style={{
											left: `${Math.min(1, swaps.average / swapsScale.max) * 100}%`,
										}}
									/>
								) : null}
								{perTrade !== null ? (
									<span
										className={dot}
										style={{
											left: `${Math.min(1, perTrade / swapsScale.max) * 100}%`,
											width: size,
											height: size,
										}}
									/>
								) : null}
								{perTrade !== null && perTrade > swapsScale.max ? (
									<span
										aria-hidden="true"
										className="absolute top-1/2 left-full translate-x-2 -translate-y-[52%] font-mono text-[13px] leading-[normal] font-medium text-fa"
									>
										›
									</span>
								) : null}
							</span>
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
						ticks={ticks.map((value) => ({
							value,
							label: tick.format(value),
							x: value / axisMax,
						}))}
					/>
					<span />
					<Ticks
						className="max-wide:hidden"
						ticks={swapsScale.ticks.map((value) => ({
							value,
							label: f.int(value),
							x: value / swapsScale.max,
						}))}
					/>
					<span />
				</div>
			</div>
			<FootLine source={t("source")}>
				<span className="max-wide:hidden">{t("note")}</span>
				<span className="wide:hidden">{t("noteCompact")}</span>
			</FootLine>
			<Surplus />
		</Section>
	);
}

/** An axis under a track: the first label starts at 0, the last ends at the track's end. */
function Ticks({
	ticks,
	className = "",
}: {
	ticks: { value: number; label: string; x: number }[];
	className?: string;
}) {
	return (
		<span className={`relative h-3.5 ${className}`}>
			{ticks.map(({ value, label, x }) => (
				<span
					key={value}
					className={`absolute ${x === 0 ? "" : x === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
					style={{ left: `${x * 100}%` }}
				>
					{label}
				</span>
			))}
		</span>
	);
}
