"use client";

import { useId, useState } from "react";
import type { KeyboardEvent, Ref } from "react";

import { useTranslations } from "next-intl";

import type { TapeCell, TapeRow as TapeRowData, View } from "@fiberscope/core";

import { useHover } from "@/components/dashboard/context";
import { isHot } from "@/components/dashboard/tones";

import { useFormat } from "@/lib/format";

/** One column per auction; compact pages show the latest half. */
const WIDE_COLUMNS = 48;
const COMPACT_COLUMNS = 24;
const NBSP = "\u00a0";

/**
 * The name column: as wide as the bars' names on wide pages, 112px on compact ones, room for a
 * typical two-word solver name.
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

type TapeAuction = View["tape"]["auctions"][number];

/** The auctions on the tape, oldest first: the latest 48, the latest 24 on compact pages. */
export function tapeAuctions(tape: View["tape"], compact: boolean): TapeAuction[] {
	return tape.auctions.slice(-(compact ? COMPACT_COLUMNS : WIDE_COLUMNS));
}

/**
 * The latest auctions, one column each and one row per solver that entered one of them. One
 * auction is selected: a click or tap selects a column and opens its solutions under the tape,
 * while hovering a column only previews it in the readout. The tape is a single tab stop, to
 * assistive tech a grid with one cell per auction: ← → Home End move the selection, Enter or Space
 * opens or closes the solutions, Escape closes them. Cells are plain marks. The block is `#tape`,
 * where a solver detail's "Latest 24 auctions" links.
 */
export function Tape({
	ref,
	auctions,
	rows,
	rankIndex,
	selected,
	open,
	onSelect,
	onOpenChange,
}: {
	/** The tape's tab stop. */
	ref?: Ref<HTMLDivElement>;
	/** The auctions shown, oldest first (`tapeAuctions`). */
	auctions: TapeAuction[];
	rows: TapeRowData[];
	rankIndex: Map<string, number>;
	/** The selected auction's id, one of `auctions`. */
	selected: number;
	/** The selected auction's solutions are open under the tape, in `#fs-solutions`. */
	open: boolean;
	onSelect: (id: number) => void;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("Enter.tape");
	const tc = useTranslations("Common");
	const f = useFormat();
	const { hovered, setHovered } = useHover();
	const cellId = useId();
	// The column under the pointer, which the readout previews.
	const [pointed, setPointed] = useState<number | null>(null);
	// The selected column shows the focus ring only while the tape has keyboard focus.
	const [keyboard, setKeyboard] = useState(false);

	const count = auctions.length;
	const column = auctions.findIndex((auction) => auction.id === selected);
	const shown = pointed !== null && pointed < count ? pointed : column;
	const auction = auctions[shown];
	const columnBox = (index: number) => ({
		left: `${(index / count) * 100}%`,
		width: `${100 / count}%`,
	});
	// A row per solver that entered one of the auctions shown: on compact pages, solvers whose
	// entries are all older than the latest 24 have none.
	const lines = rows
		.map((row) => ({ row, cells: row.cells.slice(-count) }))
		.filter(({ cells }) => cells.some((cell) => cell.state !== "absent"));
	// The readout wraps only between its items and between winners: each name stays whole.
	const readout = (auction: TapeAuction) => ({
		id: f.int(auction.id),
		time: f.clock(auction.time),
		entered: auction.entered,
		winners: auction.winners.length,
		names: auction.winners
			.map((winner) => winner.label.replaceAll(" ", NBSP))
			.join(`${NBSP}+ `),
	});

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const moves: Partial<Record<string, number>> = {
			ArrowLeft: column - 1,
			ArrowRight: column + 1,
			Home: 0,
			End: count - 1,
		};
		const next = moves[event.key];
		if (next !== undefined) {
			onSelect(auctions[Math.min(count - 1, Math.max(0, next))].id);
		} else if (event.key === "Enter" || event.key === " ") {
			// Enter selects and opens, as a click does: the auction stays put when new data comes.
			onSelect(auctions[column].id);
			onOpenChange(!open);
		} else if (event.key === "Escape" && open) {
			onOpenChange(false);
		} else {
			return;
		}
		event.preventDefault();
		// The keys act on the selection: the readout shows it again, and the ring marks it.
		setPointed(null);
		setKeyboard(true);
	};

	return (
		// The detail's "Latest 24 auctions" lands here: the margin keeps the title clear of the header.
		<div id="tape" className="mt-14 scroll-mt-6">
			<div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
				<h3 className="text-[15px] font-medium max-wide:basis-full">
					{t("title", { count })}
				</h3>
				{/* The grid reads out the selection; the readout is for the eye. */}
				<span className="min-w-0 font-mono text-[12px] leading-[normal] font-medium wrap-break-word text-mu">
					{t.rich("readout", {
						...readout(auction),
						winner: (chunks) => <span className="text-fg">{chunks}</span>,
					})}
				</span>
			</div>
			<div
				ref={ref}
				tabIndex={0}
				role="grid"
				aria-label={t("label", { count })}
				aria-activedescendant={`${cellId}-${column}`}
				onKeyDown={onKeyDown}
				onFocus={(event) => setKeyboard(event.currentTarget.matches(":focus-visible"))}
				onBlur={() => setKeyboard(false)}
				onMouseLeave={() => setPointed(null)}
				className="mt-3.5 focus-visible:shadow-none focus-visible:outline-none"
			>
				<div onMouseLeave={() => setHovered(null)} className="relative">
					{/*
					 * Over the cells: the highlight of the column in the readout and, while its
					 * solutions are open, of the selected one; from the keyboard, the selected
					 * column's ring.
					 */}
					<div
						aria-hidden="true"
						className={`pointer-events-none absolute inset-y-0 right-0 ${CELLS_LEFT}`}
					>
						<div className="absolute inset-y-0 bg-hov" style={columnBox(shown)} />
						{open && shown !== column ? (
							<div className="absolute inset-y-0 bg-hov" style={columnBox(column)} />
						) : null}
						{keyboard ? (
							<div
								className="absolute -inset-y-[3px] z-[2] rounded-[3px] shadow-[0_0_0_2px_#1b1f2c,0_0_0_4px_#11b2ba]"
								style={columnBox(column)}
							/>
						) : null}
					</div>
					{/*
					 * One cell per auction, over its column, named as the readout names it. The
					 * selected one says whether its solutions are open.
					 */}
					<div
						role="row"
						className={`pointer-events-none absolute inset-y-0 right-0 ${CELLS_LEFT}`}
					>
						{auctions.map((cell, index) => (
							<div
								key={cell.id}
								id={`${cellId}-${index}`}
								role="gridcell"
								aria-selected={index === column}
								aria-expanded={open && index === column}
								aria-controls={index === column ? "fs-solutions" : undefined}
								aria-label={t.markup("readout", {
									...readout(cell),
									winner: (chunks) => chunks,
								})}
								className="absolute inset-y-0"
								style={columnBox(index)}
							/>
						))}
					</div>
					{lines.map(({ row, cells }) => (
						<TapeRow
							key={row.id}
							row={row}
							cells={cells}
							hot={isHot(hovered, row.id, rankIndex.get(row.id) ?? -1)}
							onHover={setHovered}
							onPoint={setPointed}
							onPick={(index) => {
								onSelect(auctions[index].id);
								onOpenChange(true);
							}}
						/>
					))}
				</div>
				<div
					aria-hidden="true"
					className="mt-2 flex font-mono text-[11px] leading-[normal] font-medium text-fa"
				>
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
	cells,
	hot,
	onHover,
	onPoint,
	onPick,
}: {
	row: TapeRowData;
	/** Its cells in the auctions shown. */
	cells: TapeCell[];
	hot: boolean;
	onHover: (id: string | null) => void;
	/** The pointer entered a column. */
	onPoint: (index: number) => void;
	/** A column was clicked or tapped. */
	onPick: (index: number) => void;
}) {
	return (
		<div
			aria-hidden="true"
			// Only a mouse hovers: a tap picks an auction and highlights no solver.
			onPointerEnter={(event) => {
				if (event.pointerType === "mouse") onHover(row.id);
			}}
			className="relative flex h-5 items-center wide:h-[17px]"
		>
			<div
				title={row.label}
				className={`${NAME_COLUMN} truncate text-[12px] ${row.unnamed ? "font-mono" : ""} ${hot ? "text-fg" : "text-mu"}`}
			>
				{row.label}
			</div>
			<div className="flex h-full flex-1">
				{cells.map((cell, index) => (
					<span
						key={index}
						onPointerEnter={(event) => {
							if (event.pointerType === "mouse") onPoint(index);
						}}
						onClick={() => onPick(index)}
						className="grid flex-1 cursor-pointer place-items-center"
					>
						<span
							className={`${MARKS[cell.state]} ${cell.state === "won" ? (hot ? "bg-teal" : "bg-fg") : ""}`}
						/>
					</span>
				))}
			</div>
		</div>
	);
}
