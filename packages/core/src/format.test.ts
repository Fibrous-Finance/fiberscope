import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFormat } from "./format.ts";

const f = createFormat("en");

describe("format", () => {
	it("abbreviates dollars with fewer decimals as amounts grow", () => {
		assert.equal(f.usd(4_870_000), "$4.87M");
		assert.equal(f.usd(285_674), "$286K");
		assert.equal(f.usd(52_998), "$53.0K");
		assert.equal(f.usd(3_559), "$3.56K");
		assert.equal(f.usd(56.4), "$56");
		assert.equal(f.usd(0.19), "<$1");
		assert.equal(f.usd(0.6), "<$1");
		assert.equal(f.usd(0), "$0");
		assert.equal(f.usd(null), "—");
	});

	it("moves dollars up a tier where rounding would reach the next one", () => {
		assert.equal(f.usd(999.4), "$999");
		assert.equal(f.usd(999.6), "$1.00K");
		assert.equal(f.usd(9_994), "$9.99K");
		assert.equal(f.usd(9_996), "$10.0K");
		assert.equal(f.usd(99_949), "$99.9K");
		assert.equal(f.usd(99_960), "$100K");
		assert.equal(f.usd(999_499), "$999K");
		assert.equal(f.usd(999_600), "$1.00M");
	});

	it("writes surplus with cents below $100 and never as $0.00 or $100.00", () => {
		assert.equal(f.usdCents(36.4), "$36.40");
		assert.equal(f.usdCents(0.08), "$0.08");
		assert.equal(f.usdCents(0.004), "<$0.01");
		assert.equal(f.usdCents(0), "$0");
		assert.equal(f.usdCents(99.994), "$99.99");
		assert.equal(f.usdCents(99.996), "$100");
		assert.equal(f.usdCents(1_234.5), "$1.23K");
		assert.equal(f.usdCents(null), "—");
	});

	it("writes totals in sentences as whole dollars with separators", () => {
		assert.equal(f.usdWhole(583_649.4), "$583,649");
		assert.equal(f.usdWhole(null), "—");
	});

	it("writes transaction cost in cents until a dollar, moving up where rounding would", () => {
		assert.equal(f.cost(0.0183), "1.8¢");
		assert.equal(f.cost(0.0073), "0.7¢");
		assert.equal(f.cost(0.0004), "<0.1¢");
		assert.equal(f.cost(0), "0¢");
		assert.equal(f.cost(0.0996), "10¢");
		assert.equal(f.cost(0.12), "12¢");
		assert.equal(f.cost(0.996), "$1.00");
		assert.equal(f.cost(1.24), "$1.24");
		assert.equal(f.cost(null), "—");
	});

	it("writes a ratio in whole basis points with separators", () => {
		assert.equal(f.bps(0.02234), "223");
		assert.equal(f.bps(0.42012), "4,201");
		assert.equal(f.bps(null), "—");
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

	it("shows a share that is neither 0 nor 1 as neither 0% nor 100%", () => {
		assert.equal(f.percent(0), "0%");
		assert.equal(f.percent(0.004), "<1%");
		assert.equal(f.percent(0.005), "1%");
		assert.equal(f.percent(0.0004, 1), "<0.1%");
		assert.equal(f.percent(0.469, 1), "46.9%");
		assert.equal(f.percent(0.994), "99%");
		assert.equal(f.percent(0.996), ">99%");
		assert.equal(f.percent(0.9996, 1), ">99.9%");
		assert.equal(f.percent(1), "100%");
	});

	it("writes English dates day first with three-letter months, in UTC, never split", () => {
		const t = Date.UTC(2026, 8, 13, 22, 10, 5);
		assert.equal(f.day(t), "13\u00a0Sep");
		assert.equal(f.dayTime(t), "13\u00a0Sep 22:10");
		assert.equal(f.clock(t), "22:10:05");
		assert.equal(f.date(t), "13\u00a0Sep\u00a02026");
	});

	it("says how old the data is in minutes, then rounded hours, then days, unsplit", () => {
		const minute = 60_000;
		assert.equal(f.ago(20_000), "1\u00a0minute ago");
		assert.equal(f.ago(47 * minute), "47\u00a0minutes ago");
		assert.equal(f.ago(59 * minute + 29_000), "59\u00a0minutes ago");
		assert.equal(f.ago(59 * minute + 31_000), "1\u00a0hour ago");
		assert.equal(f.ago(472 * minute), "8\u00a0hours ago");
		assert.equal(f.ago(35 * 60 * minute), "35\u00a0hours ago");
		// From 36 hours on, days: 36 hours rounds to 2 days.
		assert.equal(f.ago(36 * 60 * minute), "2\u00a0days ago");
		assert.equal(f.ago(3_060 * minute), "2\u00a0days ago");
	});

	it("dates the as-of time only when it is another UTC day, with no-break spaces", () => {
		const data = Date.UTC(2026, 9, 3, 9, 49, 53);
		assert.equal(f.asOf(data, Date.UTC(2026, 9, 3, 17, 41)), "09:49\u00a0UTC");
		assert.equal(f.asOf(data, Date.UTC(2026, 9, 5, 0, 0)), "3\u00a0Oct, 09:49\u00a0UTC");
		// Midnight in UTC, not in the reader's time zone, starts the next day.
		const late = Date.UTC(2026, 9, 2, 23, 55);
		assert.equal(f.asOf(late, Date.UTC(2026, 9, 2, 23, 59)), "23:55\u00a0UTC");
		assert.equal(f.asOf(late, Date.UTC(2026, 9, 3, 0, 10)), "2\u00a0Oct, 23:55\u00a0UTC");
	});

	it("follows the locale for other languages", () => {
		const tr = createFormat("tr");
		assert.equal(tr.percent(0.469, 1), "%46,9");
		assert.equal(tr.points(6.54), "+6,5");
	});
});
