import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { costAxis, gasAxis, swapsAxis } from "./efficiency.ts";

describe("gasAxis", () => {
	const gas = (trades: number, gasPerTrade: number | null) => ({ trades, gasPerTrade });

	it("leaves a low-sample outlier beyond the axis", () => {
		// 7D on 14 Oct: the network at 664K, the heaviest large solver at 1.41M, and 4.78M from
		// a solver with 2 trades.
		const axis = gasAxis(
			[gas(9_000, 285_000), gas(400, 1_410_000), gas(2, 4_780_000)],
			664_000
		);
		assert.equal(axis.max, 2_000_000);
		assert.deepEqual(axis.ticks, [0, 500_000, 1_000_000, 1_500_000, 2_000_000]);
	});

	it("counts a solver with exactly 30 trades, and an end equal to the value holds it", () => {
		assert.equal(gasAxis([gas(30, 2_600_000)], 664_000).max, 3_000_000);
		assert.equal(gasAxis([gas(29, 2_600_000)], 664_000).max, 2_000_000);
		assert.equal(gasAxis([gas(30, 2_500_000)], 664_000).max, 2_500_000);
		assert.equal(gasAxis([gas(30, 2_500_001)], 664_000).ticks.at(-1), 3_000_000);
	});

	it("holds the network average, and ends at 2M or more", () => {
		assert.equal(gasAxis([gas(100, 300_000)], 2_100_000).max, 2_500_000);
		assert.equal(gasAxis([gas(100, 300_000)], 300_000).max, 2_000_000);
		assert.equal(gasAxis([], null).max, 2_000_000);
	});

	it("ignores solvers without trades", () => {
		assert.equal(gasAxis([gas(0, null), gas(50, 900_000)], 900_000).max, 2_000_000);
	});
});

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

	it("ticks every 2 up to 12, then every 5, and stops at 20", () => {
		assert.deepEqual(swapsAxis([row(100, 7.5)], 1.8).ticks, [0, 2, 4, 6, 8]);
		assert.deepEqual(swapsAxis([row(100, 11)], 1.8).ticks, [0, 2, 4, 6, 8, 10, 12]);
		// 7D on 14 Oct: Elfomo at 14.50 over 34 trades.
		assert.deepEqual(swapsAxis([row(34, 14.5)], 2.49).ticks, [0, 5, 10, 15]);
		const capped = swapsAxis([row(100, 31)], 1.8);
		assert.equal(capped.max, 20);
		assert.deepEqual(capped.ticks, [0, 5, 10, 15, 20]);
	});

	it("labels its end, whatever it is", () => {
		for (let swaps = 0; swaps <= 25; swaps += 0.25) {
			const axis = swapsAxis([row(100, swaps)], null);
			assert.equal(axis.ticks.at(-1), axis.max, `swaps ${swaps}`);
		}
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

	it("labels its end, whatever it is", () => {
		for (let cents = 0; cents <= 60; cents += 0.25) {
			const axis = costAxis([cost(100, cents / 100)], null);
			assert.equal(axis.ticks.at(-1), axis.max, `${cents}¢`);
		}
	});
});
