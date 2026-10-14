import type { Measure, Row } from "@fiberscope/core";

import { OTHERS } from "./context";

/** Brand teal: marks the hovered solver everywhere it appears. It is never a solver's own color. */
export const TEAL = "#11B2BA";

/** Mosaic tones by rank: % of --fg over --bg, ranks 1–6, then 14% for everyone else. */
const TONES = [100, 74, 56, 43, 33, 25];
const REST_TONE = 14;
/** Table bars never go below the 6th tone, so small solvers stay visible. */
export const BAR_MIN_TONE = 25;

/** The monochrome tone for the solver at `index` (0 = rank 1), at least `min`%. */
export function tone(index: number, min = 0): string {
	const mix = Math.max(TONES[index] ?? REST_TONE, min);
	return `color-mix(in oklab, var(--fg) ${mix}%, var(--bg))`;
}

/** Whether the solver at `index` is highlighted by the current hover. */
export function isHot(hovered: string | null, id: string, index: number): boolean {
	return hovered === id || (hovered === OTHERS && index >= TONES.length);
}

/**
 * The `index` a row takes in `isHot`: its place in the table, or -1 for a row with none of the
 * measure, which has no squares in the mosaic and is not among its "N others".
 */
export function hoverIndex(row: Row, measure: Measure): number {
	return row.ranks[measure] === null ? -1 : row.rank - 1;
}
