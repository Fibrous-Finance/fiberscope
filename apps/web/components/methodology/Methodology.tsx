"use client";

import { useTranslations } from "next-intl";

import { MIN_BATCHES_PER_DAY } from "@fiberscope/core";

import { useDashboard } from "@/components/dashboard/context";
import { Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Definitions, in two columns: the measures, then where the data comes from and how it is made. */
const MEASURES = [
	"batches",
	"trades",
	"volume",
	"share",
	"gas",
	"cost",
	"swaps",
	"batchValue",
	"surplus",
	"unusual",
	"networkAverage",
] as const;
const SOURCES = [
	"entered",
	"winRate",
	"leadingSince",
	"sources",
	"dune",
	"attribution",
	"registry",
	"freshness",
	"windows",
	"coverage",
	"names",
] as const;
type Term = (typeof MEASURES)[number] | (typeof SOURCES)[number];

export function Methodology() {
	const t = useTranslations("Methodology");
	const f = useFormat();
	const { snapshot, status } = useDashboard();
	// Without figures on the page (error, or reloading after one), the definitions leave out the
	// numbers that describe the data.
	const data = status.state === "error" || status.state === "loading" ? null : snapshot;

	const text = (key: Term) => {
		if (key === "freshness") {
			const minutes = status.refreshMinutes;
			if (!data) return t("terms.freshness.noData", { minutes });
			// While delayed, the promise to update every few minutes is not being kept.
			return t(
				status.state === "delayed" ? "terms.freshness.delayed" : "terms.freshness.text",
				{
					minutes,
					block: f.int(data.end.block),
					date: f.date(data.end.time),
					time: f.time(data.end.time),
				}
			);
		}
		if (key === "coverage") {
			return data
				? t("terms.coverage.text", {
						chain: data.coverage.chainDays,
						auction: data.coverage.auctionDays,
						surplus: data.coverage.surplusDays,
					})
				: t("terms.coverage.noData");
		}
		if (key === "gas") return t("terms.gas.text", { minBatches: MIN_BATCHES_PER_DAY });
		return t(`terms.${key}.text`);
	};
	// Compact: one column, 14px above each term.
	const list = (keys: readonly Term[]) => (
		<dl className="grid grid-cols-1 content-start text-[14px] leading-[1.55] wide:grid-cols-[max-content_minmax(0,1fr)] wide:gap-x-6 wide:gap-y-3">
			{keys.map((key) => (
				<div key={key} className="contents">
					<dt className="mt-3.5 font-mono text-[12px] leading-[1.8] font-medium wide:mt-0">
						{t(`terms.${key}.term`)}
					</dt>
					<dd className="text-mu">{text(key)}</dd>
				</div>
			))}
		</dl>
	);

	return (
		<Section id="method">
			<h2 className="section-title">{t("title")}</h2>
			<div className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-x-16 gap-y-9 border-t border-ln pt-7">
				{list(MEASURES)}
				<div className="flex flex-col gap-6">
					{list(SOURCES)}
					<p className="border-t border-ln pt-5 text-[14px] leading-[1.6] text-mu">
						<span className="font-medium text-fg">{t("disclosureLabel")}</span>{" "}
						{t("disclosure")}
					</p>
				</div>
			</div>
		</Section>
	);
}
