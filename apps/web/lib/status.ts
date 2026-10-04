import type { HeaderStatus } from "@/components/frame/Header";

import type { SnapshotResult } from "@/lib/snapshot";

const MINUTE = 60_000;
/**
 * The data is delayed once its newest block is more than 30 minutes old (three missed updates at
 * the default 10-minute interval), whatever the interval. Measured from the block, since an
 * update can succeed and still be behind.
 */
const DELAYED_AFTER = 30 * MINUTE;
const DEFAULT_REFRESH_MINUTES = 10;
/**
 * The indexer starts a run every `refreshMinutes` and uploads its first snapshot within about half a
 * minute of catching up (`lastRunAt`): the page asks a minute after the next one is due.
 */
const UPLOAD_MARGIN = MINUTE;

/**
 * How fresh the loaded data is at `now`, and when the page fetches it again: `nextTryAt`, on the
 * server's clock like `result.at`. While live, a minute after the indexer's next run should have
 * uploaded, and never sooner than a minute after this load, so a late upload is asked for every
 * minute; one minute after this load while delayed or in error. Loading is the caller's to set
 * while it fetches.
 */
export function dataStatus(result: SnapshotResult, now: number): HeaderStatus {
	const snapshot = result.ok ? result.snapshot : null;
	const refreshMinutes = snapshot?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES;
	const dataTime = snapshot?.end.time ?? null;
	const state = dataTime === null ? "error" : now - dataTime > DELAYED_AFTER ? "delayed" : "live";
	const soonest = result.at + MINUTE;
	// `lastRunAt` precedes this load, so the next upload is due within one interval of it.
	const latest = result.at + refreshMinutes * MINUTE + UPLOAD_MARGIN;
	const due = (snapshot?.lastRunAt ?? result.at) + refreshMinutes * MINUTE + UPLOAD_MARGIN;
	return {
		state,
		now,
		dataTime,
		endBlock: snapshot?.end.block ?? null,
		refreshMinutes,
		failedAt: result.ok ? null : result.at,
		nextTryAt: state === "live" ? Math.min(Math.max(due, soonest), latest) : soonest,
	};
}
