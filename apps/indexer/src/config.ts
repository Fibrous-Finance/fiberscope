import { fileURLToPath } from "node:url";

import { BASE } from "@fiberscope/core";

/** The network this indexer covers. */
export const NETWORK = BASE;

/** Blocks in one rolling day (Base produces a block exactly every 2 seconds). */
export const BLOCKS_PER_DAY = 86_400 / NETWORK.blockTime;

/** Blocks left between the indexed end and the chain head, as a margin against reorgs. */
export const CONFIRMATIONS = 20;

/** Widest block range the public Base RPC accepts for `eth_getLogs`. */
export const LOG_RANGE = 2_000;

/** Most calls one JSON-RPC batch may carry on the public Base RPC. */
export const RPC_BATCH_SIZE = 10;

/** Wrapped ether on Base. Buys of native ETH are priced with it. */
export const WETH = "0x4200000000000000000000000000000000000006";

/** CoW's placeholder address for native ETH as a buy token. */
export const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const DEFAULT_DB_PATH = fileURLToPath(new URL("../.data/base.db", import.meta.url));
export const DEFAULT_SNAPSHOT_PATH = fileURLToPath(
	new URL("../../web/data/snapshot.json", import.meta.url)
);

/** The R2 object every snapshot is uploaded to, through the Cloudflare API. */
export interface R2Target {
	accountId: string;
	bucket: string;
	key: string;
	/** A Cloudflare API token that can write to the bucket (Workers R2 Storage: Edit). */
	token: string;
}

export interface Env {
	/** The SQLite database (DB_PATH, default `apps/indexer/.data/base.db`). */
	dbPath: string;
	rpcUrl: string;
	/** Most RPC calls per second; every call in a batch counts. */
	rpcRps: number;
	/** Most CoW API requests per second. */
	cowApiRps: number;
	refreshMinutes: number;
	/** Where snapshots are uploaded besides the local file; null without SNAPSHOT_R2_BUCKET. */
	upload: R2Target | null;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): Env {
	return {
		dbPath: env.DB_PATH || DEFAULT_DB_PATH,
		rpcUrl: env.BASE_RPC_URL || "https://mainnet.base.org",
		rpcRps: positive(env, "BASE_RPC_RPS", 15),
		cowApiRps: positive(env, "COW_API_RPS", 3),
		refreshMinutes: positive(env, "REFRESH_MINUTES", 10),
		upload: r2Target(env),
	};
}

function r2Target(env: NodeJS.ProcessEnv): R2Target | null {
	const bucket = env.SNAPSHOT_R2_BUCKET;
	if (!bucket) return null;
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	const token = env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !token) {
		throw new Error("SNAPSHOT_R2_BUCKET needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
	}
	return { accountId, bucket, key: env.SNAPSHOT_R2_KEY || `${NETWORK.id}/snapshot.json`, token };
}

function positive(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive number, got "${raw}"`);
	}
	return value;
}

/** Unix seconds of a block. Base's block time is exact, so headers never need fetching. */
export function timeOf(block: number): number {
	return NETWORK.genesisTime + block * NETWORK.blockTime;
}
