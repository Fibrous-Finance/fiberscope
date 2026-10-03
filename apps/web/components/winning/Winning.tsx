"use client";

import { useTranslations } from "next-intl";

import {
	BASE,
	exportCoverage,
	exportedSurplus,
	leaderboardCsv,
	sortRows,
	surplusAndCost,
} from "@fiberscope/core";
import type { Row, SurplusCostFigures } from "@fiberscope/core";

import { useDashboard, useView } from "@/components/dashboard/context";
import { arrow, FootLine, Section } from "@/components/ui/Section";
import { cellText, useColumnLabels } from "@/components/winning/columns";
import { List, Table } from "@/components/winning/Leaderboard";
import { Registry } from "@/components/winning/Registry";
import { useCopy } from "@/components/winning/useCopy";

import { useFormat } from "@/lib/format";

/** "Copied ✓" stays this long after Copy as Markdown. */
const COPIED_MS = 1600;
/** Copy as Markdown and Download CSV: 44px targets in the compact layout. */
const ACTION = "-my-1.5 py-2.5 quiet max-wide:-my-[15px] max-wide:py-[15px]";
/** The download link's object URL is released after this. */
const REVOKE_MS = 1500;
/** Loading placeholder rows: the name bar's width in %. */
const SKELETON_NAMES = [62, 48, 55, 40, 51, 44, 58, 37];

/** "Who is winning": the leaderboard, with an expandable detail per solver, then the registry. */
export function Winning() {
	const view = useView();
	const { snapshot, sort } = useDashboard();
	const t = useTranslations("Winning");
	const tc = useTranslations("Common");
	const ts = useTranslations("Surplus.header");
	const f = useFormat();
	const partial = view.coverage.auction < view.days;
	const labels = useColumnLabels();
	const [copied, copy] = useCopy(COPIED_MS);

	const rows = sortRows(view.rows, sort);
	const span = tc("window", { start: f.dayTime(view.start), end: f.dayTime(view.end.time) });
	const leader = view.rows[0];
	const runnerUp = view.rows.at(1);
	const rival = runnerUp && runnerUp.share > 0 ? runnerUp : null;
	const tie = rival !== null && rival.share === leader.share;
	// Tied, neither leads: the two names go in alphabetical order.
	const [leaderName, runnerUpName] = tie
		? [leader.label, rival.label].sort((a, b) => a.localeCompare(b, f.locale))
		: [leader.label, rival?.label ?? ""];
	const volumeLeader = view.volumeLeader;
	const chainNote =
		view.coverage.chain < view.days
			? tc("coverage.chain", { covered: view.coverage.chain, days: view.days })
			: null;
	// The coverage notes under the table.
	const notes = [
		chainNote,
		partial ? t("auctionCoverage", { covered: view.coverage.auction, days: view.days }) : null,
	].filter((note) => note !== null);

	const copyMarkdown = () => {
		const figures = surplusAndCost(snapshot!, view);
		const { marks, footnotes } = exportCoverage(view, figures);
		// The table's columns, cost after gas and surplus last. A mark after a column says its
		// source does not cover the whole window; a footnote below says how much it covers.
		const columns: [string, (row: Row, own: SurplusCostFigures | undefined) => string][] = [
			[labels.share, (row) => cellText(row, "share", f)],
			[labels.batches, (row) => cellText(row, "batches", f)],
			[labels.trades, (row) => cellText(row, "trades", f)],
			[labels.volume + marks.auction, (row) => cellText(row, "volume", f)],
			[labels.gas, (row) => cellText(row, "gas", f)],
			[t("detail.settlementColumns.cost"), (_, own) => f.usdCents(own?.cost ?? null)],
			[t("detail.labels.cost"), (_, own) => f.cost(own?.costPerTrade ?? null)],
			[labels.participation + marks.auction, (row) => cellText(row, "participation", f)],
			[labels.winRate + marks.auction, (row) => cellText(row, "winRate", f)],
			[
				t("detail.settlementColumns.surplus") + marks.surplus,
				(_, own) => f.usdCents(exportedSurplus(own)),
			],
			[
				t("columns.surplusPerTrade") + marks.surplus,
				(_, own) => f.usdCents(own?.surplusPerTrade ?? null),
			],
			[
				t("columns.typicalBps") + marks.surplus,
				(_, own) => f.bps(own?.typicalSurplusRate ?? null),
			],
			[ts("unusual") + marks.surplus, (_, own) => f.percent(own?.unusualShare ?? null)],
		];
		const [head, ...body] = [
			[t("columns.rank"), t("columns.solver"), ...columns.map(([label]) => label)],
			...rows.map((row) => {
				const own = figures.rows.get(row.id);
				return [
					row.rank,
					row.label.replaceAll("|", "\\|"),
					...columns.map(([, cell]) => cell(row, own)),
				];
			}),
		].map((cells) => `| ${cells.join(" | ")} |`);
		// # and the numbers right-aligned, Solver left.
		const align = `|--:|---|${"--:|".repeat(columns.length)}`;
		// Pasted elsewhere, "Share" needs its measure.
		const source = t("markdownSource", {
			network: tc("network"),
			measure: tc(`measure.${view.measure}`),
			window: span,
		});
		const lines = [
			source,
			chainNote,
			...footnotes.map(({ key, covered }) =>
				t(`markdownFootnotes.${key}`, { covered, days: view.days })
			),
		].filter((line) => line !== null);
		copy([head, align, ...body, ...lines.flatMap((line) => ["", line])].join("\n"));
	};

	const saveCsv = () => {
		const figures = surplusAndCost(snapshot!, view);
		downloadCsv(
			leaderboardCsv(rows, figures, exportCoverage(view, figures)),
			`fiberscope-${BASE.id}-${view.period}-${view.measure}.csv`
		);
	};

	return (
		<Section id="who">
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3.5">
				<div className="max-w-[720px]">
					<h2 className="section-title">{t("title")}</h2>
					<p className="mt-3 answer">
						{t("answer", {
							lead: tie ? "tie" : rival ? "rival" : "alone",
							leader: leaderName,
							share: f.percent(leader.share, 1),
							measure: tc(`measure.${view.measure}`),
							ratio: rival ? f.times(leader.share / rival.share) : "",
							runnerUp: runnerUpName,
							// Volume needs auction data: name its span when that is shorter.
							byVolume: volumeLeader ? (partial ? "partial" : "yes") : "no",
							volumeLeader: volumeLeader?.label ?? "",
							volumeShare: f.percent(volumeLeader?.shares.volume ?? null),
							volumeDays: view.coverage.auction,
						})}
					</p>
				</div>
				<div className="flex gap-6 font-mono text-[12px] leading-[normal] font-medium">
					<button type="button" onClick={copyMarkdown} className={ACTION}>
						{copied === null ? t("copyMarkdown") : tc("copied")}
					</button>
					<button type="button" onClick={saveCsv} className={ACTION}>
						{t("downloadCsv")}
					</button>
				</div>
			</div>
			<Table rows={rows} />
			<List rows={rows} />
			<FootLine source={t("source", { network: tc("network") })}>
				{t.rich("note", {
					earlier: view.hasEarlierWindow ? "yes" : "no",
					previous: tc(`previousPeriod.${view.period}`),
					window: span,
					arrow,
				})}
			</FootLine>
			{notes.map((note) => (
				<div key={note} className="mt-1.5 foot-line">
					{note}
				</div>
			))}
			<Registry />
		</Section>
	);
}

/**
 * The loading state: the heading and eight placeholder rows, shaped like the table on desktop
 * and like the list in the compact layout.
 */
export function WinningSkeleton() {
	const t = useTranslations("Winning");
	return (
		<Section busy>
			<h2 className="section-title">{t("title")}</h2>
			<span className="mt-4 skeleton h-4 w-[min(520px,90%)] rounded-[7px]" />
			<div className="mt-8 hidden border-t border-ln2 wide:block">
				{SKELETON_NAMES.map((name, i) => (
					<div
						key={name}
						className="box-content grid h-[50px] grid-cols-[36px_minmax(0,1.6fr)_minmax(0,1.3fr)_repeat(3,minmax(0,.7fr))] items-center gap-x-4 border-b border-ln"
					>
						<span className="skeleton h-[11px] w-3.5 rounded-[4px]" />
						<span
							style={{ width: `${name}%` }}
							className="skeleton h-[13px] rounded-[6px]"
						/>
						<span
							style={{ width: `${Math.max(8, 92 - i * 12)}%` }}
							className="skeleton h-1 rounded-[2px]"
						/>
						<span className="skeleton h-[11px] w-[70%] justify-self-end rounded-[5px]" />
						<span className="skeleton h-[11px] w-[60%] justify-self-end rounded-[5px]" />
						<span className="skeleton h-[11px] w-[66%] justify-self-end rounded-[5px]" />
					</div>
				))}
			</div>
			<div className="mt-6 border-t border-ln2 wide:hidden">
				{SKELETON_NAMES.map((name, i) => (
					<div
						key={name}
						className="grid grid-cols-[24px_minmax(0,1fr)_52px] items-center gap-2.5 border-b border-ln py-3.5"
					>
						<span className="skeleton h-[11px] w-3 rounded-[4px]" />
						<span
							style={{ width: `${name}%` }}
							className="skeleton h-3.5 rounded-[6px]"
						/>
						<span className="skeleton h-[13px] rounded-[6px]" />
						<span
							style={{ width: `${Math.max(8, 92 - i * 12)}%` }}
							className="col-[2/4] skeleton h-[3px] rounded-[2px]"
						/>
						<span
							style={{ width: `${70 - i * 3}%` }}
							className="col-[2/4] skeleton h-[11px] rounded-[5px]"
						/>
					</div>
				))}
			</div>
		</Section>
	);
}

/** Saves the CSV under `file`: `fiberscope-base-{period}-{measure}.csv`. */
function downloadCsv(csv: string, file: string) {
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = file;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}
