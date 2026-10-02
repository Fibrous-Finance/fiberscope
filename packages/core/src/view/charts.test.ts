import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mosaic, MOSAIC_COMPACT, MOSAIC_UNITS, MOSAIC_WIDE } from "./charts.ts";

describe("mosaic", () => {
	it("matches the design at 1280px: one square per batch, 35 rows", () => {
		const m = mosaic([1711, 474, 317, 1150], 1184, MOSAIC_WIDE);
		assert.equal(m.unit, 1);
		assert.equal(m.squares, 3652);
		assert.equal(m.rows, 35);
		// 3,652 squares in 35 rows fill 105 columns, not the 107 that would fit.
		assert.equal(m.columns, 105);
	});

	it("picks the smallest unit that fits the row limit", () => {
		assert.deepEqual(MOSAIC_UNITS.slice(0, 8), [1, 2, 5, 10, 20, 25, 50, 100]);
		// $4.87M: 1,000 per square needs 4,870 squares, over the 107 × 38 limit; 2,000 needs 2,435.
		const m = mosaic([4_870_000], 1184, MOSAIC_WIDE);
		assert.equal(m.unit, 2000);
		const compact = mosaic([3652], 350, MOSAIC_COMPACT);
		assert.equal(compact.unit, 5);
		assert.ok(compact.rows <= MOSAIC_COMPACT.maxRows);
	});

	it("fills columns top to bottom in the order given, at least one square per non-zero value", () => {
		const m = mosaic([3, 0, 0.2], 0, { square: 1, gap: 0, maxRows: 2 });
		assert.equal(m.unit, 1);
		assert.equal(m.rows, 1);
		// 20 columns minimum; 4 squares in one row.
		assert.deepEqual(m.paths, ["M0 0h1v1h-1zM1 0h1v1h-1zM2 0h1v1h-1z", "", "M3 0h1v1h-1z"]);
		const tall = mosaic([30, 10], 0, { square: 1, gap: 0, maxRows: 2 });
		// 40 squares over 20 columns → 2 rows; the first value fills columns 0–14.
		assert.equal(tall.rows, 2);
		assert.ok(tall.paths[0]!.startsWith("M0 0h1v1h-1zM0 1h1v1h-1zM1 0"));
		assert.ok(tall.paths[1]!.startsWith("M15 0"));
	});
});
