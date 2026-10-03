import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { costAxis, swapsAxis } from "./efficiency.ts";

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

describe("costAxis", () => {
	const cost = (trades: number, costPerTrade: number | null) => ({ trades, costPerTrade });

	it("runs in cents to the smallest end that holds the solvers and the network", () => {
		// 7D on 3 Oct: the network at 1.83¢, the dearest large solver at 5.96¢, and one trade
		// at 11¢ from a solver that settled a single batch.
		const axis = costAxis([cost(11_335, 0.0069), cost(1_676, 0.0596), cost(1, 0.11)], 0.0183);
		assert.equal(axis.max, 6);
		assert.deepEqual(axis.ticks, [0, 1, 2, 3, 4, 5, 6]);
	});

	it("counts a solver with exactly 30 trades, and an end equal to the value holds it", () => {
		assert.equal(costAxis([cost(30, 0.04)], 0.018).max, 4);
		assert.equal(costAxis([cost(29, 0.04)], 0.018).max, 2);
		assert.equal(costAxis([cost(30, 0.0401)], 0.018).max, 5);
		assert.equal(costAxis([cost(30, 0.12)], 0.018).max, 12);
	});

	it("holds the network average even when no solver reaches it", () => {
		assert.equal(costAxis([cost(100, 0.004)], 0.025).max, 3);
		assert.equal(costAxis([cost(100, 0.004)], 0.004).max, 1);
		assert.deepEqual(costAxis([], null), { max: 1, ticks: [0, 1] });
	});

	it("ticks every 2¢ up to 12¢, every 5¢ up to 20¢, then every 10¢, and stops at 50¢", () => {
		assert.deepEqual(costAxis([cost(100, 0.075)], 0.018).ticks, [0, 2, 4, 6, 8]);
		assert.deepEqual(costAxis([cost(100, 0.14)], 0.018).ticks, [0, 5, 10, 15]);
		assert.deepEqual(costAxis([cost(100, 0.25)], 0.018).ticks, [0, 10, 20, 30]);
		const capped = costAxis([cost(100, 1.24)], 0.018);
		assert.equal(capped.max, 50);
		assert.deepEqual(capped.ticks, [0, 10, 20, 30, 40, 50]);
	});

	it("ignores solvers without trades", () => {
		assert.equal(costAxis([cost(0, null), cost(50, 0.009)], 0.009).max, 1);
	});
});
