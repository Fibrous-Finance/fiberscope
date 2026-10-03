/** Chart geometry: the hero's mosaic and the line/area paths. Pure math, in SVG user units. */

export interface MosaicSize {
	/** Square edge in CSS px. */
	square: number;
	gap: number;
	maxRows: number;
}

export const MOSAIC_WIDE: MosaicSize = { square: 9, gap: 2, maxRows: 38 };
export const MOSAIC_COMPACT: MosaicSize = { square: 6, gap: 1.5, maxRows: 26 };

/** What one square can stand for: 1, 2, 5, 10, 20, 25, 50, 100, … */
export const MOSAIC_UNITS: readonly number[] = Array.from({ length: 13 }, (_, e) =>
	[1, 2, 2.5, 5].map((m) => m * 10 ** e)
)
	.flat()
	.filter(Number.isInteger);

export interface Mosaic {
	/** Value of one square. */
	unit: number;
	squares: number;
	/** Columns actually used, so the drawing spans the full width. */
	columns: number;
	rows: number;
	/** One path per value, in the order given; each square is a unit square. */
	paths: string[];
	/** Drawing size in square units (the viewBox). */
	width: number;
	height: number;
}

/**
 * Squares fill column by column (top to bottom, then the next column) in the order of `values`,
 * so each value becomes a vertical block and the field reads left to right like a share bar.
 */
export function mosaic(values: readonly number[], contentWidth: number, size: MosaicSize): Mosaic {
	const total = values.reduce((a, b) => a + b, 0);
	const maxColumns = Math.max(
		20,
		Math.floor((contentWidth + size.gap) / (size.square + size.gap))
	);
	const unit =
		MOSAIC_UNITS.find((u) => total / u <= maxColumns * size.maxRows) ?? MOSAIC_UNITS.at(-1)!;
	const counts = values.map((v) => (v > 0 ? Math.max(1, Math.round(v / unit)) : 0));
	const squares = counts.reduce((a, b) => a + b, 0);
	const rows = Math.max(1, Math.ceil(squares / maxColumns));
	const columns = Math.max(1, Math.ceil(squares / rows));
	const gap = size.gap / size.square;
	const step = 1 + gap;
	let k = 0;
	const paths = counts.map((n) => {
		let d = "";
		for (let j = 0; j < n; j++, k++) {
			const x = Math.floor(k / rows) * step;
			const y = (k % rows) * step;
			d += `M${+x.toFixed(2)} ${+y.toFixed(2)}h1v1h-1z`;
		}
		return d;
	});
	return {
		unit,
		squares,
		columns,
		rows,
		paths,
		width: +(columns * step - gap).toFixed(3),
		height: +(rows * step - gap).toFixed(3),
	};
}

/** A y-range that spans at least `minSpan`, centered on the data and never below 0. */
export function autoRange(values: readonly number[], minSpan: number): [number, number] {
	if (values.length === 0) return [0, minSpan];
	let lo = Math.min(...values);
	let hi = Math.max(...values);
	if (hi - lo < minSpan) {
		lo = Math.max(0, (hi + lo) / 2 - minSpan / 2);
		hi = lo + minSpan;
	}
	return [lo, hi];
}

export interface LinePath {
	line: string;
	/** The line closed down to the baseline. */
	area: string;
	/** Last point's height, as a percentage of `height` from the top. */
	endY: number;
}

/** Points spread evenly across `width`, scaled from [lo, hi] to [height, 0]. */
export function linePath(
	values: readonly number[],
	lo: number,
	hi: number,
	width: number,
	height: number
): LinePath {
	const n = values.length;
	const span = hi - lo || 1;
	const points = values.map((v, i) => [
		n > 1 ? (i / (n - 1)) * width : width,
		height - ((Math.min(hi, Math.max(lo, v)) - lo) / span) * height,
	]);
	if (points.length === 0) return { line: "", area: "", endY: 100 };
	const line = "M" + points.map(([x, y]) => `${x!.toFixed(2)} ${y!.toFixed(2)}`).join("L");
	return {
		line,
		area: `${line}L${width} ${height}L${points[0]![0]!.toFixed(2)} ${height}Z`,
		endY: (points.at(-1)![1]! / height) * 100,
	};
}
