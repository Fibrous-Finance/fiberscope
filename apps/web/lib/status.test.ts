import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Snapshot } from "@fiberscope/core";

import type { LoadedSnapshot, SnapshotResult } from "./snapshot.ts";
import { dataStatus } from "./status.ts";

const MINUTE = 60_000;
const T = Date.UTC(2026, 9, 15, 12, 0);

/** A load at `at` of data whose newest block was mined at `time`, by a run that began at `lastRunAt`. */
function loaded(at: number, time: number, lastRunAt = time): LoadedSnapshot {
	const snapshot = { refreshMinutes: 10, end: { block: 100, time }, lastRunAt } as Snapshot;
	return { ok: true, snapshot, at };
}

describe("dataStatus", () => {
	it("is live a minute after the next upload is due when the load succeeded", () => {
		const result = loaded(T, T - 2 * MINUTE, T - 2 * MINUTE);
		const status = dataStatus(result, T);
		assert.equal(status.state, "live");
		assert.equal(status.dataTime, T - 2 * MINUTE);
		assert.equal(status.failedAt, null);
		// lastRunAt + 10 minutes + the upload margin.
		assert.equal(status.nextTryAt, T + 9 * MINUTE);
	});

	it("keeps the last data live after a failed load, and asks again in a minute", () => {
		const kept = loaded(T - 9 * MINUTE, T - 12 * MINUTE);
		const failed: SnapshotResult = { ok: false, at: T };
		const status = dataStatus(failed, T, kept);
		assert.equal(status.state, "live");
		assert.equal(status.dataTime, T - 12 * MINUTE);
		assert.equal(status.endBlock, 100);
		assert.equal(status.failedAt, T);
		assert.equal(status.nextTryAt, T + MINUTE);
	});

	it("shows the kept data as delayed once it is more than 30 minutes old", () => {
		const kept = loaded(T - 25 * MINUTE, T - 31 * MINUTE);
		const failed: SnapshotResult = { ok: false, at: T };
		const status = dataStatus(failed, T, kept);
		assert.equal(status.state, "delayed");
		assert.equal(status.dataTime, T - 31 * MINUTE);
		assert.equal(status.nextTryAt, T + MINUTE);
	});

	it("is in error after a failed load with no data kept", () => {
		const failed: SnapshotResult = { ok: false, at: T };
		const status = dataStatus(failed, T);
		assert.equal(status.state, "error");
		assert.equal(status.dataTime, null);
		assert.equal(status.endBlock, null);
		assert.equal(status.failedAt, T);
		assert.equal(status.nextTryAt, T + MINUTE);
	});
});
