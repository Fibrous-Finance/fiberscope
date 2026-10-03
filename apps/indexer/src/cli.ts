import { mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_DB_PATH, DEFAULT_SNAPSHOT_PATH, type Env, NETWORK, readEnv } from "./config.ts";
import { CowApi } from "./cow.ts";
import { duration, fmt, log } from "./log.ts";
import { OVERRIDES } from "./overrides.ts";
import { Registry } from "./registry.ts";
import { Rpc } from "./rpc.ts";
import { seedDatabase } from "./seed.ts";
import { buildSnapshot } from "./snapshot.ts";
import { Store } from "./store.ts";
import { resolveSymbols } from "./symbols.ts";
import { sync } from "./sync.ts";
import { uploadSnapshot } from "./upload.ts";
import { windowReport } from "./window.ts";

const USAGE = `Usage:
  node src/cli.ts sync [--chain-days N] [--auction-days M] [--budget-minutes B] [--snapshot <path>]
      Catch up with the chain head, then backfill at least N days of chain data and M days of
      auction data. Resumable and idempotent: a re-run fetches only what is missing. With
      --budget-minutes the backfill stops B minutes after the start and the next run resumes it.
      With --snapshot the snapshot is written once the head is caught up, and again if the
      backfill added history (on an empty database, only after the backfill).
  node src/cli.ts snapshot [--out <path>]
      Write the snapshot JSON (default ${relative(process.cwd(), DEFAULT_SNAPSHOT_PATH)}).
  node src/cli.ts window --from <block> --to <block>
      Print totals and the per-solver table for a block range, from the database.
  node src/cli.ts seed --url <url>
      Download a database from <url> when there is none yet, e.g. to move the indexer to a new
      host without indexing again. It is integrity-checked before it is used.

Every command takes --db <path> (default DB_PATH, else ${relative(process.cwd(), DEFAULT_DB_PATH)}).
Environment: BASE_RPC_URL, BASE_RPC_RPS, COW_API_RPS, REFRESH_MINUTES. With SNAPSHOT_R2_BUCKET
(plus CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and optionally SNAPSHOT_R2_KEY,
default ${NETWORK.id}/snapshot.json) every snapshot written is also uploaded to that R2 bucket.
`;

async function main(): Promise<void> {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			"chain-days": { type: "string" },
			"auction-days": { type: "string" },
			"budget-minutes": { type: "string" },
			snapshot: { type: "string" },
			out: { type: "string" },
			from: { type: "string" },
			to: { type: "string" },
			db: { type: "string" },
			url: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command] = positionals;
	if (values.help || positionals.length !== 1) {
		process.stdout.write(USAGE);
		if (!values.help) process.exitCode = 2;
		return;
	}
	const env = readEnv();
	const dbPath = values.db ?? env.dbPath;
	if (command === "seed") {
		if (values.url === undefined) throw new Error("seed needs --url <url>");
		const started = performance.now();
		const bytes = await seedDatabase(values.url, dbPath);
		log(
			`seed: ${dbPath} (${fmt(bytes / 1e6, 1)} MB) in ${duration((performance.now() - started) / 1000)}`
		);
		return;
	}
	const store = new Store(dbPath);
	try {
		if (command === "sync") {
			const budget = values["budget-minutes"];
			const snapshotPath = values.snapshot;
			const rpc = new Rpc(env.rpcUrl, env.rpcRps);
			const cow = new CowApi(NETWORK.cowApi, env.cowApiRps);
			const options = {
				chainDays: wholeNumber(values["chain-days"], "chain-days", 0),
				auctionDays: wholeNumber(values["auction-days"], "auction-days", 0),
				budgetMinutes:
					budget === undefined ? null : wholeNumber(budget, "budget-minutes", null),
				writeSnapshot:
					snapshotPath === undefined
						? null
						: () => writeSnapshot(store, rpc, env, snapshotPath),
			};
			const started = performance.now();
			const stats = await sync(store, rpc, cow, options);
			const chain = store.chainRange()!;
			const auctions = store.auctionRange();
			const { receipts, seconds: chainSeconds } = stats.chain;
			const { lookups, missing, seconds: auctionSeconds } = stats.auctions;
			log(`sync: done in ${duration((performance.now() - started) / 1000)}`);
			log(
				`  chain ${chain.from}..${chain.to}: ${fmt(receipts)} receipts in ${duration(chainSeconds)} ` +
					`(${rate(receipts, chainSeconds)}/s); ${fmt(rpc.stats.calls)} RPC calls, ` +
					`${fmt(rpc.stats.retries)} retried requests`
			);
			log(
				`  auctions ${auctions ? `${auctions.from}..${auctions.to}` : "none"}: ${fmt(lookups)} lookups ` +
					`(${fmt(missing)} not found) in ${duration(auctionSeconds)} ` +
					`(${rate(lookups, auctionSeconds)}/s), ${fmt(cow.stats.bytes / 1e6)} MB uncompressed, ` +
					`${fmt(cow.stats.retries)} retries`
			);
			store.checkpoint();
			log(`  database ${dbPath}: ${fmt(statSync(dbPath).size / 1e6, 1)} MB`);
		} else if (command === "snapshot") {
			const rpc = new Rpc(env.rpcUrl, env.rpcRps);
			await writeSnapshot(store, rpc, env, values.out ?? DEFAULT_SNAPSHOT_PATH);
		} else if (command === "window") {
			const from = wholeNumber(values.from, "from", null);
			const to = wholeNumber(values.to, "to", null);
			if (from > to) throw new Error("--from must not be after --to");
			const registry = new Registry(store.cmsEntries(), OVERRIDES);
			process.stdout.write(windowReport(store, registry, { from, to }));
		} else {
			throw new Error(`unknown command "${command}"\n\n${USAGE}`);
		}
	} finally {
		store.close();
	}
}

/**
 * Builds the snapshot and writes it to `out` atomically: to a temporary file in the same
 * directory, then renamed over `out`, so a reader never sees half a file. Then uploads it, when
 * R2 is configured; a failed upload is logged and sets the exit code without stopping the run.
 */
async function writeSnapshot(store: Store, rpc: Rpc, env: Env, out: string): Promise<void> {
	const started = performance.now();
	const { snapshot, stats } = await buildSnapshot({
		store,
		registry: new Registry(store.cmsEntries(), OVERRIDES),
		refreshMinutes: env.refreshMinutes,
		symbols: (tokens) => resolveSymbols(rpc, store, tokens),
	});
	const json = JSON.stringify(snapshot);
	mkdirSync(dirname(out), { recursive: true });
	const temporary = `${out}.${process.pid}.tmp`;
	writeFileSync(temporary, json);
	renameSync(temporary, out);
	const { chainDays, auctionDays } = snapshot.coverage;
	const seconds = (performance.now() - started) / 1000;
	log(
		`snapshot: ${out} (${fmt(json.length / 1024)} KB) in ${duration(seconds)}, ` +
			`end block ${snapshot.end.block}, ${chainDays} chain days, ${auctionDays} auction days, ` +
			`${snapshot.solvers.length} solvers`
	);
	log(
		`  trades in the auction days: ${fmt(stats.trades)}, ${fmt(stats.unpriced)} unpriced, ` +
			`${fmt(stats.oneSided)} priced on one side only`
	);
	if (env.upload) {
		const { bucket, key } = env.upload;
		const uploadStarted = performance.now();
		try {
			await uploadSnapshot(env.upload, json);
			log(
				`  uploaded to R2 ${bucket}/${key} in ${duration((performance.now() - uploadStarted) / 1000)}`
			);
		} catch (error) {
			process.exitCode = 1;
			process.stderr.write(
				`  upload to R2 ${bucket}/${key} failed: ${error instanceof Error ? error.message : error}\n`
			);
		}
	}
}

function wholeNumber(value: string | undefined, name: string, fallback: number | null): number {
	if (value === undefined) {
		if (fallback === null) throw new Error(`--${name} is required`);
		return fallback;
	}
	if (!/^\d+$/.test(value)) throw new Error(`--${name} must be a whole number, got "${value}"`);
	return Number(value);
}

function rate(count: number, seconds: number): string {
	return seconds > 0 ? (count / seconds).toFixed(2) : "0";
}

main().catch((error: unknown) => {
	process.stderr.write(
		`error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
	);
	process.exit(1);
});
