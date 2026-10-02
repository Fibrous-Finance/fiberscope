import type { HeaderStatus } from "@/components/frame/Header";

import type { SnapshotResult } from "@/lib/snapshot";

export const MINUTE = 60_000;
/** The data counts as delayed after three missed indexer runs (30 minutes at the usual pace). */
const STALE_AFTER_RUNS = 3;
const DEFAULT_REFRESH_MINUTES = 10;

/** How fresh the loaded data is at `now`. Loading is the caller's to set while it reloads. */
export function dataStatus(result: SnapshotResult, now: number): HeaderStatus {
	const snapshot = result.ok ? result.snapshot : null;
	const refreshMinutes = snapshot?.refreshMinutes ?? DEFAULT_REFRESH_MINUTES;
	const lastRunAt = snapshot?.lastRunAt ?? null;
	const late = lastRunAt === null ? 0 : now - lastRunAt;
	return {
		state: !snapshot
			? "error"
			: late > STALE_AFTER_RUNS * refreshMinutes * MINUTE
				? "stale"
				: "live",
		lastRunAt,
		endBlock: snapshot?.end.block ?? null,
		refreshMinutes,
		delayMinutes: Math.max(0, Math.floor(late / MINUTE)),
		attemptedAt: result.ok ? null : result.at,
	};
}
