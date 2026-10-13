"use client";

import { useTranslations } from "next-intl";

import { auctionDetails, quotesAxis } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { compactTickClass } from "@/components/ui/axis";
import { FootLine } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Name | bar | values, as the entered bars: the values column widens on desktop for verified. */
const BAR_GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_clamp(84px,12vw,150px)] gap-4 wide:grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_clamp(84px,18vw,220px)]";

/**
 * Quotes, between the auction tape and Latest settlements: whose quote each trade's order was
 * placed with. One bar per solver that gave a quote, most quotes first: light is its share of
 * quoted trades, solid the part of those it went on to settle itself. Figures cover the window's
 * days with auction details.
 */
export function Quotes({ rankIndex }: { rankIndex: Map<string, number> }) {
	const t = useTranslations("Enter.quotes");
	const tc = useTranslations("Common");
	const th = useTranslations("Hero");
	const f = useFormat();
	const view = useView();
	const { snapshot, status } = useDashboard();
	const { hovered, setHovered } = useHover();

	const details = auctionDetails(snapshot!, view);
	const { network, quoters, coverage } = details;
	// Quoters exist only on days with auction details and quotes.
	const top = quoters[0];
	const has = top !== undefined;
	// Auction details cover fewer days than the window: the sentence names them ("the last 7
	// days", or while delayed "the 7 days to 09:49 UTC"), a footnote says so.
	const partial = coverage < view.days;
	const period = {
		period: tc(`period.${view.period}`),
		delayed: status.delayed ? "yes" : "no",
		asOf: status.asOf ?? "",
	};
	const sentence = has
		? t("sentence", {
				span: status.delayed
					? th("span.to", { days: coverage, asOf: status.asOf ?? "" })
					: th("span.last", { days: coverage }),
				quoted: f.int(network.quotes),
				trades: f.int(network.trades),
				verified: f.percent(network.verifiedShare, 1),
				solver: top.label,
				share: f.percent(top.figures.quoteShare, 1),
				settled: f.percent(network.settledShare, 1),
			})
		: coverage === 0
			? t("empty", period)
			: t("noQuotes", period);

	const axis = quotesAxis(top?.figures.quoteShare ?? 0);
	const gridline = ((axis.ticks[1] ?? axis.max) / axis.max) * 100;
	const at = (share: number) => `${Math.min(1, share / axis.max) * 100}%`;
	// The table's solvers that gave no quote in the window.
	const silent = view.rows
		.filter((row) => (details.solvers.get(row.id)?.quotes ?? 0) === 0)
		.map((row) => row.label);

	return (
		<div id="quotes" className="mt-16 scroll-mt-[60px]">
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
				<h3 className="text-[15px] font-medium">{t("title")}</h3>
				{has ? (
					<span className="font-mono text-[12px] leading-[normal] font-medium text-mu">
						{t("scope", { partial: partial ? "yes" : "no" })}
					</span>
				) : null}
			</div>
			<p className="mt-2.5 max-w-[720px] text-[15px] leading-[1.55] text-pretty text-mu">
				{sentence}
			</p>
			{has ? (
				<>
					<div className="mt-[22px] flex gap-[22px] font-mono text-[12px] leading-[normal] font-medium text-mu">
						<span className="flex items-center gap-2">
							<span className="h-2 w-4 rounded-[2px] bg-fg/18" />
							{t("legend.quoted")}
						</span>
						<span className="flex items-center gap-2">
							<span className="h-2 w-4 rounded-[2px] bg-fg" />
							{t("legend.settled")}
						</span>
					</div>
					<div className="mt-3.5">
						{quoters.map((quoter) => {
							const hot = isHot(hovered, quoter.id, rankIndex.get(quoter.id) ?? -1);
							const share = quoter.figures.quoteShare ?? 0;
							const settled = quoter.figures.settledShare ?? 0;
							const figures = {
								share: f.percent(share, 1),
								settled: f.percent(settled),
								verified: f.percent(quoter.figures.verifiedShare ?? 0),
							};
							return (
								<div
									key={quoter.id}
									onMouseEnter={() => setHovered(quoter.id)}
									onMouseLeave={() => setHovered(null)}
									className={`${BAR_GRID} h-[31px] items-center border-t border-ln`}
								>
									<span
										className={`truncate text-[13.5px] font-medium transition-colors duration-200 ${quoter.unnamed ? "font-mono" : ""} ${hot ? "text-teal" : ""}`}
									>
										{quoter.label}
									</span>
									<span
										role="img"
										aria-label={t("bar", figures)}
										className="relative h-2.5"
										style={{
											backgroundImage: `repeating-linear-gradient(90deg,var(--ln) 0 1px,transparent 1px ${gridline}%)`,
										}}
									>
										<span
											className="absolute inset-y-0 left-0 rounded-[2px] bg-fg/18"
											style={{ width: at(share) }}
										/>
										<span
											className={`absolute inset-y-0 left-0 rounded-[2px] transition-colors duration-200 ${hot ? "bg-teal" : "bg-fg"}`}
											style={{ width: at(share * settled) }}
										/>
									</span>
									<span className="text-right font-mono text-[12.5px] leading-[normal] font-medium whitespace-nowrap text-mu">
										<span className="max-wide:hidden">
											{t.rich("ratesWide", {
												...figures,
												own: (chunks) => (
													<span className="text-fg">{chunks}</span>
												),
											})}
										</span>
										<span className="wide:hidden">
											{t.rich("rates", {
												...figures,
												own: (chunks) => (
													<span className="text-fg">{chunks}</span>
												),
											})}
										</span>
									</span>
								</div>
							);
						})}
						<div
							className={`${BAR_GRID} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
						>
							<span />
							<span className="relative h-3.5">
								{axis.ticks.map((tick, index) => {
									const x = tick / axis.max;
									const value = f.percent(tick);
									return (
										<span
											key={tick}
											className={`absolute whitespace-nowrap ${x === 0 ? "" : x === 1 ? "-translate-x-full" : "-translate-x-1/2"} ${compactTickClass(index, axis.ticks.length)}`}
											style={{ left: `${x * 100}%` }}
										>
											{x === 1 ? (
												<>
													{/* Compact tracks have no room for the words. */}
													<span className="max-wide:hidden">
														{t("axis.end", { value })}
													</span>
													<span className="wide:hidden">{value}</span>
												</>
											) : (
												value
											)}
										</span>
									);
								})}
							</span>
							<span className="text-right text-balance max-wide:hidden">
								{t("axis.ratesWide")}
							</span>
						</div>
						<div className="mt-1 text-right font-mono text-[11px] leading-[normal] font-medium text-fa wide:hidden">
							{t("axis.rates")}
						</div>
					</div>
					<FootLine source={t("source")}>
						{[
							t("note"),
							silent.length > 0 ? t("none", { names: f.list(silent) }) : null,
						]
							.filter(Boolean)
							.join(" ")}
					</FootLine>
					{partial ? (
						<p className="mt-1.5 foot-line">
							{t("footnote", { covered: coverage, days: view.days })}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}
