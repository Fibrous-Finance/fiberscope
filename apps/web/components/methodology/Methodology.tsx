"use client";

import { useTranslations } from "next-intl";

import type { HeaderStatus } from "@/components/frame/Header";
import { Section } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Definitions, in two columns: the metrics, then how the data is made. */
const METRICS = [
	"batches",
	"trades",
	"volume",
	"share",
	"gas",
	"networkAverage",
	"entered",
	"winRate",
	"leadingSince",
] as const;
const SOURCES = ["sources", "attribution", "freshness", "windows", "names"] as const;
type Term = (typeof METRICS)[number] | (typeof SOURCES)[number];

export function Methodology({ status }: { status: HeaderStatus }) {
	const t = useTranslations("Methodology");
	const f = useFormat();

	const text = (key: Term) => {
		if (key !== "freshness") return t(`terms.${key}.text`);
		const minutes = status.refreshMinutes;
		return status.lastRunAt === null
			? t("terms.freshness.unknown", { minutes })
			: t("terms.freshness.text", {
					minutes,
					date: f.date(status.lastRunAt),
					time: f.time(status.lastRunAt),
					block: f.int(status.endBlock ?? 0),
				});
	};
	const list = (keys: readonly Term[]) => (
		<dl className="grid grid-cols-[max-content_minmax(0,1fr)] content-start gap-x-6 gap-y-3 text-[14px] leading-[1.55]">
			{keys.map((key) => (
				<div key={key} className="contents">
					<dt className="font-mono text-[12px] leading-[1.8] font-medium">
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
				{list(METRICS)}
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
