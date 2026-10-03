"use client";

import { useTranslations } from "next-intl";

import { DASH } from "@fiberscope/core";
import type { Row, View } from "@fiberscope/core";

import { useFormat } from "@/lib/format";

/** Four columns on desktop, two on mobile, under one hairline. */
const GRID =
	"mt-[clamp(56px,7vw,92px)] grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] border-t border-ln";

/** The four key facts under the mosaic; each links to the section that explains it. */
export function Facts({ view, leader }: { view: View; leader: Row }) {
	const t = useTranslations("Hero.facts");
	const f = useFormat();
	const second = view.rows[1];
	const run = view.leaderRun;
	const lowest = view.gas.lowest;
	// The daily leader can differ from the window's leader (it took over inside the window), so
	// the run names its solver then: "Leading since" belongs to it, not to the leader above.
	const days = run ? t(run.atLeast ? "runAtLeast" : "run", { days: run.days }) : t("noRun");
	const runner = run && run.solver.id !== leader.id ? run.solver : null;

	const facts = [
		{
			href: "#who",
			label: t("share"),
			value: f.percent(leader.share, 1),
			caption: leader.label,
			mono: leader.unnamed,
		},
		{
			href: "#who",
			label: t("lead"),
			// Shares of one total, so their ratio is the ratio of the measure's values.
			value: second && second.share > 0 ? f.times(leader.share / second.share) : DASH,
			caption: second ? t("versus", { name: second.label }) : t("alone"),
			mono: second?.unnamed,
		},
		{
			href: "#change",
			label: t("since"),
			value: run ? f.day(run.since) : DASH,
			caption: runner ? t("runBy", { name: runner.label, run: days }) : days,
			mono: runner?.unnamed,
		},
		{
			href: "#eff",
			label: t("gas"),
			value: f.gas(lowest?.gasPerTrade ?? null),
			caption: lowest ? lowest.label : t("noGas"),
			mono: lowest?.unnamed,
		},
	];

	return (
		<div className={GRID}>
			{facts.map((fact) => (
				<a
					key={fact.label}
					href={fact.href}
					className="flex min-w-0 flex-col gap-1.5 pt-[22px] pr-5 pb-1 text-fg transition-colors duration-200 hover:text-act hover:no-underline"
				>
					<span className="text-[13px] text-mu">{fact.label}</span>
					<span className="font-mono text-[clamp(32px,3.6vw,46px)] leading-[1.05] font-medium tracking-[-0.05em] whitespace-nowrap">
						{fact.value}
					</span>
					<span
						className={`truncate text-[13px] text-mu ${fact.mono ? "font-mono" : ""}`}
					>
						{fact.caption}
					</span>
				</a>
			))}
		</div>
	);
}

/** Loading: four placeholder facts. */
export function FactsSkeleton() {
	return (
		<div aria-hidden="true" className={GRID}>
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className="flex flex-col gap-2.5 pt-6 pr-5 pb-1">
					<span className="skeleton h-3 w-[46%] rounded-[6px]" />
					<span className="skeleton h-[34px] w-[62%] rounded-[8px]" />
					<span className="skeleton h-3 w-[38%] rounded-[6px]" />
				</div>
			))}
		</div>
	);
}
