import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RegisteredAddress, RegisteredSolver, Snapshot } from "../snapshot.ts";
import { buildRegistry, registrationOf } from "./registry.ts";
import { DAY_MS } from "./view.ts";

const END = Date.UTC(2026, 9, 3, 9, 49, 53);
const CHAIN_DAYS = 83;
const SINCE = END - CHAIN_DAYS * DAY_MS;

function registered(
	id: string,
	lastSettlement: number | null,
	addresses: RegisteredAddress[] = [],
	active = true
): RegisteredSolver {
	return {
		id,
		name: id.toUpperCase(),
		active,
		addresses,
		lastSettlement:
			lastSettlement === null ? null : { tx: `0x${id}`, block: 1, time: lastSettlement },
		batches: lastSettlement === null ? 0 : 1,
	};
}

function snapshot(registry: RegisteredSolver[]): Snapshot {
	return {
		schema: 1,
		network: "base",
		builtAt: END,
		end: { block: 52_115_823, time: END },
		lastRunAt: END,
		refreshMinutes: 10,
		coverage: { chainDays: CHAIN_DAYS, auctionDays: 7 },
		auctions: { count: [], solutions: [] },
		solvers: [],
		latestAuctions: [],
		latestSettlements: [],
		registry,
	};
}

const address = (env: "prod" | "barn", n: number, active: boolean): RegisteredAddress => ({
	env,
	address: `0x${String(n).padStart(40, "0")}`,
	active,
});

describe("buildRegistry", () => {
	it("checks each last settlement against the whole settlement history", () => {
		const s = snapshot([
			registered("recent", END - 3_600_000),
			registered("edge", SINCE),
			registered("inside", SINCE + 1),
			registered("never", null),
			registered("retired", null, [], false),
		]);
		const r = buildRegistry(s);
		assert.equal(r.since, SINCE);
		assert.equal(r.total, 5);
		// The history's oldest day starts after `since`: a settlement exactly then is not in it.
		assert.deepEqual(
			r.settled.map((x) => x.id),
			["recent", "inside"]
		);
		assert.deepEqual(
			r.unsettled.map((x) => x.id),
			["edge", "never", "retired"]
		);
	});
});

describe("registrationOf", () => {
	it("lists current addresses first, prod before barn, then the retired ones", () => {
		const registry = [
			registered("a", END, [
				address("prod", 1, true),
				address("prod", 2, false),
				address("barn", 3, true),
				address("barn", 4, false),
			]),
		];
		const r = registrationOf(registry, { id: "a", addresses: [] });
		assert.equal(r.active, true);
		assert.deepEqual(
			r.addresses.map((a) => [a.env, a.address.slice(-1), a.active]),
			[
				["prod", "1", true],
				["barn", "3", true],
				["prod", "2", false],
				["barn", "4", false],
			]
		);
	});

	it("keeps the submission addresses of a solver the registry does not list", () => {
		const registry = [registered("a", END, [address("prod", 1, false)], false)];
		assert.equal(registrationOf(registry, { id: "a", addresses: [] }).active, false);
		const unlisted = registrationOf(registry, {
			id: "0xabc",
			addresses: [{ env: "prod", address: "0xabc" }],
		});
		assert.equal(unlisted.active, null);
		assert.deepEqual(unlisted.addresses, [{ env: "prod", address: "0xabc", active: true }]);
	});
});
