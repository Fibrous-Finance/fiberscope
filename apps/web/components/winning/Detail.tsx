"use client";

import { useTranslations } from "next-intl";

import {
	autoRange,
	BASE,
	DASH,
	linePath,
	mediumAddress,
	registrationOf,
	shortAddress,
	surplusAndCost,
	tapeCell,
} from "@fiberscope/core";
import type { LinePath, Row, TapeCell } from "@fiberscope/core";

import { useDashboard, useView } from "@/components/dashboard/context";
import { arrow } from "@/components/ui/Section";
import { cellText, useColumnLabels } from "@/components/winning/columns";
import { useCopy } from "@/components/winning/useCopy";

import { useFormat } from "@/lib/format";

/** The detail under an open row: two blocks on desktop, one stack in the compact list. */

/** Below this visible table width, the first block moves its third column underneath. */
const NARROW_TABLE = 1120;
/** Below this visible table width, a medium address (0x012345…234567) no longer fits its column. */
const SHORT_ADDRESS_TABLE = 720;
/** The share chart's y-range spans at least 4 percentage points. */
const MIN_SPAN = 0.04;
/** The strip shows this many of the latest auctions, oldest first. */
const LATEST_AUCTIONS = 24;
/** Settlements this close to the end of the window show a clock time, older ones the day too. */
const RECENT_MS = 12 * 3_600_000;
/** "Copied ✓" stays this long after copying an address. */
const COPIED_MS = 1500;
const COW_TX = `https://explorer.cow.fi/${BASE.explorerSlug}/tx/`;

/** Compact labels: Geist Mono 10.5px, uppercase. */
const SMALL_LABEL =
	"font-mono text-[10.5px] leading-[normal] font-medium tracking-[.06em] text-mu uppercase";
/** "Retired" in place of an address's actions. */
const RETIRED = "text-[10.5px] tracking-[.06em] text-fa uppercase";
/**
 * Time, trades, swaps, pair, volume, surplus, cost, gas and links; the header and every
 * settlement share it.
 */
const SETTLEMENT_GRID =
	"grid grid-cols-[96px_46px_46px_minmax(0,1fr)_76px_72px_56px_56px_200px] items-center gap-3";
/** The compact settlement's figures, in order, as one wrapping list. */
const SETTLEMENT_ITEMS = ["trades", "swaps", "volume", "surplus", "cost", "gas"] as const;

/** A won auction is a square, an entered one a dot, one it did not enter a faint speck. */
const DOT: Record<TapeCell["state"], string> = {
	won: "size-2 rounded-[2px] bg-fg",
	entered: "size-1 rounded-full bg-[color-mix(in_oklab,var(--fg)_45%,transparent)]",
	absent: "size-0.5 rounded-full bg-ln2",
};

interface AuctionCell {
	id: number;
	state: TapeCell["state"];
	/** The settlement in CoW Explorer; null when the auction never settled. */
	href: string | null;
	title: string;
}

/** Everything both layouts show, formatted. */
function useDetail(row: Row) {
	const view = useView();
	const { snapshot } = useDashboard();
	const t = useTranslations("Winning");
	const tc = useTranslations("Common");
	const f = useFormat();
	const labels = useColumnLabels();

	const [lo, hi] = autoRange(row.daily, MIN_SPAN);
	const first = row.daily[0] ?? 0;
	const last = row.daily.at(-1) ?? 0;
	const start = f.day(view.history[0] ?? view.start);
	const end = f.day(view.history.at(-1) ?? view.end.time);
	const measure = tc(`measure.${view.measure}`);

	const noData = t("detail.stats.noAuctionData");
	const gasAverage = view.gas.average;
	const gasMax = view.gas.max;
	const gasDiff =
		row.gasPerTrade !== null && gasAverage ? row.gasPerTrade / gasAverage - 1 : null;
	const entrants = view.rows.filter((r) => r.entered);
	const participation =
		entrants.reduce((a, r) => a + (r.participation ?? 0), 0) / (entrants.length || 1);
	// The network's batch value: all volume over all batches of the days with auction data.
	const pricedBatches = (snapshot?.solvers ?? []).reduce(
		(total, s) => total + s.batches.slice(0, view.coverage.auction).reduce((a, b) => a + b, 0),
		0
	);
	const batchValue =
		view.totals.volume !== null && pricedBatches > 0
			? view.totals.volume / pricedBatches
			: null;
	const swaps = view.swaps.average;
	// Cost per trade and typical surplus, the solver's and the network's.
	const { rows: figures, network } = surplusAndCost(snapshot!, view);
	const own = figures.get(row.id);
	const typical = own?.typicalSurplusRate ?? null;
	const auctionData = view.coverage.auction > 0;

	// Without auction data in the window the strip stays empty, as the auction stats do.
	const cells: AuctionCell[] = (auctionData ? (snapshot?.latestAuctions ?? []) : [])
		.slice(-LATEST_AUCTIONS)
		.map((auction) => {
			const { state, tx } = tapeCell(auction, row.id);
			return {
				id: auction.id,
				state,
				href: tx === null ? null : COW_TX + tx,
				title: t("detail.auction", {
					id: f.int(auction.id),
					time: tc("utc", { time: f.clock(auction.time) }),
					state,
					link: tx === null ? "no" : "yes",
				}),
			};
		});
	const rank = (value: number | null) =>
		value === null ? DASH : t("detail.rank", { rank: value });
	const registration = registrationOf(snapshot?.registry ?? [], row);

	return {
		// The big value is the window's share, so the label names the window (the chart's own
		// span is under it): the days its measure has data for.
		title: t("detail.shareOf", {
			measure,
			days: view.measure === "volume" ? view.coverage.auction : view.coverage.chain,
		}),
		share: f.percent(row.share, 1),
		trend: t("detail.trend", {
			points: tc("points", { value: f.points((last - first) * 100) }),
			date: start,
		}),
		chart: linePath(row.daily, lo, hi, 100, 50),
		chartLabel: t("detail.chart", {
			measure,
			start,
			end,
			first: f.percent(first, 1),
			last: f.percent(last, 1),
		}),
		start,
		end,
		/** Ten stats, two to a row: cost next to gas, typical surplus after the swaps. */
		stats: [
			{
				key: "batches",
				label: labels.batches,
				value: cellText(row, "batches", f),
				note: t("detail.stats.batches", { share: f.percent(row.shares.batches, 1) }),
			},
			{
				key: "trades",
				label: labels.trades,
				value: cellText(row, "trades", f),
				note:
					row.tradesPerBatch === null
						? DASH
						: t("detail.stats.trades", { count: f.fixed(row.tradesPerBatch, 2) }),
			},
			{
				key: "volume",
				label: labels.volume,
				value: cellText(row, "volume", f),
				note:
					row.averageTrade === null
						? noData
						: t("detail.stats.volume", { value: f.usd(row.averageTrade) }),
			},
			{
				key: "batchValue",
				label: t("detail.labels.batchValue"),
				value: f.usd(row.batchValue),
				note:
					batchValue === null
						? noData
						: t("detail.stats.average", { value: f.usd(batchValue) }),
			},
			{
				key: "gas",
				label: labels.gas,
				value: cellText(row, "gas", f),
				note:
					gasDiff === null
						? DASH
						: t("detail.stats.gas", {
								percent: f.percent(Math.abs(gasDiff)),
								// Within half a percent the difference would read "0%": the same.
								direction:
									Math.round(Math.abs(gasDiff) * 100) === 0
										? "same"
										: gasDiff < 0
											? "below"
											: "above",
							}),
			},
			{
				key: "cost",
				label: t("detail.labels.cost"),
				value: f.cost(own?.costPerTrade ?? null),
				note:
					network.costPerTrade === null
						? DASH
						: t("detail.stats.cost", { value: f.cost(network.costPerTrade) }),
			},
			{
				key: "swaps",
				label: t("detail.labels.swaps"),
				value: row.swapsPerTrade === null ? DASH : f.fixed(row.swapsPerTrade, 2),
				note:
					swaps === null ? DASH : t("detail.stats.average", { value: f.fixed(swaps, 2) }),
			},
			{
				key: "surplus",
				label: t("detail.labels.surplus"),
				value:
					typical === null
						? DASH
						: t("detail.stats.surplusValue", { bps: f.bps(typical) }),
				note: !auctionData
					? noData
					: typical === null
						? t("detail.stats.noSurplusData")
						: t("detail.stats.surplus", {
								share: own?.unusualShare ? f.percent(own.unusualShare) : "none",
							}),
			},
			{
				key: "participation",
				label: labels.participation,
				value: cellText(row, "participation", f),
				note: row.entered
					? t("detail.stats.participation", { percent: f.percent(participation) })
					: noData,
			},
			{
				key: "winRate",
				label: labels.winRate,
				value: cellText(row, "winRate", f),
				note:
					row.entered && row.wonShare !== null
						? t("detail.stats.winRate", { percent: f.percent(row.wonShare, 1) })
						: noData,
			},
		],
		auctions: {
			title: t("detail.auctions", { count: cells.length }),
			note:
				cells.length > 0
					? t("detail.auctionsNote", {
							entered: cells.filter((c) => c.state !== "absent").length,
							won: cells.filter((c) => c.state === "won").length,
							count: cells.length,
						})
					: noData,
			cells,
		},
		ranks: t("detail.rankLine", {
			batches: rank(row.ranks.batches),
			trades: rank(row.ranks.trades),
			volume: rank(row.ranks.volume),
		}),
		gas: {
			/** Positions on the scale, in % of the highest gas per trade. */
			solver: row.gasPerTrade !== null && gasMax ? (row.gasPerTrade / gasMax) * 100 : null,
			average: gasAverage !== null && gasMax ? (gasAverage / gasMax) * 100 : null,
			label: t("detail.gasScale", {
				gas: f.gas(row.gasPerTrade),
				average: f.gas(gasAverage),
			}),
		},
		/** "Active" or "Inactive"; null for a solver the registry does not list. */
		registry:
			registration.active === null
				? null
				: t("registry.status", { status: registration.active ? "active" : "inactive" }),
		addresses: registration.addresses.map((a) => ({
			key: `${a.env}:${a.address}`,
			label: t(`detail.env.${a.env}`),
			address: a.address,
			medium: mediumAddress(a.address),
			short: shortAddress(a.address),
			retired: !a.active,
			href: `${BASE.scan}/address/${a.address}`,
		})),
		settlements: row.latestSettlements.map((s) => {
			const volume = f.usd(s.volume);
			const surplus = f.usdCents(s.surplus);
			const cost = f.cost(s.cost);
			const gas = f.gas(s.gas);
			const values = { trades: s.trades, swaps: s.swaps, volume, surplus, cost, gas };
			return {
				tx: s.tx,
				time: view.end.time - s.time < RECENT_MS ? f.clock(s.time) : f.dayTime(s.time),
				trades: f.int(s.trades),
				swaps: f.int(s.swaps),
				pair: t("detail.pair", { sell: s.pair.sell, buy: s.pair.buy, more: s.trades - 1 }),
				volume,
				surplus,
				cost,
				gas,
				items: SETTLEMENT_ITEMS.map((key) => ({
					key,
					text: t(`detail.settlementItems.${key}`, values),
				})),
				cow: COW_TX + s.tx,
				scan: `${BASE.scan}/tx/${s.tx}`,
			};
		}),
	};
}

/**
 * The desktop detail. Both blocks are pinned to the left edge at the visible table width, so they
 * stay in view while the table scrolls sideways; `width` is 0 until the table has measured itself.
 */
export function DetailWide({ row, width }: { row: Row; width: number }) {
	const d = useDetail(row);
	const t = useTranslations("Winning");
	const tc = useTranslations("Common");
	const [copied, copy] = useCopy(COPIED_MS);
	const narrow = width > 0 && width < NARROW_TABLE;
	const tight = width > 0 && width < SHORT_ADDRESS_TABLE;
	const pinned = { width: width > 0 ? width : "100%" };

	return (
		<>
			<div
				style={pinned}
				className={`sticky left-0 z-3 grid cursor-default gap-x-9 gap-y-7 bg-bg pt-6 pb-7 pl-[52px] ${narrow ? "grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]"}`}
			>
				<div className="min-w-0">
					<div className="label">{d.title}</div>
					<div className="mt-2 flex items-baseline gap-2.5">
						<span className="font-mono text-[28px] leading-none font-medium tracking-[-0.04em]">
							{d.share}
						</span>
						<span className="font-mono text-[12px] leading-[normal] font-medium text-mu">
							{d.trend}
						</span>
					</div>
					<ShareChart chart={d.chart} label={d.chartLabel} className="mt-3.5 h-[84px]" />
					<div className="mt-1.5 flex justify-between font-mono text-[11px] leading-[normal] font-medium text-fa">
						<span>{d.start}</span>
						<span>{d.end}</span>
					</div>
					<div className="mt-7">
						<div className="flex items-baseline justify-between gap-3">
							<span className="label">{t("detail.addresses")}</span>
							{d.registry === null ? null : (
								<span className="font-mono text-[11px] leading-[normal] font-medium whitespace-nowrap text-fa">
									{d.registry}
								</span>
							)}
						</div>
						<div className="mt-2">
							{d.addresses.map((a) => (
								<div
									key={a.key}
									className="box-content grid h-10 grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 border-b border-ln"
								>
									<span className="label">{a.label}</span>
									<span
										title={a.address}
										className={`truncate font-mono text-[12.5px] leading-[normal] font-medium ${a.retired ? "text-fa" : ""}`}
									>
										{tight ? a.short : a.medium}
									</span>
									{/* Copy and Basescan: 24px targets that do not space the row out. */}
									<span className="flex gap-3.5 font-mono text-[12px] leading-[normal] font-medium">
										{a.retired ? (
											<span className={RETIRED}>{t("retired")}</span>
										) : (
											<>
												<button
													type="button"
													onClick={() => copy(a.address)}
													className="-my-1 py-1 whitespace-nowrap quiet"
												>
													{copied === a.address
														? tc("copied")
														: tc("copy")}
												</button>
												<a
													href={a.href}
													target="_blank"
													rel="noopener"
													className="-my-1 py-1 whitespace-nowrap quiet"
												>
													{tc.rich("basescan", { arrow })}
												</a>
											</>
										)}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
				<div className="grid grid-cols-2 content-start gap-x-5 gap-y-[18px]">
					{d.stats.map((stat) => (
						<div key={stat.key} className="min-w-0">
							<div className="label">{stat.label}</div>
							<div className="mt-1 font-mono text-[18px] leading-[normal] font-medium tracking-[-0.03em]">
								{stat.value}
							</div>
							<div className="mt-0.5 text-[12.5px] text-balance text-mu">
								{stat.note}
							</div>
						</div>
					))}
				</div>
				<div
					className={`min-w-0 gap-x-9 gap-y-[18px] ${narrow ? "col-span-full grid grid-cols-3" : "flex flex-col"}`}
				>
					<div>
						<div className="label">{d.auctions.title}</div>
						<AuctionStrip cells={d.auctions.cells} className="mt-2.5" />
						<div className="mt-1.5 text-[12.5px] text-mu">{d.auctions.note}</div>
					</div>
					<div>
						<div className="label">{t("detail.ranks")}</div>
						<div className="mt-1.5 font-mono text-[13px] leading-[normal] font-medium">
							{d.ranks}
						</div>
					</div>
					<div>
						<div className="label">{t("detail.gasVsNetwork")}</div>
						<div role="img" aria-label={d.gas.label} className="relative mt-2 h-5">
							<div className="absolute inset-x-0 top-1/2 h-px bg-ln2" />
							{d.gas.average === null ? null : (
								<div
									style={{ left: `${d.gas.average}%` }}
									className="absolute top-0.5 bottom-0.5 border-l border-dashed border-act"
								/>
							)}
							{d.gas.solver === null ? null : (
								<span
									style={{ left: `${d.gas.solver}%` }}
									className="absolute top-1/2 -mt-[5.5px] -ml-[5.5px] size-[11px] rounded-full bg-fg"
								/>
							)}
						</div>
						<div className="mt-1 flex justify-between gap-2 font-mono text-[11px] leading-[normal] font-medium text-fa">
							<span>{t("detail.lower")}</span>
							<span>{t("detail.networkAverage")}</span>
							<span>{t("detail.higher")}</span>
						</div>
					</div>
				</div>
			</div>
			<div
				style={pinned}
				className="sticky left-0 z-3 cursor-default border-b border-ln bg-bg pt-1 pb-[30px] pl-[52px]"
			>
				<div className="label">{t("detail.settlements")}</div>
				{/* Narrower than the grid, the settlements scroll sideways rather than squeeze the pair. */}
				<div className="mt-1 overflow-x-auto">
					<div className="min-w-[860px]">
						<div
							className={`${SETTLEMENT_GRID} box-content h-[34px] border-b border-ln2 font-mono text-[10.5px] leading-[normal] font-medium tracking-[.06em] text-fa uppercase`}
						>
							<span>{t("detail.settlementColumns.time")}</span>
							<span className="text-right">
								{t("detail.settlementColumns.trades")}
							</span>
							<span className="text-right">
								{t("detail.settlementColumns.swaps")}
							</span>
							<span className="pl-1.5">{t("detail.settlementColumns.pair")}</span>
							<span className="text-right">
								{t("detail.settlementColumns.volume")}
							</span>
							<span className="text-right">
								{t("detail.settlementColumns.surplus")}
							</span>
							<span className="text-right">{t("detail.settlementColumns.cost")}</span>
							<span className="text-right">{t("detail.settlementColumns.gas")}</span>
							<span className="text-right">
								{t("detail.settlementColumns.links")}
							</span>
						</div>
						{d.settlements.map((s) => (
							<div
								key={s.tx}
								className={`${SETTLEMENT_GRID} box-content h-[38px] border-b border-ln font-mono text-[12.5px] leading-[normal] font-medium`}
							>
								<span>{s.time}</span>
								<span className="text-right">{s.trades}</span>
								<span className="text-right">{s.swaps}</span>
								<span className="truncate pl-1.5 font-sans text-[13px]">
									{s.pair}
								</span>
								<span className="text-right">{s.volume}</span>
								<span className="text-right">{s.surplus}</span>
								<span className="text-right">{s.cost}</span>
								<span className="text-right">{s.gas}</span>
								<span className="flex justify-end gap-3.5 text-[12px]">
									<a
										href={s.cow}
										target="_blank"
										rel="noopener"
										className="whitespace-nowrap quiet"
									>
										{tc.rich("cowExplorer", { arrow })}
									</a>
									<a
										href={s.scan}
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
			</div>
		</>
	);
}

/**
 * The compact detail: one stack, the auction strip as a picture only, shortened addresses and
 * settlements whose figures wrap as one list. Every link and button is a 44px target.
 */
export function DetailCompact({ row }: { row: Row }) {
	const d = useDetail(row);
	const t = useTranslations("Winning");
	const tc = useTranslations("Common");
	const [copied, copy] = useCopy(COPIED_MS);

	return (
		<div className="flex flex-col gap-[22px] border-b border-ln pt-4 pb-[22px] pl-[34px]">
			<div>
				<div className="flex items-baseline gap-2.5">
					<span className="font-mono text-[24px] leading-none font-medium tracking-[-0.04em]">
						{d.share}
					</span>
					<span className="font-mono text-[11.5px] leading-[normal] font-medium text-mu">
						{d.trend}
					</span>
				</div>
				<ShareChart chart={d.chart} label={d.chartLabel} className="mt-3 h-[60px]" />
			</div>
			<div className="grid grid-cols-2 gap-x-[18px] gap-y-4">
				{d.stats.map((stat) => (
					<div key={stat.key} className="min-w-0">
						<div className={SMALL_LABEL}>{stat.label}</div>
						<div className="mt-[3px] font-mono text-[16px] leading-[normal] font-medium">
							{stat.value}
						</div>
						<div className="mt-0.5 text-[12px] text-balance text-mu">{stat.note}</div>
					</div>
				))}
			</div>
			<div>
				<div className={SMALL_LABEL}>{d.auctions.title}</div>
				<div aria-hidden="true" className="mt-2 flex h-4">
					{d.auctions.cells.map((cell) => (
						<span key={cell.id} className="grid h-full flex-1 place-items-center">
							<span className={DOT[cell.state]} />
						</span>
					))}
				</div>
				<div className="mt-1.5 text-[12px] text-mu">
					{t("detail.auctionsAndRanks", { auctions: d.auctions.note, ranks: d.ranks })}
				</div>
			</div>
			<div>
				<div className="flex items-baseline justify-between gap-2.5">
					<span className={SMALL_LABEL}>{t("detail.addresses")}</span>
					{d.registry === null ? null : (
						<span className="font-mono text-[10.5px] leading-[normal] font-medium text-fa">
							{d.registry}
						</span>
					)}
				</div>
				{d.addresses.map((a) => (
					<div
						key={a.key}
						className="box-content grid min-h-11 grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-ln"
					>
						<span className={SMALL_LABEL}>{a.label}</span>
						<span
							title={a.address}
							className={`truncate font-mono text-[12px] leading-[normal] font-medium ${a.retired ? "text-fa" : ""}`}
						>
							{a.medium}
						</span>
						<span className="flex gap-4 font-mono text-[11.5px] leading-[normal] font-medium">
							{a.retired ? (
								<span className={RETIRED}>{t("retired")}</span>
							) : (
								<>
									<button
										type="button"
										onClick={() => copy(a.address)}
										className="-my-[15px] py-[15px] whitespace-nowrap quiet"
									>
										{copied === a.address ? tc("copied") : tc("copy")}
									</button>
									<a
										href={a.href}
										target="_blank"
										rel="noopener"
										className="-my-[15px] py-[15px] whitespace-nowrap quiet"
									>
										{tc.rich("basescan", { arrow })}
									</a>
								</>
							)}
						</span>
					</div>
				))}
			</div>
			<div>
				<div className={SMALL_LABEL}>{t("detail.settlements")}</div>
				{d.settlements.map((s) => (
					<div key={s.tx} className="border-b border-ln pt-2.5 pb-1">
						<div className="flex justify-between gap-2.5 font-mono text-[12.5px] leading-[normal] font-medium">
							<span>{s.time}</span>
							<span className="truncate font-sans text-[13px]">{s.pair}</span>
						</div>
						{/*
						 * One wrapping list. Each figure carries its "·", clipped where it would start a
						 * line; the links end it, 44px tall without spacing the lines apart. Only the
						 * sides clip, so the links' overhang above and below stays tappable.
						 */}
						<div className="overflow-x-clip">
							<div className="-ml-3.5 flex flex-wrap items-center font-mono text-[11.5px] leading-[normal] font-medium text-mu">
								{s.items.map((item) => (
									<span
										key={item.key}
										className="py-1.5 whitespace-nowrap before:inline-block before:w-3.5 before:text-center before:content-['·']"
									>
										{item.text}
									</span>
								))}
								<span className="-my-[11px] ml-auto flex gap-[18px] pl-3.5">
									<a
										href={s.cow}
										target="_blank"
										rel="noopener"
										className="flex min-h-11 items-center whitespace-nowrap quiet"
									>
										{tc.rich("explorer", { arrow })}
									</a>
									<a
										href={s.scan}
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
		</div>
	);
}

/** Daily share over the history span, scaled to the solver's own range. */
function ShareChart({
	chart,
	label,
	className,
}: {
	chart: LinePath;
	label: string;
	className: string;
}) {
	return (
		<div role="img" aria-label={label} className={`relative ${className}`}>
			<svg
				viewBox="0 0 100 50"
				preserveAspectRatio="none"
				aria-hidden="true"
				className="absolute inset-0 size-full overflow-visible"
			>
				<path
					d={chart.area}
					className="fill-[color-mix(in_oklab,var(--fg)_9%,transparent)]"
				/>
				<path
					d={chart.line}
					fill="none"
					strokeWidth={1.6}
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
					className="stroke-fg"
				/>
			</svg>
		</div>
	);
}

/**
 * The latest auctions, oldest first; a click on a cell opens that auction's settlement. As on the
 * auction tape, the cells are a picture to keyboards and screen readers, and the line under the
 * strip says what it shows. Only the latest auction with a settlement keeps its link in the tab
 * order, named in full.
 */
function AuctionStrip({ cells, className }: { cells: AuctionCell[]; className: string }) {
	const latest = cells.findLast((cell) => cell.href !== null);
	return (
		<div className={`flex h-4 ${className}`}>
			{cells.map((cell) => {
				if (cell.href === null)
					return (
						<span
							key={cell.id}
							aria-hidden="true"
							title={cell.title}
							className="grid h-full flex-1 place-items-center"
						>
							<span className={DOT[cell.state]} />
						</span>
					);
				const kept = cell === latest;
				return (
					<a
						key={cell.id}
						href={cell.href}
						target="_blank"
						rel="noopener"
						title={cell.title}
						aria-label={kept ? cell.title : undefined}
						aria-hidden={kept ? undefined : true}
						tabIndex={kept ? undefined : -1}
						className="grid h-full flex-1 place-items-center rounded-[3px] hover:bg-[color-mix(in_oklab,var(--fg)_14%,transparent)]"
					>
						<span className={DOT[cell.state]} />
					</a>
				);
			})}
		</div>
	);
}
