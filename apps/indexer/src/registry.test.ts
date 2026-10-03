import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCmsPage, Registry } from "./registry.ts";
import type { CmsPage, RegistryEntry } from "./registry.ts";

interface CmsItem {
	address: string;
	chainId: number;
	env: string;
	active: boolean;
	solverId?: string;
	name?: string;
}

function page(items: CmsItem[]): CmsPage {
	return {
		data: items.map((item) => ({
			attributes: {
				address: item.address,
				active: item.active,
				network: { data: { attributes: { chainId: item.chainId } } },
				environment: { data: { attributes: { name: item.env } } },
				solver: item.solverId
					? { data: { attributes: { solverId: item.solverId, displayName: item.name } } }
					: { data: null },
			},
		})),
	};
}

describe("CMS parsing", () => {
	test("keeps entries of the chain that name a solver and a prod or barn environment", () => {
		const entries = parseCmsPage(
			page([
				{
					address: "0xAAAA",
					chainId: 8453,
					env: "prod",
					active: true,
					solverId: "arc",
					name: "Arc",
				},
				{
					address: "0xbbbb",
					chainId: 1,
					env: "prod",
					active: true,
					solverId: "arc",
					name: "Arc",
				},
				{
					address: "0xcccc",
					chainId: 8453,
					env: "staging",
					active: true,
					solverId: "arc",
					name: "Arc",
				},
				{ address: "0xdddd", chainId: 8453, env: "barn", active: false },
			]),
			8453
		);
		assert.deepEqual(entries, [
			{ address: "0xaaaa", env: "prod", active: true, solverId: "arc", name: "Arc" },
		]);
	});
});

describe("registry merge", () => {
	const sectorBarn: RegistryEntry = {
		address: "0x5c35",
		env: "barn",
		active: false,
		solverId: "sector",
		name: "Sector Finance",
	};
	const sectorProd: RegistryEntry = { ...sectorBarn, env: "prod", active: true };
	const rizzolverOld: RegistryEntry = {
		address: "0x4dd1",
		env: "prod",
		active: false,
		solverId: "rizzolver",
		name: "Rizzolver",
	};
	const rizzolverBarn: RegistryEntry = { ...rizzolverOld, address: "0x707d", env: "barn" };
	const rizzolverNew: RegistryEntry = { ...rizzolverOld, address: "0x8f58", active: true };

	test("an address the CMS lists twice resolves to its active entry", () => {
		for (const cms of [
			[sectorBarn, sectorProd],
			[sectorProd, sectorBarn],
		]) {
			const registry = new Registry(cms, []);
			assert.deepEqual(registry.addresses("sector"), [sectorProd]);
		}
	});

	test("overrides add addresses the CMS lacks to the CMS solver", () => {
		const registry = new Registry([rizzolverOld, rizzolverBarn], [rizzolverNew]);
		for (const address of ["0x4dd1", "0x707d", "0x8f58"]) {
			assert.deepEqual(registry.identify(address), { id: "rizzolver", name: "Rizzolver" });
		}
		assert.equal(registry.addresses("rizzolver").length, 3);
	});

	test("overrides win over the CMS entry for the same address", () => {
		const renamed: RegistryEntry = { ...sectorProd, solverId: "sector-v2", name: "Sector v2" };
		const registry = new Registry([sectorProd], [renamed]);
		assert.deepEqual(registry.identify("0x5c35"), { id: "sector-v2", name: "Sector v2" });
		assert.deepEqual(registry.addresses("sector"), []);
	});

	test("lists every solver with one entry per environment and address", () => {
		// The CMS lists Sector's address for prod twice, retired and active, and for barn.
		const sectorRetired: RegistryEntry = { ...sectorProd, active: false };
		const registry = new Registry(
			[sectorRetired, sectorBarn, sectorProd, rizzolverOld],
			[rizzolverNew]
		);
		assert.deepEqual(
			new Map(registry.solvers().map(({ id, entries }) => [id, new Set(entries)])),
			new Map([
				["sector", new Set([sectorProd, sectorBarn])],
				["rizzolver", new Set([rizzolverOld, rizzolverNew])],
			])
		);
	});

	test("an override replaces every CMS entry of its address in the listing", () => {
		const renamed: RegistryEntry = { ...sectorProd, solverId: "sector-v2", name: "Sector v2" };
		const registry = new Registry([sectorProd, sectorBarn], [renamed]);
		assert.deepEqual(registry.solvers(), [
			{ id: "sector-v2", name: "Sector v2", entries: [renamed] },
		]);
	});

	test("an unregistered address is its own id, without a name", () => {
		const registry = new Registry([sectorProd], []);
		assert.equal(registry.has("0x9999"), false);
		assert.deepEqual(registry.identify("0x9999"), { id: "0x9999", name: null });
	});
});
