/** "How efficiently": the DEX swaps per trade axis. */
import { FEW_TRADES } from "./view.ts";
import type { Row } from "./view.ts";

/** The ends the swaps axis can take; it stops at the last one even if a solver goes beyond. */
export const SWAPS_AXIS_ENDS: readonly number[] = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

export interface SwapsAxis {
	/** The axis end, in DEX swaps per trade. */
	max: number;
	/** Tick values from 0 to `max`: every 1, or every 2 above 6. */
	ticks: number[];
}

/**
 * The smallest axis end that holds the network average and every solver with at least
 * `FEW_TRADES` trades. Low-sample solvers can lie beyond it; they sit at its end.
 */
export function swapsAxis(
	rows: readonly Pick<Row, "trades" | "swapsPerTrade">[],
	average: number | null
): SwapsAxis {
	let need = average ?? 0;
	for (const row of rows) {
		if (row.trades >= FEW_TRADES && row.swapsPerTrade !== null) {
			need = Math.max(need, row.swapsPerTrade);
		}
	}
	const max =
		SWAPS_AXIS_ENDS.find((end) => end >= need) ?? SWAPS_AXIS_ENDS[SWAPS_AXIS_ENDS.length - 1]!;
	const step = max <= 6 ? 1 : 2;
	const ticks: number[] = [];
	for (let tick = 0; tick <= max; tick += step) ticks.push(tick);
	return { max, ticks };
}
