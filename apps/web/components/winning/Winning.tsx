"use client";

import { useTranslations } from "next-intl";

import { BASE, sortRows } from "@fiberscope/core";
import type { Row } from "@fiberscope/core";

import { useDashboard, useView } from "@/components/dashboard/context";
import { arrow, FootLine, Section } from "@/components/ui/Section";
import { cellText, COLUMNS, useHeaderLabels } from "@/components/winning/columns";
import { List, Table } from "@/components/winning/Leaderboard";
import { Registry } from "@/components/winning/Registry";
import { useCopy } from "@/components/winning/useCopy";

import { useFormat } from "@/lib/format";

/** "Copied ✓" stays this long after Copy as Markdown. */
const COPIED_MS = 1600;
/** Markdown column alignment: # and the numbers right, Solver left. */
const MARKDOWN_ALIGN = "|--:|---|--:|--:|--:|--:|--:|--:|--:|";
/** Machine-readable, so the same in every language. */
const CSV_HEADER =
	"rank,solver,share_pct,batches,trades,volume_usd,gas_per_trade,dex_swaps_per_trade,avg_batch_value_usd,trades_per_batch,entered_pct,win_rate_pct";
/** Copy as Markdown and Download CSV: 44px targets in the compact layout. */
const ACTION = "-my-1.5 py-2.5 quiet max-wide:-my-[15px] max-wide:py-[15px]";
/** The download link's object URL is released after this. */
const REVOKE_MS = 1500;
/** Loading placeholder rows: the name bar's width in %. */
const SKELETON_NAMES = [62, 48, 55, 40, 51, 44, 58, 37];

/** "Who is winning": the leaderboard, with an expandable detail per solver, then the registry. */
export function Winning() {
	const view = useView();
	const { sort } = useDashboard();
	const t = useTranslations("Winning");
	const tc = useTranslations("Common");
	const f = useFormat();
	const partial = view.coverage.auction < view.days;
	const labels = useHeaderLabels(partial);
	const [copied, copy] = useCopy(COPIED_MS);

	const rows = sortRows(view.rows, sort);
	const span = tc("window", { start: f.dayTime(view.start), end: f.dayTime(view.end.time) });
	const leader = view.rows[0];
	const runnerUp = view.rows.at(1);
	const rival = runnerUp && runnerUp.share > 0 ? runnerUp : null;
	const volumeLeader = view.volumeLeader;
	// The coverage notes under the table; Copy as Markdown carries them too.
	const notes = [
		view.coverage.chain < view.days
			? tc("coverage.chain", { covered: view.coverage.chain, days: view.days })
			: null,
		partial ? t("auctionCoverage", { covered: view.coverage.auction, days: view.days }) : null,
	].filter((note) => note !== null);

	const copyMarkdown = () => {
		const [head, ...body] = [
			[t("columns.rank"), t("columns.solver"), ...COLUMNS.map((key) => labels[key])],
			...rows.map((row) => [
				row.rank,
				row.label.replaceAll("|", "\\|"),
				...COLUMNS.map((key) => cellText(row, key, f)),
			]),
		].map((cells) => `| ${cells.join(" | ")} |`);
		// Pasted elsewhere, "Share" needs its measure.
		const source = t("markdownSource", {
			network: tc("network"),
			measure: tc(`measure.${view.measure}`),
			window: span,
		});
		copy(
			[
				head,
				MARKDOWN_ALIGN,
				...body,
				...[...notes, source].flatMap((line) => ["", line]),
			].join("\n")
		);
	};

	return (
		<Section id="who">
			<div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3.5">
				<div className="max-w-[720px]">
					<h2 className="section-title">{t("title")}</h2>
					<p className="mt-3 answer">
						{t("answer", {
							lead: !rival ? "alone" : rival.share === leader.share ? "tie" : "rival",
							leader: leader.label,
							share: f.percent(leader.share, 1),
							measure: tc(`measure.${view.measure}`),
							ratio: rival ? f.times(leader.share / rival.share) : "",
							runnerUp: rival?.label ?? "",
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
					<button
						type="button"
						onClick={() =>
							downloadCsv(
								rows,
								`fiberscope-${BASE.id}-${view.period}-${view.measure}.csv`
							)
						}
						className={ACTION}
					>
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

/** The table as CSV, in its current order: `fiberscope-base-{period}-{measure}.csv`. */
function downloadCsv(rows: readonly Row[], file: string) {
	const percent = (ratio: number | null, digits: number) =>
		ratio === null ? "" : (ratio * 100).toFixed(digits);
	const lines = rows.map((row) =>
		[
			row.rank,
			`"${row.label.replaceAll('"', '""')}"`,
			percent(row.share, 2),
			row.batches,
			row.trades,
			row.volume === null ? "" : Math.round(row.volume),
			row.gasPerTrade === null ? "" : Math.round(row.gasPerTrade),
			row.swapsPerTrade === null ? "" : row.swapsPerTrade.toFixed(2),
			row.batchValue === null ? "" : Math.round(row.batchValue),
			row.tradesPerBatch === null ? "" : row.tradesPerBatch.toFixed(2),
			percent(row.participation, 1),
			percent(row.winRate, 1),
		].join(",")
	);
	const url = URL.createObjectURL(
		new Blob([[CSV_HEADER, ...lines].join("\n")], { type: "text/csv;charset=utf-8" })
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = file;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}
