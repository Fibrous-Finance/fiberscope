import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFormat } from "./format.ts";

const f = createFormat("en");

describe("format", () => {
	it("abbreviates dollars by the design's thresholds", () => {
		assert.equal(f.usd(4_870_000), "$4.87M");
		assert.equal(f.usd(285_674), "$286K");
		assert.equal(f.usd(52_998), "$53.0K");
		assert.equal(f.usd(3_559), "$3.56K");
		assert.equal(f.usd(56.4), "$56");
		assert.equal(f.usd(null), "—");
	});

	it("switches gas to millions before thousands would round to 1000K", () => {
		assert.equal(f.gas(644_123), "644K");
		assert.equal(f.gas(999_400), "999K");
		assert.equal(f.gas(999_600), "1.00M");
		assert.equal(f.gas(1_370_000), "1.37M");
	});

	it("signs percentage points, with ± for changes that round to zero", () => {
		assert.equal(f.points(6.54), "+6.5");
		assert.equal(f.points(-0.31), "−0.3");
		assert.equal(f.points(0.04), "±0.0");
		assert.equal(f.points(-0.04), "±0.0");
	});

	it("writes English dates day first with three-letter months, in UTC", () => {
		const t = Date.UTC(2026, 8, 13, 22, 10, 5);
		assert.equal(f.day(t), "13 Sep");
		assert.equal(f.dayTime(t), "13 Sep 22:10");
		assert.equal(f.clock(t), "22:10:05");
		assert.equal(f.date(t), "13 Sep 2026");
	});

	it("follows the locale for other languages", () => {
		const tr = createFormat("tr");
		assert.equal(tr.percent(0.469, 1), "%46,9");
		assert.equal(tr.points(6.54), "+6,5");
	});
});
