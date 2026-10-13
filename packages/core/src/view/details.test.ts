import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { auctionDetails } from "./details.ts";
import { buildView } from "./view.ts";
import type { Period } from "./view.ts";

const END = Date.UTC(2026, 9, 13, 20, 12);

const days = (n: number, value: number) => Array.from({ length: n }, () => value);

function solver(id: string, s: Partial<SnapshotSolver> = {}): SnapshotSolver {
	return {
		id,
		name: id.toUpperCase(),
		addresses: [{ env: "prod", address: `0x${id.padEnd(40, "0")}` }],
		batches: days(30, 10),
		trades: days(30, 20),
		swaps: [],
		gas: [],
		volume: days(30, 1_000),
		surplus: [],
		surplusTrades: [],
		surplusVolume: [],
		unusualSurplus: [],
		unusualTrades: [],
		unusualVolume: [],
		cost: [],
		entered: days(30, 100),
		won: days(30, 50),
		solutions: [],
		filteredOut: [],
		losses: [],
		closeLosses: [],
		quotes: [],
		quotesVerified: [],
		quotesSettled: [],
		protocolFees: [],
		partnerFees: [],
		latestSettlements: [],
		...s,
	};
}

function snapshot(detailDays: number, solvers: SnapshotSolver[]): Snapshot {
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_566_513, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays: 30, auctionDays: 30, surplusDays: 30, detailDays },
		auctions: { count: days(30, 200), solutions: days(30, 2_000) },
		solvers,
		latestAuctions: [],
		latestSettlements: [],
		registry: [],
	};
}

const details = (s: Snapshot, period: Period) => auctionDetails(s, buildView(s, period, "batches"));

/** Seven days of details, the newest day busier than the rest. */
const week = snapshot(7, [
	solver("a", {
		solutions: [200, ...days(6, 100)],
		filteredOut: [8, ...days(6, 2)],
		losses: days(7, 40),
		closeLosses: days(7, 10),
		quotes: days(7, 30),
		quotesVerified: days(7, 27),
		quotesSettled: days(7, 15),
		protocolFees: days(7, 0.5),
		partnerFees: days(7, 0.2),
	}),
	solver("b", {
		solutions: days(7, 50),
		filteredOut: days(7, 0),
		quotes: days(7, 10),
		quotesVerified: days(7, 10),
		quotesSettled: days(7, 0),
		protocolFees: days(7, 0.3),
	}),
	// Quotes without batches or entries.
	solver("c", { batches: [], trades: [], volume: [], entered: [], won: [], quotes: [1] }),
]);

describe("auctionDetails", () => {
	it("sums every figure over the window's detail days and divides the totals", () => {
		const d = details(week, "30d");
		assert.equal(d.coverage, 7);
		const a = d.solvers.get("a")!;
		assert.equal(a.solutions, 800);
		assert.equal(a.filteredShare, 20 / 800);
		assert.equal(a.closeLossShare, 0.25);
		assert.equal(a.quoteShare, 210 / 281);
		assert.equal(a.verifiedShare, 0.9);
		assert.equal(a.settledShare, 0.5);
		assert.equal(d.solvers.get("b")!.filteredShare, 0);
		assert.equal(d.solvers.get("b")!.closeLossShare, null);
		// The network's volume and trades over the same 7 days, not the window's 30.
		assert.equal(d.network.trades, 2 * 7 * 20);
		assert.ok(Math.abs(d.network.protocolFeeRate! - (7 * 0.8) / 14_000) < 1e-12);
		assert.ok(Math.abs(d.network.partnerFeeRate! - (7 * 0.2) / 14_000) < 1e-12);
		assert.equal(d.network.settledShare, 105 / 281);
	});

	it("covers only the window's days in a shorter window", () => {
		const d = details(week, "24h");
		assert.equal(d.coverage, 1);
		assert.equal(d.solvers.get("a")!.filteredShare, 8 / 200);
		assert.equal(d.network.quotes, 41);
	});

	it("lists every solver that gave a quote, most first, with or without batches", () => {
		assert.deepEqual(
			details(week, "7d").quoters.map((q) => [q.id, q.figures.quotes]),
			[
				["a", 210],
				["b", 70],
				["c", 1],
			]
		);
	});

	it("has no figures without detail days", () => {
		const d = details(snapshot(0, week.solvers), "7d");
		assert.equal(d.coverage, 0);
		assert.equal(d.network.quotes, 0);
		assert.equal(d.network.filteredShare, null);
		assert.equal(d.network.protocolFeeRate, null);
		assert.deepEqual(d.quoters, []);
	});
});
