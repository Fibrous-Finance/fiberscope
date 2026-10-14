"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";
import { flushSync } from "react-dom";

import { auctionDetails, DASH, latestSettlements, NETWORKS } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { ScrollMoreFade, useScrollMore } from "@/components/ui/ScrollMore";
import { arrow, Caret, FootLine } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Rows shown until the reader asks for the rest. */
const SHOWN = 10;
/** Settlements this close to the end of the data show a clock time, older ones the day too. */
const RECENT_MS = 12 * 3_600_000;
/**
 * Time, solver, trades, pair, volume, surplus, cost, protocol fee, partner fee, quoted by and
 * links, in every row.
 */
const GRID =
	"grid grid-cols-[84px_minmax(100px,1fr)_52px_minmax(0,1.4fr)_76px_72px_56px_84px_78px_minmax(96px,1fr)_200px] items-center gap-x-3";
/**
 * A compact row's links are 44px tall for touch, taller than the line they end, so their focus
 * ring goes around the label instead and stays off the figures above.
 */
const COMPACT_LINK = "flex min-h-11 items-center whitespace-nowrap quiet focus-label";
/**
 * Time stays in view while the table scrolls sideways: opaque, the full row tall, and its colour
 * carried over the column gap so nothing shows between it and the next column. It stays below the
 * fade on the right edge, and takes the row's colour as the row does when its solver is hovered.
 */
const STICKY_TIME =
	"sticky left-0 z-1 flex items-center self-stretch transition-[background-color,box-shadow] duration-150";
const STICKY_TIME_BG = "bg-bg shadow-[12px_0_0_var(--bg)]";
const STICKY_TIME_HOT = "bg-hov shadow-[12px_0_0_var(--hov)]";

/**
 * The newest settlements of every solver, under the window's fee totals: a table on wide pages
 * that scrolls sideways below about 1230px, rows with a wrapping figure list on compact ones. Ten
 * rows at first; a disclosure shows the rest. Hovering a row highlights its solver everywhere.
 */
export function LatestSettlements({ rankIndex }: { rankIndex: Map<string, number> }) {
	const t = useTranslations("Enter.settlements");
	const tc = useTranslations("Common");
	const th = useTranslations("Hero");
	const f = useFormat();
	const view = useView();
	const { snapshot, status } = useDashboard();
	const { hovered, setHovered } = useHover();
	const [expanded, setExpanded] = useState(false);
	const { ref: scroller, more: moreColumns } = useScrollMore();

	// The fee totals are the window's, over its days with auction details ("the last 7 days" in
	// a longer window); the rows below are the latest settlements and carry their own fees.
	const { coverage, network: fees } = auctionDetails(snapshot!, view);
	const feeSentence =
		coverage > 0
			? t("fees", {
					span: status.delayed
						? th("span.to", { days: coverage, asOf: status.asOf ?? "" })
						: th("span.last", { days: coverage }),
					protocol: f.usdWhole(fees.protocolFees),
					protocolBps: f.bps1(fees.protocolFeeRate),
					partner: f.usdWhole(fees.partnerFees),
					partnerBps: f.bps1(fees.partnerFeeRate),
				})
			: t("feesEmpty", {
					period: tc(`period.${view.period}`),
					delayed: status.delayed ? "yes" : "no",
					asOf: status.asOf ?? "",
					// With auction data but no details yet, the details are what's missing.
					auctions: view.coverage.auction > 0 ? "some" : "none",
				});

	const { end, network: networkId } = snapshot!;
	const network = NETWORKS[networkId];
	const settlements = latestSettlements(snapshot!);
	const more = settlements.length - SHOWN;
	const rows = (expanded ? settlements : settlements.slice(0, SHOWN)).map((s) => {
		const time = end.time - s.time < RECENT_MS ? f.clock(s.time) : f.dayTime(s.time);
		const volume = f.usd(s.volume);
		const surplus = f.usdCents(s.surplus);
		const cost = f.cost(s.cost);
		const protocolFee = f.cost(s.protocolFee);
		const partnerFee = f.cost(s.partnerFee);
		const pair = { sell: s.pair.sell, buy: s.pair.buy, more: Math.max(0, s.trades - 1) };
		// The pair in full: the title of the table's cell, the links' names and the phone rows.
		const pairText = t.markup("pair", {
			...pair,
			swap: (chunks) => chunks,
			extra: (chunks) => chunks,
		});
		return {
			tx: s.tx,
			solver: s.solver,
			hot: isHot(hovered, s.solver.id, rankIndex.get(s.solver.id) ?? -1),
			time,
			trades: f.int(s.trades),
			quotedBy: s.quotedBy,
			// The quoting solver is highlighted wherever it appears, as the settling one is.
			quotedHot:
				s.quotedBy !== null &&
				isHot(hovered, s.quotedBy.id, rankIndex.get(s.quotedBy.id) ?? -1),
			pair: pairText,
			// In the table, a long "sell → buy" gives way before " +N".
			pairCell: t.rich("pair", {
				...pair,
				swap: (chunks) => <span className="truncate">{chunks}</span>,
				extra: (chunks) => <span className="flex-none">{chunks}</span>,
			}),
			volume,
			surplus,
			cost,
			protocolFee,
			partnerFee,
			items: [
				t("items.trades", { trades: s.trades }),
				t("items.volume", { volume }),
				t("items.surplus", { surplus }),
				t("items.cost", { cost }),
				t("items.protocolFee", { fee: protocolFee }),
				t("items.partnerFee", { fee: partnerFee }),
				...(s.quotedBy ? [t("items.quotedBy", { solver: s.quotedBy.label })] : []),
			],
			cow: `https://explorer.cow.fi/${network.explorerSlug}/tx/${s.tx}`,
			scan: `${network.scan}/tx/${s.tx}`,
			// Every row has the same two links: their names say which settlement they open.
			cowLabel: tc("cowExplorerLabel", { time, pair: pairText }),
			scanLabel: tc("basescanLabel", { time, pair: pairText }),
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
			<p className="mt-2.5 max-w-[720px] text-[15px] leading-[1.55] text-pretty text-mu">
				{feeSentence}
			</p>
			{/*
			 * Below about 1230px the table scrolls sideways rather than squeezing the pair, and a
			 * fade on the right says more columns follow. The scroller's end padding, taken back by
			 * the wrapper's negative margin, leaves the last link's focus ring room to show.
			 */}
			<div className="relative mt-3 -mr-1 hidden wide:block">
				<div ref={scroller} className="scroll-pr-1 overflow-x-auto pr-1 tabular-nums">
					{/* A table to assistive tech, as the leaderboard: each figure goes with its column. */}
					<div role="table" aria-label={t("title")} className="min-w-[1140px]">
						<div
							role="row"
							className={`${GRID} box-content h-[34px] border-b border-ln2 font-mono text-[10.5px] leading-[normal] font-medium tracking-[.06em] whitespace-nowrap text-fa uppercase`}
						>
							<span
								role="columnheader"
								className={`${STICKY_TIME} ${STICKY_TIME_BG}`}
							>
								{t("columns.time")}
							</span>
							<span role="columnheader">{t("columns.solver")}</span>
							<span role="columnheader" className="text-right">
								{t("columns.trades")}
							</span>
							<span role="columnheader" className="pl-1.5">
								{t("columns.pair")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.volume")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.surplus")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.cost")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.protocolFee")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.partnerFee")}
							</span>
							<span role="columnheader" className="pl-1.5">
								{t("columns.quotedBy")}
							</span>
							<span role="columnheader" className="text-right">
								{t("columns.links")}
							</span>
						</div>
						{rows.map((row) => (
							<div
								key={row.tx}
								role="row"
								onMouseEnter={() => setHovered(row.solver.id)}
								onMouseLeave={() => setHovered(null)}
								className={`${GRID} box-content h-[38px] border-b border-ln font-mono text-[12.5px] leading-[normal] font-medium transition-colors duration-150 ${row.hot ? "bg-hov" : ""}`}
							>
								<span
									role="cell"
									className={`${STICKY_TIME} ${row.hot ? STICKY_TIME_HOT : STICKY_TIME_BG}`}
								>
									{row.time}
								</span>
								<span
									role="cell"
									title={row.solver.label}
									className={`truncate text-[13.5px] transition-colors duration-200 ${row.solver.unnamed ? "font-mono" : "font-sans"} ${row.hot ? "text-hvt" : ""}`}
								>
									{row.solver.label}
								</span>
								<span role="cell" className="text-right">
									{row.trades}
								</span>
								<span
									role="cell"
									title={row.pair}
									className="flex min-w-0 pl-1.5 font-sans text-[13px] whitespace-nowrap"
								>
									{row.pairCell}
								</span>
								<span role="cell" className="text-right">
									{row.volume}
								</span>
								<span role="cell" className="text-right">
									{row.surplus}
								</span>
								<span role="cell" className="text-right">
									{row.cost}
								</span>
								<span role="cell" className="text-right">
									{row.protocolFee}
								</span>
								<span role="cell" className="text-right">
									{row.partnerFee}
								</span>
								<span
									role="cell"
									title={row.quotedBy?.label}
									className={`truncate pl-1.5 text-[13px] transition-colors duration-200 ${row.quotedBy?.unnamed ? "font-mono" : "font-sans"} ${row.quotedHot ? "text-hvt" : ""}`}
								>
									{row.quotedBy?.label ?? DASH}
								</span>
								<span role="cell" className="flex justify-end gap-3.5 text-[12px]">
									<a
										href={row.cow}
										target="_blank"
										rel="noopener"
										aria-label={row.cowLabel}
										className="whitespace-nowrap quiet"
									>
										{tc.rich("cowExplorer", { arrow })}
									</a>
									<a
										href={row.scan}
										target="_blank"
										rel="noopener"
										aria-label={row.scanLabel}
										className="whitespace-nowrap quiet"
									>
										{tc.rich("basescan", { arrow })}
									</a>
								</span>
							</div>
						))}
					</div>
				</div>
				<ScrollMoreFade more={moreColumns} />
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
									title={row.solver.label}
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
						 * The figures wrap as whole items; one longer than the line ends in an
						 * ellipsis. Each item's "·" sits in its 14px ::before, and the list starts
						 * 14px left of the clipped edge, so a line never begins with one. The links
						 * end the list at 44px tall, their negative margins keeping the line gap of
						 * the figures. Clipping only sideways keeps the links' overhang tappable;
						 * the end padding, taken back by the negative margin, leaves the last
						 * link's focus ring room.
						 */}
						<div className="-mr-1 overflow-x-clip pr-1">
							<div className="-ml-3.5 flex flex-wrap items-center font-mono text-[11.5px] leading-[normal] font-medium text-mu">
								{row.items.map((item, index) => (
									<span
										key={index}
										className="truncate py-1.5 before:inline-block before:w-3.5 before:text-center before:content-['·']"
									>
										{item}
									</span>
								))}
								<span className="-my-[11px] ml-auto flex gap-[18px] pl-3.5">
									<a
										href={row.cow}
										target="_blank"
										rel="noopener"
										aria-label={row.cowLabel}
										className={COMPACT_LINK}
									>
										<span>{tc.rich("explorer", { arrow })}</span>
									</a>
									<a
										href={row.scan}
										target="_blank"
										rel="noopener"
										aria-label={row.scanLabel}
										className={COMPACT_LINK}
									>
										<span>{tc.rich("basescan", { arrow })}</span>
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
