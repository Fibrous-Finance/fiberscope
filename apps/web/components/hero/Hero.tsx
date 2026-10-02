"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { useDashboard } from "@/components/dashboard/context";
import { Controls } from "@/components/hero/Controls";
import { Facts, FactsSkeleton } from "@/components/hero/Facts";
import { EmptyMosaic, Mosaic, MosaicSkeleton } from "@/components/hero/Mosaic";

import { useFormat } from "@/lib/format";

/** The totals and the error line. */
const NOTE = "font-mono text-[13px] leading-[1.6] font-medium text-mu";

/**
 * Who won the window, in one sentence, then the totals, the period and measure controls, the
 * batch mosaic and four key facts. The hero also carries the loading, empty and error states.
 */
export function Hero() {
	const t = useTranslations("Hero");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { view, status } = useDashboard();

	if (status.state === "loading") {
		return (
			<Frame
				headline={null}
				summary={<span className="skeleton h-[13px] w-[min(440px,80%)] rounded-[6px]" />}
			>
				<MosaicSkeleton />
				<FactsSkeleton />
			</Frame>
		);
	}

	if (status.state === "error" || !view) {
		return (
			<Frame
				headline={t("error.headline")}
				summary={
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
						<p className={NOTE}>
							{status.attemptedAt === null
								? t("error.noAttempt")
								: t("error.attempt", { time: f.time(status.attemptedAt) })}
						</p>
						<button type="button" onClick={status.retry} className="btn-teal">
							{t("error.retry")}
						</button>
					</div>
				}
			/>
		);
	}

	const network = tc("network");
	const period = tc(`period.${view.period}`);
	const totals = {
		batches: view.totals.batches,
		trades: view.totals.trades,
		volume: f.usd(view.totals.volume),
		solvers: view.totals.solvers,
	};
	const leader = view.rows[0];
	const fraction = view.headline;
	// A young index covers only part of the window: the headline claims just the days its measure
	// has data for (volume needs auction data), and a note under the totals says what is partial.
	const covered = view.measure === "volume" ? view.coverage.auction : view.coverage.chain;
	const partial = (["chain", "auction"] as const).filter(
		(kind) => view.coverage[kind] < view.days
	);
	const note =
		partial.length > 0 ? (
			<div className="mt-2.5 flex flex-col gap-1.5 text-pretty foot-line">
				{partial.map((kind) => (
					<p key={kind}>
						{tc(`coverage.${kind}`, { covered: view.coverage[kind], days: view.days })}
					</p>
				))}
			</div>
		) : null;

	if (view.total === 0 || !leader || !fraction) {
		return (
			<Frame
				headline={t("empty.headline", { network, period })}
				summary={
					<p className={NOTE}>
						{t("empty.totals", {
							...totals,
							time: f.time(status.lastRunAt ?? view.end.time),
						})}
					</p>
				}
			>
				{note}
				<EmptyMosaic />
			</Frame>
		);
	}

	return (
		<Frame
			headline={t("headline", {
				fraction: fraction.key,
				n: fraction.key === "oneIn" ? fraction.n : 0,
				network,
				measure: tc(`measure.${view.measure}`),
				days: covered,
			})}
			summary={
				<p className={NOTE}>{t("totals", { ...totals, time: f.time(view.end.time) })}</p>
			}
		>
			{note}
			<Mosaic view={view} leader={leader} />
			<Facts view={view} leader={leader} />
		</Frame>
	);
}

/** What every state shares: eyebrow, headline (placeholder bars while loading), totals row. */
function Frame({
	headline,
	summary,
	children,
}: {
	/** null while loading. */
	headline: string | null;
	summary: ReactNode;
	children?: ReactNode;
}) {
	const t = useTranslations("Hero");
	const tc = useTranslations("Common");
	return (
		<section aria-busy={headline === null || undefined} className="pt-[clamp(48px,8vw,108px)]">
			<p className="eyebrow">{t("eyebrow", { network: tc("network") })}</p>
			{headline === null ? (
				<div className="mt-[18px] flex max-w-[19ch] flex-col gap-[.2em] text-[clamp(38px,5.4vw,70px)]">
					<span className="skeleton h-[.8em] w-full rounded-[10px]" />
					<span className="skeleton h-[.8em] w-[84%] rounded-[10px]" />
					<span className="skeleton h-[.8em] w-[56%] rounded-[10px]" />
				</div>
			) : (
				<h1 className="mt-[18px] max-w-[19ch] headline">{headline}</h1>
			)}
			<div className="mt-[30px] flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
				{summary}
				<Controls />
			</div>
			{children}
		</section>
	);
}
