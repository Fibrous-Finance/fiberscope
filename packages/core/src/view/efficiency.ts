/** "How efficiently": the axes of the DEX swaps and transaction cost tracks. */
import { FEW_TRADES } from "./view.ts";
import type { Row } from "./view.ts";

/** The ends the swaps axis can take; it stops at the last one even if a solver goes beyond. */
export const SWAPS_AXIS_ENDS: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
/** The ends the cost axis can take, in cents per trade; it stops at the last one too. */
export const COST_AXIS_ENDS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 50];

/** A track's axis, in the track's unit. */
export interface TrackAxis {
	/** The axis end. */
	max: number;
	/** Tick values from 0 to `max`. */
	ticks: number[];
}

/**
 * The DEX swaps per trade axis: the smallest end that holds the network average and every solver
 * with at least `FEW_TRADES` trades. Ticks every 1, or every 2 above 6.
 */
export function swapsAxis(
	rows: readonly Pick<Row, "trades" | "swapsPerTrade">[],
	average: number | null
): TrackAxis {
	const max = axisEnd(SWAPS_AXIS_ENDS, rows, (row) => row.swapsPerTrade, average);
	return { max, ticks: ticksTo(max, max <= 6 ? 1 : 2) };
}

/**
 * The transaction cost per trade axis, in cents, from costs in USD per trade: the smallest end
 * that holds the network average and every solver with at least `FEW_TRADES` trades. Ticks every
 * 1¢ up to 6¢, every 2¢ up to 12¢, every 5¢ up to 20¢, then every 10¢.
 */
export function costAxis(
	rows: readonly { trades: number; costPerTrade: number | null }[],
	average: number | null
): TrackAxis {
	const max = axisEnd(
		COST_AXIS_ENDS,
		rows,
		(row) => (row.costPerTrade === null ? null : row.costPerTrade * 100),
		average === null ? null : average * 100
	);
	return { max, ticks: ticksTo(max, max <= 6 ? 1 : max <= 12 ? 2 : max <= 20 ? 5 : 10) };
}

/**
 * The first of `ends` that holds `average` and the value of every row with at least
 * `FEW_TRADES` trades, or the last end. Low-sample solvers can lie beyond it; they sit at its end.
 */
function axisEnd<R extends { trades: number }>(
	ends: readonly number[],
	rows: readonly R[],
	value: (row: R) => number | null,
	average: number | null
): number {
	let need = average ?? 0;
	for (const row of rows) {
		const v = value(row);
		if (row.trades >= FEW_TRADES && v !== null) need = Math.max(need, v);
	}
	return ends.find((end) => end >= need) ?? ends[ends.length - 1]!;
}

function ticksTo(max: number, step: number): number[] {
	const ticks: number[] = [];
	for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
	return ticks;
}
