import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CreditedSettlement, Snapshot, SnapshotSolver } from "../snapshot.ts";
import { latestSettlements } from "./settlements.ts";

const END = Date.UTC(2026, 9, 3, 9, 49);
const UNNAMED = "0x5c35f1a4e9b0d27c8e3f6a1b9d0c4e7f2a8bfce1";
const UNNAMED_PROD = "0x588ef3de5b6bcd4f4e1bc4e5ad3ac4dbf5e665e3";
const UNLISTED = "0x09e5a7c3d1f2b8e4a6c0d9f7b3e1a5c2d8f404ef";

function solver(
	id: string,
	name: string | null,
	addresses: SnapshotSolver["addresses"]
): SnapshotSolver {
	return {
		id,
		name,
		addresses,
		batches: [],
		trades: [],
		swaps: [],
		gas: [],
		volume: [],
		entered: [],
		won: [],
		latestSettlements: [],
	};
}

function settled(solver: string, secondsAgo: number, volume: number | null): CreditedSettlement {
	return {
		solver,
		tx: `0x${secondsAgo.toString(16).padStart(64, "0")}`,
		block: 52_115_823 - Math.floor(secondsAgo / 2),
		time: END - secondsAgo * 1000,
		trades: 2,
		swaps: 3,
		pair: { sell: "USDC", buy: "WETH" },
		volume,
		gas: 434_710,
	};
}

function snapshot(solvers: SnapshotSolver[], latest: CreditedSettlement[]): Snapshot {
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_115_823, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays: 1, auctionDays: 1 },
		auctions: { count: [100], solutions: [900] },
		solvers,
		latestAuctions: [],
		latestSettlements: latest,
		registry: [],
	};
}

describe("latestSettlements", () => {
	it("names each solver as the rest of the page does, by address when it has no name", () => {
		const s = snapshot(
			[
				solver("nexroute", "Nexroute", [
					{ env: "prod", address: "0x1111111111111111111111111111111111111111" },
				]),
				// Unnamed: shown by its prod address, even when barn is listed first.
				solver(UNNAMED, null, [
					{ env: "barn", address: UNNAMED },
					{ env: "prod", address: UNNAMED_PROD },
				]),
			],
			[settled("nexroute", 26, 26.98), settled(UNNAMED, 120, 0.19), settled(UNLISTED, 300, 5)]
		);
		assert.deepEqual(
			latestSettlements(s).map((x) => x.solver),
			[
				{ id: "nexroute", label: "Nexroute", unnamed: false },
				{ id: UNNAMED, label: "0x588e…65e3", unnamed: true },
				// A solver the snapshot does not list falls back to its own id.
				{ id: UNLISTED, label: "0x09e5…04ef", unnamed: true },
			]
		);
	});

	it("keeps the snapshot's newest-first order and unpriced settlements", () => {
		const s = snapshot(
			[solver("arc", "Arc", [])],
			[settled("arc", 10, null), settled("arc", 11, 919.4), settled("arc", 95, 827.23)]
		);
		const rows = latestSettlements(s);
		assert.deepEqual(
			rows.map((x) => [END - x.time, x.volume]),
			[
				[10_000, null],
				[11_000, 919.4],
				[95_000, 827.23],
			]
		);
		// Everything but the solver passes through unchanged.
		assert.deepEqual({ ...rows[2], solver: "arc" }, settled("arc", 95, 827.23));
	});
});
