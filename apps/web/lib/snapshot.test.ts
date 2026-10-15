import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { loadSnapshot } from "./snapshot.ts";

describe("loadSnapshot", () => {
	let dir = "";

	before(async () => {
		dir = await mkdtemp(join(tmpdir(), "fiberscope-snapshots-"));
		process.env.SNAPSHOT_DIR = dir;
		// bnb/ holds Base's snapshot, as a misplaced copy would.
		for (const folder of ["base", "bnb"]) {
			await mkdir(join(dir, folder));
			await writeFile(
				join(dir, folder, "snapshot.json"),
				JSON.stringify({ schema: 1, network: "base" })
			);
		}
	});

	after(async () => {
		delete process.env.SNAPSHOT_DIR;
		await rm(dir, { recursive: true });
	});

	it("reads the network's snapshot from SNAPSHOT_DIR/<network>/snapshot.json", async () => {
		const result = await loadSnapshot("base");
		assert.equal(result.ok && result.snapshot.network, "base");
	});

	it("refuses a snapshot of another network", async (t) => {
		const error = t.mock.method(console, "error", () => {});
		const result = await loadSnapshot("bnb");
		assert.equal(result.ok, false);
		assert.equal(error.mock.callCount(), 1);
	});
});
