import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toggledAppearance } from "./theme.ts";

describe("toggledAppearance", () => {
	it("pins the other theme when it differs from the system's", () => {
		assert.equal(toggledAppearance("light", "light"), "dark");
		assert.equal(toggledAppearance("dark", "dark"), "light");
	});

	it("returns to Auto instead of pinning the system's theme", () => {
		assert.equal(toggledAppearance("dark", "light"), "auto");
		assert.equal(toggledAppearance("light", "dark"), "auto");
	});
});
