import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { swapsAxis } from "./efficiency.ts";

const row = (trades: number, swapsPerTrade: number | null) => ({ trades, swapsPerTrade });

describe("swapsAxis", () => {
	it("leaves a low-sample outlier beyond the axis", () => {
		// A low-sample solver: 11.28 swaps per trade from fewer than 30 trades; the rest stay under 3.
		const axis = swapsAxis([row(9_000, 1.6), row(400, 2.94), row(12, 11.28)], 1.8);
		assert.equal(axis.max, 3);
		assert.deepEqual(axis.ticks, [0, 1, 2, 3]);
	});

	it("counts a solver with exactly 30 trades, and an end equal to the value holds it", () => {
		assert.equal(swapsAxis([row(30, 4)], 1.8).max, 4);
		assert.equal(swapsAxis([row(29, 4)], 1.8).max, 2);
		assert.equal(swapsAxis([row(30, 4.01)], 1.8).max, 5);
	});

	it("holds the network average even when no solver reaches it", () => {
		assert.equal(swapsAxis([row(100, 1.2)], 2.5).max, 3);
		assert.equal(swapsAxis([], null).max, 2);
	});

	it("ticks every 2 above 6, and stops at 20", () => {
		assert.deepEqual(swapsAxis([row(100, 7.5)], 1.8).ticks, [0, 2, 4, 6, 8]);
		const capped = swapsAxis([row(100, 31)], 1.8);
		assert.equal(capped.max, 20);
		assert.equal(capped.ticks.at(-1), 20);
	});

	it("ignores solvers without trades", () => {
		assert.equal(swapsAxis([row(0, null), row(50, 1.1)], 1.1).max, 2);
	});
});
