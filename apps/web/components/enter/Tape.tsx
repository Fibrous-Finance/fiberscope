"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";

import { useTranslations } from "next-intl";

import type { TapeCell, TapeRow as TapeRowData, View } from "@fiberscope/core";

import { useHover } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";

import { useFormat } from "@/lib/format";

/** One column per auction; compact pages show the latest half. */
const WIDE_COLUMNS = 48;
const COMPACT_COLUMNS = 24;

/**
 * The name column: as wide as the bars' names on wide pages, 112px on compact ones so
 * "Sector Finance" fits.
 */
const NAME_COLUMN = "flex-[0_0_112px] pr-3 wide:flex-[0_0_clamp(96px,16vw,190px)]";
/** Where the cells start, past the name column. */
const CELLS_LEFT = "left-[112px] wide:left-[clamp(96px,16vw,190px)]";

/** Won: an 8px square; entered: a 4px dot; absent: a 2px dot. */
const MARKS: Record<TapeCell["state"], string> = {
	won: "size-2 rounded-[2px]",
	entered: "size-1 rounded-full bg-fg/40",
	absent: "size-0.5 rounded-full bg-ln2",
};

/**
 * The latest auctions, one column each and one row per solver. The tape is a single tab stop:
 * ← → Home End move the selected auction, Enter opens it in CoW Explorer. On wide pages hovering
 * a column selects it and each cell links to its settlement, kept out of the tab order; on compact
 * pages a tap only selects, and the readout's link opens the auction.
 */
export function Tape({
	tape,
	compact,
	rankIndex,
	explorer,
}: {
	tape: View["tape"];
	compact: boolean;
	rankIndex: Map<string, number>;
	/** The CoW Explorer page of a settlement. */
	explorer: (tx: string | null) => string | undefined;
}) {
	const t = useTranslations("Enter.tape");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { hovered, setHovered } = useHover();
	const [column, setColumn] = useState<number | null>(null);
	// The selected column shows the focus ring only while the tape has keyboard focus.
	const [keyboard, setKeyboard] = useState(false);

	const count = Math.min(compact ? COMPACT_COLUMNS : WIDE_COLUMNS, tape.auctions.length);
	const auctions = tape.auctions.slice(-count);
	const selected = column === null || column >= count ? count - 1 : column;
	const auction = auctions[selected];
	const href = explorer(auction.tx);
	const columnBox = { left: `${(selected / count) * 100}%`, width: `${100 / count}%` };

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === "Enter") {
			if (href) {
				event.preventDefault();
				window.open(href, "_blank", "noopener");
			}
			return;
		}
		const moves: Partial<Record<string, number>> = {
			ArrowLeft: selected - 1,
			ArrowRight: selected + 1,
			Home: 0,
			End: count - 1,
		};
		const next = moves[event.key];
		if (next === undefined) return;
		event.preventDefault();
		setColumn(Math.min(count - 1, Math.max(0, next)));
		setKeyboard(true);
	};

	return (
		<div className="mt-14">
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
				<h3 className="text-[15px] font-medium max-wide:basis-full">
					{t("title", { count })}
				</h3>
				<span className="flex flex-wrap items-baseline gap-x-3.5 font-mono text-[12px] leading-[normal] font-medium text-mu">
					<span aria-live="polite">
						{t.rich("readout", {
							id: f.int(auction.id),
							time: f.clock(auction.time),
							entered: auction.entered,
							winners: auction.winners.length,
							names: auction.winners.map((winner) => winner.label).join(" + "),
							winner: (chunks) => (
								<span className="whitespace-nowrap text-fg">{chunks}</span>
							),
						})}
					</span>
					{href ? (
						<a
							href={href}
							target="_blank"
							rel="noopener"
							className="whitespace-nowrap quiet max-wide:inline-flex max-wide:min-h-11 max-wide:items-center"
						>
							{tc("cowExplorer")}
						</a>
					) : null}
				</span>
			</div>
			<div
				tabIndex={0}
				role="group"
				aria-label={t("label", { count })}
				onKeyDown={onKeyDown}
				onFocus={(event) => setKeyboard(event.currentTarget.matches(":focus-visible"))}
				onBlur={() => setKeyboard(false)}
				// Hovering selects on wide pages, so leaving goes back to the latest auction; a
				// tapped selection stays.
				onMouseLeave={compact ? undefined : () => setColumn(null)}
				className="mt-3.5 focus-visible:shadow-none focus-visible:outline-none"
			>
				<div onMouseLeave={() => setHovered(null)} className="relative">
					{/* Over the cells: the selected column's highlight and, from the keyboard, its ring. */}
					<div
						aria-hidden="true"
						className={`pointer-events-none absolute inset-y-0 right-0 ${CELLS_LEFT}`}
					>
						<div className="absolute inset-y-0 bg-hov" style={columnBox} />
						{keyboard ? (
							<div
								className="absolute -inset-y-[3px] z-[2] rounded-[3px] shadow-[0_0_0_2px_#1b1f2c,0_0_0_4px_#11b2ba]"
								style={columnBox}
							/>
						) : null}
					</div>
					{tape.rows.map((row) => (
						<TapeRow
							key={row.id}
							row={row}
							count={count}
							hot={isHot(hovered, row.id, rankIndex.get(row.id) ?? -1)}
							compact={compact}
							explorer={explorer}
							onHover={setHovered}
							onColumn={setColumn}
						/>
					))}
				</div>
				<div className="mt-2 flex font-mono text-[11px] leading-[normal] font-medium text-fa">
					<span className={NAME_COLUMN} />
					<span className="flex flex-1 justify-between">
						<span>{f.clock(auctions[0].time)}</span>
						<span>{tc("utc", { time: f.clock(auctions[count - 1].time) })}</span>
					</span>
				</div>
			</div>
		</div>
	);
}

function TapeRow({
	row,
	count,
	hot,
	compact,
	explorer,
	onHover,
	onColumn,
}: {
	row: TapeRowData;
	/** Latest auctions shown. */
	count: number;
	hot: boolean;
	/** Cells select their auction instead of linking to it. */
	compact: boolean;
	explorer: (tx: string | null) => string | undefined;
	onHover: (id: string | null) => void;
	onColumn: (index: number) => void;
}) {
	return (
		<div
			onMouseEnter={() => onHover(row.id)}
			className="relative flex h-5 items-center wide:h-[17px]"
		>
			<div
				className={`${NAME_COLUMN} truncate text-[12px] ${row.unnamed ? "font-mono" : ""} ${hot ? "text-fg" : "text-mu"}`}
			>
				{row.label}
			</div>
			<div className="flex h-full flex-1">
				{row.cells.slice(-count).map((cell, index) => {
					const mark = (
						<span
							className={`${MARKS[cell.state]} ${cell.state === "won" ? (hot ? "bg-teal" : "bg-fg") : ""}`}
						/>
					);
					return compact ? (
						<span
							key={index}
							aria-hidden="true"
							onMouseEnter={() => onColumn(index)}
							onClick={() => onColumn(index)}
							className="grid flex-1 cursor-pointer place-items-center"
						>
							{mark}
						</span>
					) : (
						<a
							key={index}
							href={explorer(cell.tx)}
							target="_blank"
							rel="noopener"
							tabIndex={-1}
							aria-hidden="true"
							onMouseEnter={() => onColumn(index)}
							className="grid flex-1 place-items-center"
						>
							{mark}
						</a>
					);
				})}
			</div>
		</div>
	);
}
