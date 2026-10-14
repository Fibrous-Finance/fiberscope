/** "How efficiently": the axes of the gas, DEX swaps and transaction cost tracks. */
import { FEW_TRADES } from "./view.ts";
import type { Row } from "./view.ts";

/** The gas axis ends at 2M or more, on a multiple of its 500K step. */
const GAS_AXIS_MIN = 2_000_000;
const GAS_AXIS_STEP = 500_000;
/** The ends the swaps axis can take; it stops at the last one even if a solver goes beyond. */
const SWAPS_AXIS_ENDS: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];
/** The ends the cost axis can take, in cents per trade; it stops at the last one too. */
const COST_AXIS_ENDS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 50];

/** A track's axis, in the track's unit. */
export interface TrackAxis {
	/** The axis end. */
	max: number;
	/** Tick values from 0 to `max`. */
	ticks: number[];
}

/**
 * The gas per trade axis: the next 500K up, and at least 2M, that holds the network average and
 * every solver with at least `FEW_TRADES` trades. Ticks every 500K.
 */
export function gasAxis(
	rows: readonly Pick<Row, "trades" | "gasPerTrade">[],
	average: number | null
): TrackAxis {
	const need = largest(rows, (row) => row.gasPerTrade, average);
	const max = Math.max(GAS_AXIS_MIN, Math.ceil(need / GAS_AXIS_STEP) * GAS_AXIS_STEP);
	return { max, ticks: ticksTo(max, GAS_AXIS_STEP) };
}

/**
 * The DEX swaps per trade axis: the smallest end that holds the network average and every solver
 * with at least `FEW_TRADES` trades. Ticks every 1 up to 6, every 2 up to 12, then every 5, so
 * the end always gets a label.
 */
export function swapsAxis(
	rows: readonly Pick<Row, "trades" | "swapsPerTrade">[],
	average: number | null
): TrackAxis {
	const max = firstEnd(
		SWAPS_AXIS_ENDS,
		largest(rows, (row) => row.swapsPerTrade, average)
	);
	return { max, ticks: ticksTo(max, max <= 6 ? 1 : max <= 12 ? 2 : 5) };
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
	const need = largest(
		rows,
		(row) => (row.costPerTrade === null ? null : row.costPerTrade * 100),
		average === null ? null : average * 100
	);
	const max = firstEnd(COST_AXIS_ENDS, need);
	return { max, ticks: ticksTo(max, max <= 6 ? 1 : max <= 12 ? 2 : max <= 20 ? 5 : 10) };
}

/** The first of `ends` that holds `need`, or the last one. */
function firstEnd(ends: readonly number[], need: number): number {
	return ends.find((end) => end >= need) ?? ends[ends.length - 1]!;
}

/**
 * What an axis must hold: the larger of `average` and the value of every row with at least
 * `FEW_TRADES` trades. Low-sample solvers can lie beyond it; they sit at the axis end.
 */
function largest<R extends { trades: number }>(
	rows: readonly R[],
	value: (row: R) => number | null,
	average: number | null
): number {
	let need = average ?? 0;
	for (const row of rows) {
		const v = value(row);
		if (row.trades >= FEW_TRADES && v !== null) need = Math.max(need, v);
	}
	return need;
}

function ticksTo(max: number, step: number): number[] {
	const ticks: number[] = [];
	for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
	return ticks;
}
