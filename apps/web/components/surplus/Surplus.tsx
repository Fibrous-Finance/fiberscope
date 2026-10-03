"use client";

import { useTranslations } from "next-intl";

import { FEW_TRADES, surplusAndCost, surplusAxis, surplusRows } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";
import { FootLine } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Dot diameters in px, by √surplus trades. */
const DOT_MIN = 7;
const DOT_MAX = 18;
/** Closer than this share of the axis, the all-trades tick and the line to it are hidden. */
const TICK_MIN_GAP = 0.015;

/**
 * Desktop: name | track | typical | all trades | unusual. Compact: the all-trades column is
 * hidden.
 */
const GRID =
	"grid grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_40px_56px] gap-2 wide:grid-cols-[clamp(96px,16vw,190px)_minmax(0,1fr)_72px_80px_72px] wide:gap-4";

const VALUE = "text-right font-mono text-[12.5px] leading-[normal] font-medium";

/**
 * Trader surplus, at the end of "How efficiently": how far trades beat the limit prices their
 * users signed, led by typical trades in basis points of volume. Unusual trades (surplus over a
 * tenth of the trade's value) are left out of the dot and shown apart: the tick is every trade,
 * and the line between them is what unusual trades add. Rows run by the volume behind each
 * solver's surplus.
 */
export function Surplus() {
	const t = useTranslations("Surplus");
	const tc = useTranslations("Common");
	const th = useTranslations("Hero");
	const f = useFormat();
	const view = useView();
	const { snapshot, status } = useDashboard();
	const { hovered, setHovered } = useHover();

	const surplus = surplusAndCost(snapshot!, view);
	const { network } = surplus;
	const covered = surplus.coverage.surplus;
	const has = (network.surplusTrades ?? 0) > 0;
	// Surplus covers fewer days than the window: the sentence names them, a footnote says so.
	const partial = covered < view.days;
	const average = network.typicalSurplusRate;

	const rows = surplusRows(view, surplus);
	const axis = surplusAxis(
		rows.map(({ figures }) => figures),
		average
	);
	// The share of the axis a rate sits at; rates beyond its end sit at the end.
	const at = (rate: number) => Math.max(0, Math.min(1, rate / axis.max));
	const maxTrades = Math.max(1, ...rows.map(({ figures }) => figures.surplusTrades ?? 0));

	// "the last 7 days", "the last 8 days" in a longer window, or while delayed "the 7 days to
	// 09:49 UTC".
	const days = partial ? covered : view.days;
	const span = status.delayed
		? th("span.to", { days, asOf: status.asOf ?? "" })
		: th("span.last", { days });
	const sentence = !has
		? t("empty", {
				period: tc(`period.${view.period}`),
				delayed: status.delayed ? "yes" : "no",
				asOf: status.asOf ?? "",
			})
		: (network.unusualTrades ?? 0) > 0
			? t("sentence", {
					span,
					total: f.usdWhole(network.surplus),
					unusualTrades: f.percent(network.unusualTradeShare, 1),
					unusualShare: f.percent(network.unusualShare, 1),
					typicalBps: f.bps(average),
					typicalPerTrade: f.usdCents(network.typicalSurplusPerTrade),
				})
			: t("sentenceNoUnusual", {
					span,
					total: f.usdWhole(network.surplus),
					bps: f.bps(network.surplusRate),
					perTrade: f.usdCents(network.surplusPerTrade),
				});
	const track = t("header.track", { average: f.bps(average) });

	return (
		<div id="surplus" className="mt-16 scroll-mt-[60px]">
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
				<h3 className="text-[15px] font-medium">{t("title")}</h3>
				{has ? (
					<span className="font-mono text-[12px] leading-[normal] font-medium text-mu">
						{t("scope")}
					</span>
				) : null}
			</div>
			<p className="mt-2.5 max-w-[720px] text-[15px] leading-[1.55] text-pretty text-mu">
				{sentence}
			</p>
			{has ? (
				<>
					<div className="mt-[22px] flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] leading-[normal] font-medium text-mu">
						<span className="flex items-center gap-2">
							<span className="size-2.5 rounded-full bg-fg" />
							{t("legend.typical")}
						</span>
						<span className="flex items-center gap-2">
							<span className="relative h-3 w-[18px]">
								<span className="absolute top-1/2 right-px left-0 -mt-[0.75px] h-[1.5px] bg-fg/35" />
								<span className="absolute inset-y-0 right-0 w-[1.5px] bg-fg" />
							</span>
							{t("legend.all")}
						</span>
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
					</div>
					<div className="mt-[18px]">
						<div
							className={`${GRID} items-end pb-2 font-mono text-[11px] leading-[normal] font-medium tracking-[0.06em] text-mu uppercase`}
						>
							<span />
							<span>{partial ? t("header.partial", { label: track }) : track}</span>
							<span className="text-right">
								<span className="max-wide:hidden">{t("header.typical")}</span>
								<span className="wide:hidden">{t("header.typicalShort")}</span>
							</span>
							<span className="text-right max-wide:hidden">{t("header.all")}</span>
							<span className="text-right">{t("header.unusual")}</span>
						</div>
						{rows.map(({ row, figures }) => {
							const typical = figures.typicalSurplusRate;
							const all = figures.surplusRate;
							const trades = figures.surplusTrades ?? 0;
							const hot = isHot(hovered, row.id, row.rank - 1);
							// Without typical trades there is no dot; the line starts at 0.
							const x = typical === null ? 0 : at(typical);
							const gap = all === null ? 0 : at(all) - x;
							const size =
								DOT_MIN + (DOT_MAX - DOT_MIN) * Math.sqrt(trades / maxTrades);
							return (
								<div
									key={row.id}
									onMouseEnter={() => setHovered(row.id)}
									onMouseLeave={() => setHovered(null)}
									className={`${GRID} h-[31px] items-center border-t border-ln`}
								>
									<span
										className={`truncate text-[13.5px] font-medium transition-colors duration-200 ${row.unnamed ? "font-mono" : ""} ${hot ? "text-teal" : ""}`}
									>
										{row.label}
									</span>
									<span
										role="img"
										aria-label={t("row", {
											solver: row.label,
											typical: f.bps(typical),
											all: f.bps(all),
											unusual: f.percent(figures.unusualShare),
											trades,
										})}
										className="relative h-full"
									>
										{average !== null ? (
											<span
												className="absolute inset-y-1 border-l border-dashed border-act"
												style={{ left: `${at(average) * 100}%` }}
											/>
										) : null}
										{gap >= TICK_MIN_GAP ? (
											<>
												<span
													className="absolute top-1/2 -mt-[0.75px] h-[1.5px] bg-fg/35"
													style={{
														left: `${x * 100}%`,
														width: `${gap * 100}%`,
													}}
												/>
												<span
													className={`absolute top-1/2 -mt-1.5 -ml-[0.75px] h-3 w-[1.5px] transition-colors duration-200 ${hot ? "bg-teal" : "bg-fg"}`}
													style={{ left: `${(x + gap) * 100}%` }}
												/>
											</>
										) : null}
										{all !== null && all > axis.max ? (
											<span
												aria-hidden="true"
												className="absolute top-1/2 left-full translate-x-2 -translate-y-[52%] font-mono text-[13px] leading-[normal] font-medium text-fa"
											>
												›
											</span>
										) : null}
										{typical !== null ? (
											<span
												className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] transition-colors duration-200 ${trades < FEW_TRADES ? "bg-bg" : hot ? "bg-teal" : "bg-fg"} ${hot ? "border-teal" : "border-fg"}`}
												style={{
													left: `${x * 100}%`,
													width: size,
													height: size,
												}}
											/>
										) : null}
									</span>
									<span className={VALUE}>{f.bps(typical)}</span>
									<span className={`${VALUE} text-mu max-wide:hidden`}>
										{f.bps(all)}
									</span>
									<span className={VALUE}>{f.percent(figures.unusualShare)}</span>
								</div>
							);
						})}
						<div
							className={`${GRID} border-t border-ln2 pt-2 font-mono text-[11px] leading-[normal] font-medium text-fa`}
						>
							<span />
							<span className="relative h-3.5">
								{axis.ticks.map((tick) => {
									const x = tick / axis.max;
									return (
										<span
											key={tick}
											className={`absolute ${x === 0 ? "" : x === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
											style={{ left: `${x * 100}%` }}
										>
											{f.bps(tick)}
										</span>
									);
								})}
							</span>
						</div>
					</div>
					<FootLine source={t("source", { network: tc("network") })}>
						<span className="max-wide:hidden">{t("note")}</span>
						<span className="wide:hidden">{t("noteCompact")}</span>
					</FootLine>
					{partial ? (
						<p className="mt-1.5 foot-line">
							{t("footnote", { covered, days: view.days })}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}
