"use client";

import { useTranslations } from "next-intl";

import { FEW_TRADES, sortRows } from "@fiberscope/core";

import { useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { FootLine, Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** The gas axis runs to at least 2M, in 500K ticks. */
const AXIS_MIN = 2_000_000;
const AXIS_STEP = 500_000;
/** Dot diameters in px, by √trades. */
const DOT_MIN = 7;
const DOT_MAX = 18;

/** Name | track | value: the gas rows and their axis. */
const GAS_GRID = "grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_56px] gap-4";

/** How efficiently: gas per trade for every solver, lowest first, against the network average. */
export function Efficiency() {
	const t = useTranslations("Efficiency");
	const f = useFormat();
	const view = useView();
	const { hovered, setHovered } = useHover();
	const { average, max, lowest, minBatches } = view.gas;

	const rows = sortRows(view.rows, { key: "gas", direction: 1 }).filter(
		(row) => row.gasPerTrade !== null
	);
	const axisMax = Math.max(AXIS_MIN, Math.ceil((max ?? 0) / AXIS_STEP) * AXIS_STEP);
	const ticks = Array.from({ length: axisMax / AXIS_STEP + 1 }, (_, i) => i * AXIS_STEP);
	// Tick labels drop the trailing zeros Format.gas keeps: 1M, 1.5M.
	const tick = new Intl.NumberFormat(f.locale, { notation: "compact", maximumFractionDigits: 1 });
	const maxTrades = Math.max(...rows.map((row) => row.trades));

	const sentence =
		lowest && average !== null
			? t(lowest.batches >= minBatches ? "sentence" : "sentenceAll", {
					solver: lowest.label,
					minBatches: f.int(minBatches),
					gas: f.gas(lowest.gasPerTrade),
					average: f.gas(average),
				})
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
						{t("legend.average", { value: f.gas(average) })}
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
			<div className="mt-3.5">
				{rows.map((row) => {
					const gas = row.gasPerTrade ?? 0;
					const hot = isHot(hovered, row.id, row.rank - 1);
					const size = DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(row.trades / maxTrades);
					return (
						<div
							key={row.id}
							onMouseEnter={() => setHovered(row.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${GAS_GRID} h-[31px] items-center border-t border-ln`}
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
									className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] transition-colors duration-200 ${row.trades < FEW_TRADES ? "bg-bg" : hot ? "bg-teal" : "bg-fg"} ${hot ? "border-teal" : "border-fg"}`}
									style={{
										left: `${(gas / axisMax) * 100}%`,
										width: size,
										height: size,
									}}
								/>
							</span>
							<span className="text-right font-mono text-[12.5px] leading-[normal] font-medium">
								{f.gas(gas)}
							</span>
						</div>
					);
				})}
				<div
					className={`${GAS_GRID} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
				>
					<span />
					<span className="relative h-3.5">
						{ticks.map((value) => (
							<span
								key={value}
								className={`absolute ${value === 0 ? "" : value === axisMax ? "-translate-x-full" : "-translate-x-1/2"}`}
								style={{ left: `${(value / axisMax) * 100}%` }}
							>
								{tick.format(value)}
							</span>
						))}
					</span>
					<span />
				</div>
			</div>
			<FootLine source={t("source")} />
		</Section>
	);
}
