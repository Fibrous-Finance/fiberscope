"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, Dispatch, HTMLAttributes, SetStateAction } from "react";

import { useTranslations } from "next-intl";

import { autoRange, FIRST_DIRECTION, linePath } from "@fiberscope/core";
import type { Measure, Row } from "@fiberscope/core";

import { useDashboard, useHover, useView } from "@/components/dashboard/context";
import { BAR_MIN_TONE, isHot, TEAL, tone } from "@/components/dashboard/tones";
import { Caret } from "@/components/ui/Section";
import { cellText, COLUMNS, useColumnLabels } from "@/components/winning/columns";
import { DetailCompact, DetailWide } from "@/components/winning/Detail";

import { useFormat } from "@/lib/format";

/** #, Solver, Share, six numbers and the sparkline; the header and every row share it. */
const GRID =
	"grid grid-cols-[36px_minmax(180px,1.6fr)_minmax(140px,1.3fr)_minmax(64px,.7fr)_minmax(64px,.7fr)_minmax(76px,.8fr)_minmax(76px,.8fr)_minmax(70px,.7fr)_minmax(70px,.7fr)_84px] items-center gap-x-4";
/** Once the table is scrolled sideways, the sticky Solver column ends in a hairline. */
const EDGE = "shadow-[inset_-1px_0_0_var(--ln2)]";
/** Sparklines span at least 4 percentage points. */
const SPARK_MIN_SPAN = 0.04;

/** How far the table is scrolled sideways. */
interface Scroll {
	/** Visible width of the table; 0 until measured. */
	width: number;
	/** Scrolled away from the left edge. */
	scrolled: boolean;
	/** Columns are hidden to the right. */
	more: boolean;
}

function measure(el: HTMLElement, setScroll: Dispatch<SetStateAction<Scroll>>) {
	const width = el.clientWidth;
	const scrolled = el.scrollLeft > 1;
	const more = el.scrollLeft + width < el.scrollWidth - 1;
	setScroll((prev) =>
		prev.width === width && prev.scrolled === scrolled && prev.more === more
			? prev
			: { width, scrolled, more }
	);
}

/**
 * The desktop table (760px and up). Below about 1100px it scrolls sideways: # and Solver stay
 * pinned, and a fade on the right edge shows that more columns follow.
 */
export function Table({ rows }: { rows: Row[] }) {
	const view = useView();
	const { sort, setSort, open, setOpen } = useDashboard();
	const { hovered, setHovered } = useHover();
	const t = useTranslations("Winning.columns");
	const labels = useColumnLabels();
	const scroller = useRef<HTMLDivElement>(null);
	const [scroll, setScroll] = useState<Scroll>({ width: 0, scrolled: false, more: false });

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const observer = new ResizeObserver(() => measure(el, setScroll));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const leaderShare = view.rows[0]?.share ?? 0;

	return (
		<div className="relative mt-8 hidden wide:block">
			<div
				ref={scroller}
				onScroll={(event) => measure(event.currentTarget, setScroll)}
				className="overflow-x-auto"
			>
				<div className="min-w-[1000px] tabular-nums">
					<div
						className={`${GRID} box-content h-10 border-b border-ln2 label whitespace-nowrap`}
					>
						<span className="sticky left-0 z-1 flex items-center self-stretch bg-bg">
							{t("rank")}
						</span>
						<span
							className={`sticky left-9 z-1 -ml-4 flex items-center self-stretch bg-bg pl-4 ${scroll.scrolled ? EDGE : ""}`}
						>
							{t("solver")}
						</span>
						{COLUMNS.map((key) => {
							const active = sort.key === key;
							return (
								<button
									key={key}
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
									className={`uppercase ${key === "share" ? "justify-self-start" : "justify-self-end"} ${active ? "text-fg" : "text-mu"}`}
								>
									{active
										? t("sorted", {
												label: labels[key],
												direction:
													sort.direction === 1
														? "ascending"
														: "descending",
											})
										: labels[key]}
								</button>
							);
						})}
						<span className="text-right">{t("spark", { days: view.sparkDays })}</span>
					</div>
					{rows.map((row) => (
						<TableRow
							key={row.id}
							row={row}
							open={open === row.id}
							hot={isHot(hovered, row.id, row.rank - 1)}
							leaderShare={leaderShare}
							sparkDays={view.sparkDays}
							scrolled={scroll.scrolled}
							width={open === row.id ? scroll.width : 0}
							setOpen={setOpen}
							setHovered={setHovered}
						/>
					))}
				</div>
			</div>
			<div
				aria-hidden="true"
				className={`pointer-events-none absolute inset-y-0 right-0 z-2 w-14 bg-[linear-gradient(90deg,transparent,var(--bg))] transition-opacity duration-200 ${scroll.more ? "opacity-100" : "opacity-0"}`}
			/>
		</div>
	);
}

function TableRow({
	row,
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
	const spark = row.daily.slice(-sparkDays);
	const [lo, hi] = autoRange(spark, SPARK_MIN_SPAN);
	const pinned = `sticky z-1 flex items-center self-stretch transition-colors duration-150 ${hot || open ? "bg-hov" : "bg-bg"}`;

	return (
		<>
			<RowButton
				open={open}
				onToggle={() => setOpen(open ? null : row.id)}
				onMouseEnter={() => setHovered(row.id)}
				onMouseLeave={() => setHovered(null)}
				className={`${GRID} focus-inset box-content h-[50px] cursor-pointer border-b border-ln font-mono text-[13px] leading-[normal] font-medium transition-colors duration-150 ${hot || open ? "bg-hov" : ""}`}
			>
				<span className={`${pinned} left-0 text-mu`}>{row.rank}</span>
				<span
					className={`${pinned} left-9 -ml-4 min-w-0 gap-2.5 pr-2 pl-4 ${scrolled ? EDGE : ""}`}
				>
					<span className={`truncate text-[14px] ${row.unnamed ? "" : "font-sans"}`}>
						{row.label}
					</span>
					<RankChange row={row} />
					<Caret open={open} className="ml-auto size-[13px] text-fa" />
				</span>
				<span className="flex items-center gap-3">
					<span className="h-[3px] flex-1 rounded-[2px] bg-ln">
						<span
							style={bar(row, hot, leaderShare)}
							className="block h-full rounded-[2px] transition-colors duration-200"
						/>
					</span>
					<span className="flex-[0_0_46px] text-right">{f.percent(row.share, 1)}</span>
				</span>
				{COLUMNS.slice(1).map((key) => (
					<span key={key} className="text-right">
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
			</RowButton>
			{open ? <DetailWide row={row} width={width} /> : null}
		</>
	);
}

/** The compact list (below 760px): rank, name, share and a meta line; a tap opens the detail. */
export function List({ rows }: { rows: Row[] }) {
	const view = useView();
	const { open, setOpen } = useDashboard();
	const { hovered } = useHover();
	const leaderShare = view.rows[0]?.share ?? 0;

	return (
		<div className="mt-6 border-t border-ln2 tabular-nums wide:hidden">
			{rows.map((row) => (
				<ListRow
					key={row.id}
					row={row}
					measure={view.measure}
					open={open === row.id}
					hot={isHot(hovered, row.id, row.rank - 1)}
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
	open,
	hot,
	leaderShare,
	setOpen,
}: {
	row: Row;
	measure: Measure;
	open: boolean;
	hot: boolean;
	leaderShare: number;
	setOpen: (id: string | null) => void;
}) {
	const t = useTranslations("Winning");
	const f = useFormat();
	const value = measure === "volume" ? f.usd(row.volume) : f.int(row[measure]);
	const gas = f.gas(row.gasPerTrade);

	return (
		<>
			<RowButton
				open={open}
				onToggle={() => setOpen(open ? null : row.id)}
				className="focus-inset grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-ln py-3.5"
			>
				<span className="font-mono text-[12px] leading-[normal] font-medium text-mu">
					{row.rank}
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
					{f.percent(row.share, 1)}
					<Caret open={open} className="text-fa" />
				</span>
				<span className="col-[2/4] h-[3px] rounded-[2px] bg-ln">
					<span
						style={bar(row, hot, leaderShare)}
						className="block h-full rounded-[2px]"
					/>
				</span>
				<span className="col-[2/4] font-mono text-[11.5px] leading-[normal] font-medium text-mu">
					{row.entered
						? t("meta", {
								value,
								entered: f.percent(row.participation),
								winRate: f.percent(row.winRate),
								gas,
							})
						: t("metaNoAuctions", { value, gas })}
				</span>
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
			className={`font-mono text-[10.5px] leading-[normal] font-medium ${direction === "down" ? "text-fa" : "text-fg"}`}
		>
			<span aria-hidden="true">{t("short", { direction, places })}</span>
			<span className="sr-only">{t("spoken", { direction, places })}</span>
		</span>
	);
}

/** A row that opens its detail: a click, Enter or Space toggles it. */
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
