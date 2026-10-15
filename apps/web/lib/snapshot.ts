import { cache } from "react";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { NetworkId, Snapshot } from "@fiberscope/core";

/**
 * A network's snapshot, as its indexer writes it: `<network>/snapshot.json`. With
 * `SNAPSHOT_SOURCE` "r2" (as on Cloudflare), the object of that key in the Worker's `SNAPSHOTS` R2
 * bucket; otherwise that file under `SNAPSHOT_DIR` (default `data` under the working directory).
 * A snapshot of another network is refused, as one of an unknown schema is.
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
		/** The bucket the indexers upload snapshots to (wrangler.jsonc `r2_buckets`). */
		SNAPSHOTS?: SnapshotBucket;
	}
}

/** Loaded once per request and network. */
export const loadSnapshot = cache(async (network: NetworkId): Promise<SnapshotResult> => {
	try {
		const snapshot = await read(network);
		if (snapshot.schema !== 1)
			throw new Error(`Unsupported snapshot schema ${snapshot.schema}`);
		if (snapshot.network !== network)
			throw new Error(`The ${network} snapshot holds ${snapshot.network}'s data`);
		return { ok: true, snapshot, at: Date.now() };
	} catch (error) {
		console.error(`Fiberscope: the ${network} snapshot could not be loaded.`, error);
		return { ok: false, at: Date.now() };
	}
});

async function read(network: NetworkId): Promise<Snapshot> {
	if (process.env.SNAPSHOT_SOURCE === "r2") {
		const key = `${network}/snapshot.json`;
		const { env } = await getCloudflareContext({ async: true });
		if (!env.SNAPSHOTS)
			throw new Error('SNAPSHOT_SOURCE is "r2" but the SNAPSHOTS binding is missing');
		const object = await env.SNAPSHOTS.get(key);
		if (!object) throw new Error(`The SNAPSHOTS bucket has no ${key}`);
		return object.json<Snapshot>();
	}
	// A local file is read at runtime and must not be traced into the build, which would copy
	// the whole project into the output.
	const dir = process.env.SNAPSHOT_DIR ?? join(process.cwd(), "data");
	const path = join(dir, network, "snapshot.json");
	return JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as Snapshot;
}
