import type { HeaderStatus } from "@/components/frame/Header";

import type { SnapshotResult } from "@/lib/snapshot";

const MINUTE = 60_000;
/**
 * The data is delayed once its newest block is more than 30 minutes old: three missed 10-minute
 * updates. Measured from the block, since an update can succeed and still be behind.
 */
const DELAYED_AFTER = 30 * MINUTE;
const DEFAULT_REFRESH_MINUTES = 10;

/**
 * How fresh the loaded data is at `now`, and when the page fetches it again: on the data's own
 * schedule while live, every minute while delayed or in error. Loading is the caller's to set
 * while it fetches.
 */
export function dataStatus(result: SnapshotResult, now: number): HeaderStatus {
	const snapshot = result.ok ? result.snapshot : null;
	const refreshMinutes = snapshot?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES;
	const dataTime = snapshot?.end.time ?? null;
	const state = dataTime === null ? "error" : now - dataTime > DELAYED_AFTER ? "delayed" : "live";
	return {
		state,
		now,
		dataTime,
		endBlock: snapshot?.end.block ?? null,
		refreshMinutes,
		failedAt: result.ok ? null : result.at,
		nextTryAt: result.at + (state === "live" ? refreshMinutes : 1) * MINUTE,
		lastRunAt: snapshot?.lastRunAt ?? null,
	};
}
