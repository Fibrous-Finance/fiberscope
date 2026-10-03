"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";
import { flushSync } from "react-dom";

import { latestSettlements, NETWORKS } from "@fiberscope/core";

import { useDashboard, useHover } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { arrow, Caret, FootLine } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Rows shown until the reader asks for the rest. */
const SHOWN = 10;
/** Settlements this close to the end of the data show a clock time, older ones the day too. */
const RECENT_MS = 12 * 3_600_000;
/** Time, solver, trades, swaps, pair, volume, surplus, cost, gas and links, in every row. */
const GRID =
	"grid grid-cols-[84px_minmax(110px,1fr)_52px_52px_minmax(0,1.7fr)_76px_72px_56px_64px_200px] items-center gap-x-3";

/**
 * The newest settlements of every solver: a table on wide pages that scrolls sideways under
 * 1000px, rows with a wrapping figure list on compact ones. Ten rows at first; a disclosure shows
 * the rest. Hovering a row highlights its solver everywhere.
 */
export function LatestSettlements({ rankIndex }: { rankIndex: Map<string, number> }) {
	const t = useTranslations("Enter.settlements");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { snapshot } = useDashboard();
	const { hovered, setHovered } = useHover();
	const [expanded, setExpanded] = useState(false);

	const { end, network: networkId } = snapshot!;
	const network = NETWORKS[networkId];
	const settlements = latestSettlements(snapshot!);
	const more = settlements.length - SHOWN;
	const rows = (expanded ? settlements : settlements.slice(0, SHOWN)).map((s) => {
		const volume = f.usd(s.volume);
		const surplus = f.usdCents(s.surplus);
		const cost = f.cost(s.cost);
		const gas = f.gas(s.gas);
		return {
			tx: s.tx,
			solver: s.solver,
			hot: isHot(hovered, s.solver.id, rankIndex.get(s.solver.id) ?? -1),
			time: end.time - s.time < RECENT_MS ? f.clock(s.time) : f.dayTime(s.time),
			trades: f.int(s.trades),
			swaps: f.int(s.swaps),
			pair: t("pair", {
				sell: s.pair.sell,
				buy: s.pair.buy,
				more: Math.max(0, s.trades - 1),
			}),
			volume,
			surplus,
			cost,
			gas,
			items: [
				t("items.trades", { trades: s.trades }),
				t("items.swaps", { swaps: s.swaps }),
				t("items.volume", { volume }),
				t("items.surplus", { surplus }),
				t("items.cost", { cost }),
				t("items.gas", { gas }),
			],
			cow: `https://explorer.cow.fi/${network.explorerSlug}/tx/${s.tx}`,
			scan: `${network.scan}/tx/${s.tx}`,
		};
	});

	return (
		<div className="mt-16">
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
				<h3 className="text-[15px] font-medium">{t("title")}</h3>
				<span className="font-mono text-[12px] leading-[normal] font-medium text-mu">
					{t("scope")}
				</span>
			</div>
			{/* Under 1000px the table scrolls sideways rather than squeezing the pair. */}
			<div className="mt-3 hidden overflow-x-auto tabular-nums wide:block">
				<div className="min-w-[1000px]">
					<div
						className={`${GRID} box-content h-[34px] border-b border-ln2 font-mono text-[10.5px] leading-[normal] font-medium tracking-[.06em] text-fa uppercase`}
					>
						<span>{t("columns.time")}</span>
						<span>{t("columns.solver")}</span>
						<span className="text-right">{t("columns.trades")}</span>
						<span className="text-right">{t("columns.swaps")}</span>
						<span className="pl-1.5">{t("columns.pair")}</span>
						<span className="text-right">{t("columns.volume")}</span>
						<span className="text-right">{t("columns.surplus")}</span>
						<span className="text-right">{t("columns.cost")}</span>
						<span className="text-right">{t("columns.gas")}</span>
						<span className="text-right">{t("columns.links")}</span>
					</div>
					{rows.map((row) => (
						<div
							key={row.tx}
							onMouseEnter={() => setHovered(row.solver.id)}
							onMouseLeave={() => setHovered(null)}
							className={`${GRID} box-content h-[38px] border-b border-ln font-mono text-[12.5px] leading-[normal] font-medium transition-colors duration-150 ${row.hot ? "bg-hov" : ""}`}
						>
							<span>{row.time}</span>
							<span
								className={`truncate text-[13.5px] transition-colors duration-200 ${row.solver.unnamed ? "font-mono" : "font-sans"} ${row.hot ? "text-teal" : ""}`}
							>
								{row.solver.label}
							</span>
							<span className="text-right">{row.trades}</span>
							<span className="text-right">{row.swaps}</span>
							<span className="truncate pl-1.5 font-sans text-[13px]">
								{row.pair}
							</span>
							<span className="text-right">{row.volume}</span>
							<span className="text-right">{row.surplus}</span>
							<span className="text-right">{row.cost}</span>
							<span className="text-right">{row.gas}</span>
							<span className="flex justify-end gap-3.5 text-[12px]">
								<a
									href={row.cow}
									target="_blank"
									rel="noopener"
									className="whitespace-nowrap quiet"
								>
									{tc.rich("cowExplorer", { arrow })}
								</a>
								<a
									href={row.scan}
									target="_blank"
									rel="noopener"
									className="whitespace-nowrap quiet"
								>
									{tc.rich("basescan", { arrow })}
								</a>
							</span>
						</div>
					))}
				</div>
			</div>
			<div className="mt-3 border-t border-ln2 tabular-nums wide:hidden">
				{rows.map((row) => (
					<div key={row.tx} className="border-b border-ln pt-2.5 pb-1">
						<div className="flex items-baseline justify-between gap-2.5">
							<span className="flex min-w-0 items-baseline gap-2.5">
								<span className="font-mono text-[12.5px] leading-[normal] font-medium">
									{row.time}
								</span>
								<span
									className={`truncate text-[14px] font-medium ${row.solver.unnamed ? "font-mono" : ""}`}
								>
									{row.solver.label}
								</span>
							</span>
							<span className="flex-none text-[13px] whitespace-nowrap">
								{row.pair}
							</span>
						</div>
						{/*
						 * The figures wrap as whole items. Each item's "·" sits in its 14px
						 * ::before, and the list starts 14px left of the clipped edge, so a line
						 * never begins with one. The links end the list at 44px tall, their
						 * negative margins keeping the line gap of the figures. Clipping only
						 * sideways keeps the links' overhang tappable.
						 */}
						<div className="overflow-x-clip">
							<div className="-ml-3.5 flex flex-wrap items-center font-mono text-[11.5px] leading-[normal] font-medium text-mu">
								{row.items.map((item, index) => (
									<span
										key={index}
										className="py-1.5 whitespace-nowrap before:inline-block before:w-3.5 before:text-center before:content-['·']"
									>
										{item}
									</span>
								))}
								<span className="-my-[11px] ml-auto flex gap-[18px] pl-3.5">
									<a
										href={row.cow}
										target="_blank"
										rel="noopener"
										className="flex min-h-11 items-center whitespace-nowrap quiet"
									>
										{tc.rich("explorer", { arrow })}
									</a>
									<a
										href={row.scan}
										target="_blank"
										rel="noopener"
										className="flex min-h-11 items-center whitespace-nowrap quiet"
									>
										{tc.rich("basescan", { arrow })}
									</a>
								</span>
							</div>
						</div>
					</div>
				))}
			</div>
			{more > 0 ? (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={(event) => {
						const button = event.currentTarget;
						const top = button.getBoundingClientRect().top;
						flushSync(() => setExpanded(!expanded));
						// Show fewer removes the rows above the button: scroll back so it stays where
						// it was, under the pointer, rather than far above the viewport.
						if (expanded)
							window.scrollBy({
								top: button.getBoundingClientRect().top - top,
								behavior: "instant",
							});
					}}
					className="flex h-[52px] w-full items-center gap-2.5 border-b border-ln text-left font-mono text-[12px] leading-[normal] font-medium text-mu transition-colors duration-200 hover:text-fg wide:h-11"
				>
					{expanded ? t("fewer") : t("more", { count: more })}
					<Caret open={expanded} />
				</button>
			) : null}
			<FootLine source={t("source", { network: tc("network") })}>{t("note")}</FootLine>
		</div>
	);
}
