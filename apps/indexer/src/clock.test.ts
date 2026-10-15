import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Clock } from "./clock.ts";

describe("clock", () => {
	// BNB Chain-like: about 0.45 seconds a block, timestamps in whole seconds.
	const clock = new Clock(
		[
			{ block: 100, time: 1_000 },
			{ block: 110, time: 1_004 },
			{ block: 120, time: 1_010 },
		],
		0.45
	);

	test("is exact on an anchor", () => {
		assert.equal(clock.time(100), 1_000);
		assert.equal(clock.time(110), 1_004);
		assert.equal(clock.time(120), 1_010);
	});

	test("interpolates between the anchors around a block, to the nearest second", () => {
		// 0.4 seconds a block up to 110, 0.6 after it.
		assert.equal(clock.time(105), 1_002);
		assert.equal(clock.time(103), 1_001);
		assert.equal(clock.time(115), 1_007);
		assert.equal(clock.time(119), 1_009);
	});

	test("extrapolates beyond the anchors with the average block time", () => {
		assert.equal(clock.time(140), 1_019);
		assert.equal(clock.time(80), 991);
	});

	test("finds the first block after a time, at and between anchors", () => {
		// Block 103 is at 1,001.2 and 104 at 1,001.6: 104 is the first after 1,001.
		assert.equal(clock.firstBlockAfter(1_001), 104);
		assert.equal(clock.firstBlockAfter(1_003), 109);
		// 110 is at 1,004 exactly, 111 at 1,004.6.
		assert.equal(clock.firstBlockAfter(1_004), 111);
		assert.equal(clock.firstBlockAfter(1_009), 120);
	});

	test("finds the first block after a time beyond the anchors", () => {
		// 141 is at 1,019.45, 142 at 1,019.9.
		assert.equal(clock.firstBlockAfter(1_019), 142);
		// 99 is at 999.55, which rounds to the first anchor's second.
		assert.equal(clock.firstBlockAfter(999), 99);
		assert.equal(clock.firstBlockAfter(990), 79);
	});

	test("places the first block after a time consistently with its own times", () => {
		for (let block = 60; block <= 160; block++) {
			const after = clock.firstBlockAfter(clock.time(block) - 1);
			assert.ok(after <= block, `block ${block}`);
			assert.ok(clock.time(after) > clock.time(block) - 1, `block ${block}`);
			assert.ok(clock.time(after - 1) <= clock.time(block) - 1, `block ${block}`);
		}
	});
});
