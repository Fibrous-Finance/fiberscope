"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { useDashboard } from "@/components/dashboard/context";
import { Controls } from "@/components/hero/Controls";
import { Facts, FactsSkeleton } from "@/components/hero/Facts";
import { EmptyMosaic, Mosaic, MosaicSkeleton } from "@/components/hero/Mosaic";

import { useFormat } from "@/lib/format";

/**
 * Who won the window, in one sentence, then the totals, the period and measure controls, the
 * batch mosaic and four key facts. The hero also carries the loading, empty, error and delayed
 * states.
 */
export function Hero() {
	const t = useTranslations("Hero");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { view, status } = useDashboard();

	if (status.state === "loading") {
		return (
			<Frame busy>
				<div className="mt-[18px] flex max-w-[19ch] flex-col gap-[.2em] text-[clamp(38px,5.4vw,70px)]">
					<span className="skeleton h-[.8em] w-full rounded-[10px]" />
					<span className="skeleton h-[.8em] w-[84%] rounded-[10px]" />
					<span className="skeleton h-[.8em] w-[56%] rounded-[10px]" />
				</div>
				<Summary>
					<span className="skeleton h-[13px] w-[min(440px,80%)] rounded-[6px]" />
				</Summary>
				<MosaicSkeleton />
				<FactsSkeleton />
			</Frame>
		);
	}

	// Nothing to show and nothing to control: the message, Retry now and the next automatic try.
	if (status.state === "error" || !view) {
		return (
			<Frame>
				<h1 className="mt-[18px] max-w-[19ch] headline">{t("error.headline")}</h1>
				<p className="mt-6 max-w-[560px] answer">
					{t("error.text", { time: f.time(status.failedAt ?? status.now) })}
				</p>
				<div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3">
					<button type="button" onClick={status.retry} className="btn-teal">
						{t("error.retry")}
					</button>
					<span className="font-mono text-[12px] leading-[normal] font-medium whitespace-nowrap text-fa">
						{t("error.next", { time: f.time(status.nextTryAt) })}
					</span>
				</div>
			</Frame>
		);
	}

	const network = tc("network");
	const leader = view.rows[0];
	const fraction = view.headline;
	const empty = view.total === 0 || !leader || !fraction;
	const { chain, auction } = view.coverage;
	const asOf = status.asOf ?? "";
	// The headline claims only the days its measure has data for (volume needs auction data); the
	// empty headline names the whole window.
	const days = empty ? view.days : view.measure === "volume" ? auction : chain;
	// "the last 24 hours", or while delayed "the 24 hours to 09:49 UTC".
	const span = status.delayed ? t("span.to", { days, asOf }) : t("span.last", { days });
	const totals = [
		t("totals.batches", { count: view.totals.batches }),
		t("totals.trades", { count: view.totals.trades }),
		auction > 0 && auction < view.days
			? t("totals.volumeCovered", { value: f.usd(view.totals.volume), days: auction })
			: t("totals.volume", { value: f.usd(view.totals.volume) }),
		t("totals.solvers", { count: view.totals.solvers }),
		t(empty ? "totals.checked" : "totals.to", { asOf }),
	];

	return (
		<Frame>
			<h1 className="mt-[18px] max-w-[19ch] headline">
				{empty
					? t("empty.headline", { network, span })
					: t("headline", {
							fraction: fraction.key,
							n: fraction.key === "oneIn" ? fraction.n : 0,
							network,
							measure: tc(`measure.${view.measure}`),
							span,
						})}
			</h1>
			{status.delayed && status.dataTime !== null ? (
				// One line, not a banner: the data's age, the as-of time and the automatic check.
				<p className="mt-[22px] flex max-w-[640px] gap-3 text-[15px] leading-[1.55] text-pretty text-mu">
					<span
						aria-hidden="true"
						className="mt-2 size-[7px] flex-none rounded-full bg-warn"
					/>
					<span>
						{t.rich("delayed", {
							age: f.ago(status.now - status.dataTime),
							asOf,
							strong: (chunks) => (
								<strong className="font-medium text-fg">{chunks}</strong>
							),
						})}
					</span>
				</p>
			) : null}
			<Summary delayed={status.delayed}>
				{/* Each item carries its "·" in front; the list is pulled 22px left inside a
				clipping box, so the dot that would start a line is cut off. */}
				<div className="min-w-0 overflow-hidden">
					<p className="-ml-[22px] flex flex-wrap font-mono text-[13px] leading-[1.6] font-medium text-mu">
						{totals.map((item) => (
							<span
								key={item}
								className="whitespace-nowrap before:inline-block before:w-[22px] before:text-center before:content-['·']"
							>
								{item}
							</span>
						))}
					</p>
				</div>
			</Summary>
			{/* A young index covers only part of the window for batches, trades and gas too. */}
			{chain < view.days ? (
				<p className="mt-2.5 text-pretty foot-line">
					{tc("coverage.chain", { covered: chain, days: view.days })}
				</p>
			) : null}
			{empty ? (
				<EmptyMosaic />
			) : (
				<>
					<Mosaic view={view} leader={leader} />
					<Facts view={view} leader={leader} />
				</>
			)}
		</Frame>
	);
}

/** Every state starts with the eyebrow. */
function Frame({ busy, children }: { busy?: boolean; children: ReactNode }) {
	const t = useTranslations("Hero");
	const tc = useTranslations("Common");
	return (
		<section aria-busy={busy || undefined} className="pt-[clamp(48px,8vw,108px)]">
			<p className="eyebrow">{t("eyebrow", { network: tc("network") })}</p>
			{children}
		</section>
	);
}

/** The totals (or their placeholder) and the period and measure controls. */
function Summary({ delayed, children }: { delayed?: boolean; children: ReactNode }) {
	return (
		<div
			className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-4 ${delayed ? "mt-[26px]" : "mt-[30px]"}`}
		>
			{children}
			<Controls />
		</div>
	);
}
