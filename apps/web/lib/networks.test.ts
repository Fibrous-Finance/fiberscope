import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFormat } from "@fiberscope/core";

import { menuNetworks, overridesText, SITE_NETWORKS } from "./networks.ts";

const { base, bnb } = SITE_NETWORKS;
const ids = (networks: readonly { id: string }[]) => networks.map((network) => network.id);

describe("menuNetworks", () => {
	it("lists an unlisted network on its own page only", () => {
		const networks = [base, { ...bnb, listed: false }];
		assert.deepEqual(ids(menuNetworks("base", networks)), ["base"]);
		assert.deepEqual(ids(menuNetworks("bnb", networks)), ["base", "bnb"]);
		// The 404 page, which has no network.
		assert.deepEqual(ids(menuNetworks(undefined, networks)), ["base"]);
	});

	it("lists a listed network on every page, in the same order", () => {
		const networks = [base, { ...bnb, listed: true }];
		for (const current of ["base", "bnb", undefined] as const) {
			assert.deepEqual(ids(menuNetworks(current, networks)), ["base", "bnb"]);
		}
	});
});

describe("overridesText", () => {
	const { list } = createFormat("en");
	const possessive = (name: string) => `${name}’s`;
	const rizzolver = {
		address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
		solverId: "rizzolver",
		name: "Rizzolver",
	};
	const fractal = {
		address: "0x95480d3f27658e73b2785d30beb0c847d78294c7",
		solverId: "fractal",
		name: "Fractal",
	};
	const nexroute = {
		address: "0x0123456789abcdef0123456789abcdef01234567",
		solverId: "nexroute",
		name: "Nexroute",
	};

	it("names each address with its solver, joined as the page's lists are", () => {
		assert.equal(overridesText([rizzolver], list, possessive), "Rizzolver’s 0x8f58…5cb7");
		assert.equal(
			overridesText([rizzolver, fractal], list, possessive),
			"Rizzolver’s 0x8f58…5cb7 and Fractal’s 0x9548…94c7"
		);
		assert.equal(
			overridesText([rizzolver, fractal, nexroute], list, possessive),
			"Rizzolver’s 0x8f58…5cb7, Fractal’s 0x9548…94c7 and Nexroute’s 0x0123…4567"
		);
	});
});
