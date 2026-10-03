import { cache } from "react";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Snapshot } from "@fiberscope/core";

/**
 * The snapshot the indexer writes. With `SNAPSHOT_R2_KEY` set (as on Cloudflare), the object of
 * that key in the Worker's `SNAPSHOTS` R2 bucket; otherwise the file `SNAPSHOT_PATH` (default
 * `data/snapshot.json` under the working directory).
 *
 * `at` is when this request loaded (or failed to load) it: the page's notion of "now" for the
 * stale check, fixed for the whole render.
 */
export type SnapshotResult =
	{ ok: true; snapshot: Snapshot; at: number } | { ok: false; at: number };

/** The part of an R2 bucket binding the loader uses. */
interface SnapshotBucket {
	get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
}

declare global {
	interface CloudflareEnv {
		/** The bucket the indexer uploads snapshots to (wrangler.jsonc `r2_buckets`). */
		SNAPSHOTS?: SnapshotBucket;
	}
}

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
	const key = process.env.SNAPSHOT_R2_KEY;
	if (key) {
		const { env } = await getCloudflareContext({ async: true });
		if (!env.SNAPSHOTS)
			throw new Error("SNAPSHOT_R2_KEY is set but the SNAPSHOTS binding is missing");
		const object = await env.SNAPSHOTS.get(key);
		if (!object) throw new Error(`The SNAPSHOTS bucket has no ${key}`);
		return object.json<Snapshot>();
	}
	// Without SNAPSHOT_R2_KEY: the file is read at runtime and must not be traced into the build,
	// which would copy the whole project into the output.
	const path = process.env.SNAPSHOT_PATH ?? join(process.cwd(), "data", "snapshot.json");
	return JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as Snapshot;
}
