import { cache } from "react";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Snapshot } from "@fiberscope/core";

/**
 * The snapshot the indexer writes. In production it is fetched from `SNAPSHOT_URL` and cached for
 * a minute; locally it is read from `SNAPSHOT_PATH` (default `data/snapshot.json`).
 *
 * `at` is when this request loaded (or failed to load) it: the page's notion of "now" for the
 * stale check, fixed for the whole render.
 */
export type SnapshotResult =
	{ ok: true; snapshot: Snapshot; at: number } | { ok: false; at: number };

const REVALIDATE_SECONDS = 60;

export const loadSnapshot = cache(async (): Promise<SnapshotResult> => {
	try {
		const snapshot = await read();
		if (snapshot.schema !== 1)
			throw new Error(`Unsupported snapshot schema ${snapshot.schema}`);
		return { ok: true, snapshot, at: Date.now() };
	} catch (error) {
		console.error("Fiberscope: the snapshot could not be loaded.", error);
		return { ok: false, at: Date.now() };
	}
});

async function read(): Promise<Snapshot> {
	const url = process.env.SNAPSHOT_URL;
	if (url) {
		const response = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		return (await response.json()) as Snapshot;
	}
	// Local development only (production fetches SNAPSHOT_URL): the file is read at runtime and
	// must not be traced into the build, which would copy the whole project into the output.
	const path = process.env.SNAPSHOT_PATH ?? join(process.cwd(), "data", "snapshot.json");
	return JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as Snapshot;
}
