"use client";

import { useId } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import { useTranslations } from "next-intl";

import { autoRange, FIRST_DIRECTION, linePath } from "@fiberscope/core";
import type { Measure, Row } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { BAR_MIN_TONE, hoverIndex, isHot, TEAL, tone } from "@/components/dashboard/tones";
import { ScrollMoreFade, useScrollMore } from "@/components/ui/ScrollMore";
import { arrow, Caret } from "@/components/ui/Section";
import {
	cellText,
	COLUMNS,
	rankText,
	shareText,
	useHeaderLabels,
	VALUE_COLUMNS,
} from "@/components/winning/columns";
import { DetailCompact, DetailWide } from "@/components/winning/Detail";
import { DotList } from "@/components/winning/DotList";

import { useFormat } from "@/lib/format";

/**
 * #, Solver, Share, six numbers and the sparkline; the header and every row share it. Its least
 * width, 860px of columns and nine 16px gaps, is the table's min-width.
 */
const GRID =
	"grid grid-cols-[36px_minmax(180px,1.6fr)_minmax(140px,1.3fr)_minmax(64px,.7fr)_minmax(64px,.7fr)_minmax(76px,.8fr)_minmax(76px,.8fr)_minmax(70px,.7fr)_minmax(70px,.7fr)_84px] items-center gap-x-4";
/** Once the table is scrolled sideways, the sticky Solver column ends in a hairline. */
const EDGE = "shadow-[inset_-1px_0_0_var(--ln2)]";
/** Sparklines span at least 4 percentage points. */
const SPARK_MIN_SPAN = 0.04;

/**
 * The desktop table (760px and up). Below about 1100px it scrolls sideways: # and Solver stay
 * pinned, and a fade on the right edge shows that more columns follow.
 */
export function Table({ rows }: { rows: Row[] }) {
	const view = useView();
	const { sort, setSort, open, setOpen } = useDashboard();
	const { hovered, setHovered } = useHover();
	const f = useFormat();
	const t = useTranslations("Winning.columns");
	const tw = useTranslations("Winning");
	const { ref: scroller, more, scrolled, width } = useScrollMore();

	const leaderShare = view.rows[0]?.share ?? 0;
	const labels = useHeaderLabels(view.coverage.auction < view.days);

	return (
		<div className="relative mt-8 hidden wide:block">
			<div ref={scroller} className="overflow-x-auto">
				{/* A table to assistive tech: the sorted column says so with aria-sort. */}
				<div role="table" aria-label={tw("title")} className="min-w-[1004px] tabular-nums">
					<div
						role="row"
						className={`${GRID} box-content h-10 border-b border-ln2 label whitespace-nowrap`}
					>
						{/* Inset like the ranks below, which keep clear of a row's inset focus ring. */}
						<span
							role="columnheader"
							className="sticky left-0 z-1 flex items-center self-stretch bg-bg pl-2"
						>
							{t("rank")}
						</span>
						<span
							role="columnheader"
							className={`sticky left-9 z-1 -ml-4 flex items-center self-stretch bg-bg pl-4 ${scrolled ? EDGE : ""}`}
						>
							{t("solver")}
						</span>
						{COLUMNS.map((key) => {
							const active = sort.key === key;
							const direction = sort.direction === 1 ? "ascending" : "descending";
							const label = labels[key];
							return (
								<span
									key={key}
									role="columnheader"
									aria-sort={active ? direction : undefined}
									className={
										key === "share" ? "justify-self-start" : "justify-self-end"
									}
								>
									<button
										type="button"
										onClick={() =>
											setSort({
												key,
												direction: active
													? sort.direction === 1
														? -1
														: 1
													: FIRST_DIRECTION[key],
											})
										}
										className={`uppercase ${active ? "text-fg" : "text-mu"}`}
									>
										{active
											? t.rich("sorted", { label, direction, arrow })
											: label}
									</button>
								</span>
							);
						})}
						{/* The sparkline column only pictures the share column: not read out. */}
						<span aria-hidden="true" className="text-right">
							{t("spark", { days: view.sparkDays })}
						</span>
					</div>
					{rows.map((row) => (
						<TableRow
							key={row.id}
							row={row}
							rank={rankText(row, view.measure)}
							share={shareText(row, view.measure, f)}
							open={open === row.id}
							hot={isHot(hovered, row.id, hoverIndex(row, view.measure))}
							leaderShare={leaderShare}
							sparkDays={view.sparkDays}
							scrolled={scrolled}
							width={open === row.id ? width : 0}
							setOpen={setOpen}
							setHovered={setHovered}
						/>
					))}
				</div>
			</div>
			<ScrollMoreFade more={more} />
		</div>
	);
}

function TableRow({
	row,
	rank,
	share,
	open,
	hot,
	leaderShare,
	sparkDays,
	scrolled,
	width,
	setOpen,
	setHovered,
}: {
	row: Row;
	rank: string;
	share: string;
	open: boolean;
	/** Highlighted by the hover anywhere on the page. */
	hot: boolean;
	leaderShare: number;
	sparkDays: number;
	scrolled: boolean;
	/** Visible table width, for the open detail. */
	width: number;
	setOpen: (id: string | null) => void;
	setHovered: (id: string | null) => void;
}) {
	const f = useFormat();
	const detail = useId();
	const spark = row.daily.slice(-sparkDays);
	const [lo, hi] = autoRange(spark, SPARK_MIN_SPAN);
	const pinned = `sticky z-1 flex items-center self-stretch transition-colors duration-150 ${hot || open ? "bg-hov" : "bg-bg"}`;

	return (
		<>
			{/*
			 * A click anywhere on the row toggles the detail. The solver's name is the disclosure
			 * button for keyboards and assistive tech: its click (Enter and Space too) bubbles up to
			 * the row, which draws the focus ring around itself.
			 */}
			<div
				role="row"
				onClick={() => setOpen(open ? null : row.id)}
				onMouseEnter={() => setHovered(row.id)}
				onMouseLeave={() => setHovered(null)}
				className={`${GRID} focus-inset box-content h-[50px] cursor-pointer border-b border-ln font-mono text-[13px] leading-[normal] font-medium transition-colors duration-150 ${hot || open ? "bg-hov" : ""}`}
			>
				<span role="cell" className={`${pinned} left-0 pl-2 text-mu`}>
					{rank}
				</span>
				<span
					role="cell"
					className={`${pinned} left-9 -ml-4 min-w-0 gap-2.5 pr-2 pl-4 ${scrolled ? EDGE : ""}`}
				>
					<button
						type="button"
						aria-expanded={open}
						aria-controls={open ? detail : undefined}
						className="flex min-w-0 items-center self-stretch"
					>
						<span className={`truncate text-[14px] ${row.unnamed ? "" : "font-sans"}`}>
							{row.label}
						</span>
					</button>
					<RankChange row={row} />
					<Caret open={open} className="ml-auto size-[13px] text-fa" />
				</span>
				<span role="cell" className="flex items-center gap-3">
					<span className="h-[3px] flex-1 rounded-[2px] bg-ln">
						<span
							style={bar(row, hot, leaderShare)}
							className="block h-full rounded-[2px] transition-colors duration-200"
						/>
					</span>
					<span className="flex-[0_0_46px] text-right">{share}</span>
				</span>
				{VALUE_COLUMNS.map((key) => (
					<span key={key} role="cell" className="text-right">
						{cellText(row, key, f)}
					</span>
				))}
				<svg
					viewBox="0 0 100 22"
					preserveAspectRatio="none"
					aria-hidden="true"
					className="h-[22px] w-full overflow-visible"
				>
					<path
						d={linePath(spark, lo, hi, 100, 22).line}
						fill="none"
						strokeWidth={1.3}
						strokeLinejoin="round"
						vectorEffect="non-scaling-stroke"
						className="stroke-fg opacity-80"
					/>
				</svg>
			</div>
			{open ? (
				// The detail spans the row, so the table stays a table to assistive tech.
				<div role="row" id={detail}>
					<div role="cell" aria-colspan={COLUMNS.length + 2}>
						<DetailWide row={row} width={width} />
					</div>
				</div>
			) : null}
		</>
	);
}

/** The compact list (below 760px): rank, name, share and a meta line; a tap opens the detail. */
export function List({ rows }: { rows: Row[] }) {
	const view = useView();
	const { open, setOpen } = useDashboard();
	const { hovered } = useHover();
	const leaderShare = view.rows[0]?.share ?? 0;
	// The table's mark for figures that auction data covers only in part ("Volume†"): the list has
	// no headers, so its figures carry it.
	const mark = view.coverage.auction < view.days ? "†" : "";

	return (
		<div className="mt-6 border-t border-ln2 tabular-nums wide:hidden">
			{rows.map((row) => (
				<ListRow
					key={row.id}
					row={row}
					measure={view.measure}
					mark={mark}
					open={open === row.id}
					hot={isHot(hovered, row.id, hoverIndex(row, view.measure))}
					leaderShare={leaderShare}
					setOpen={setOpen}
				/>
			))}
		</div>
	);
}

function ListRow({
	row,
	measure,
	mark,
	open,
	hot,
	leaderShare,
	setOpen,
}: {
	row: Row;
	measure: Measure;
	/** "†" after the figures auction data covers in part; empty when it covers the window. */
	mark: string;
	open: boolean;
	hot: boolean;
	leaderShare: number;
	setOpen: (id: string | null) => void;
}) {
	const t = useTranslations("Winning");
	const f = useFormat();
	const value = t("metaValue", {
		measure,
		count: measure === "volume" ? 0 : row[measure],
		volume: f.usd(row.volume),
		mark: row.volume === null ? "" : mark,
	});
	const gas = t("meta.gas", { gas: f.gas(row.gasPerTrade) });

	return (
		<>
			<RowButton
				open={open}
				onToggle={() => setOpen(open ? null : row.id)}
				className="focus-inset grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-ln py-3.5 pr-1.5"
			>
				{/* Clear of the inset focus ring on both sides: the rank here, the rest by the row. */}
				<span className="pl-1.5 font-mono text-[12px] leading-[normal] font-medium text-mu">
					{rankText(row, measure)}
				</span>
				<span className="flex min-w-0 items-center gap-2">
					<span
						className={`truncate text-[15px] font-medium ${row.unnamed ? "font-mono" : ""}`}
					>
						{row.label}
					</span>
					<RankChange row={row} />
				</span>
				<span className="flex items-center gap-2 font-mono text-[14px] leading-[normal] font-medium">
					{shareText(row, measure, f)}
					<Caret open={open} className="text-fa" />
				</span>
				<span className="col-[2/4] h-[3px] rounded-[2px] bg-ln">
					<span
						style={bar(row, hot, leaderShare)}
						className="block h-full rounded-[2px]"
					/>
				</span>
				<DotList
					items={
						row.entered
							? [
									value,
									t("meta.entered", {
										entered: f.percent(row.participation),
										mark,
									}),
									t("meta.winRate", { winRate: f.percent(row.winRate), mark }),
									gas,
								]
							: [value, gas, t("meta.noAuctions")]
					}
					className="col-[2/4] font-mono text-[11.5px] leading-[normal] font-medium text-mu"
				/>
			</RowButton>
			{open ? <DetailCompact row={row} /> : null}
		</>
	);
}

/** "▲2", "▼1" or "NEW" against the earlier window; nothing when there is none to compare. */
function RankChange({ row }: { row: Row }) {
	const t = useTranslations("Winning.rankChange");
	const change = row.rankChange ?? 0;
	if (!row.isNew && change === 0) return null;
	const direction = row.isNew ? "new" : change > 0 ? "up" : "down";
	const places = Math.abs(change);
	return (
		<span
			className={`font-mono text-[10.5px] leading-[normal] font-medium ${direction === "down" ? "text-mu" : "text-fg"}`}
		>
			<span aria-hidden="true">{t("short", { direction, places })}</span>
			<span className="sr-only">{t("spoken", { direction, places })}</span>
		</span>
	);
}

/** A compact row that opens its detail: a tap, Enter or Space toggles it. */
function RowButton({
	open,
	onToggle,
	...props
}: { open: boolean; onToggle: () => void } & Omit<
	HTMLAttributes<HTMLDivElement>,
	"role" | "tabIndex" | "onClick" | "onKeyDown"
>) {
	return (
		<div
			{...props}
			role="button"
			tabIndex={0}
			aria-expanded={open}
			onClick={onToggle}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onToggle();
				}
			}}
		/>
	);
}

/** The share bar's fill: relative to the leader, in the solver's tone (never paler than the 6th). */
function bar(row: Row, hot: boolean, leaderShare: number): CSSProperties {
	return {
		width: `${leaderShare > 0 ? (row.share / leaderShare) * 100 : 0}%`,
		background: hot ? TEAL : tone(row.rank - 1, BAR_MIN_TONE),
	};
}
