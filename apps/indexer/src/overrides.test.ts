import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { OVERRIDES } from "./overrides.ts";

describe("overrides", () => {
	test("on Base, add Rizzolver's address alone", () => {
		assert.deepEqual(OVERRIDES, [
			{
				address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
				env: "prod",
				active: true,
				solverId: "rizzolver",
				name: "Rizzolver",
			},
		]);
	});
});
