import { setTimeout as sleep } from "node:timers/promises";

import { backfillAuctions, catchUpAuctions, resolveRouterSenders } from "./auctions.ts";
import type { AuctionStats, ChainWatch } from "./auctions.ts";
import { CONFIRMATIONS, NETWORK } from "./config.ts";
import type { CowApi } from "./cow.ts";
import {
	backfillChain,
	backfillTerms,
	catchUpChain,
	repairRouterRecipients,
	seedEthUsd,
} from "./ingest.ts";
import type { IngestStats, TermsStats } from "./ingest.ts";
import { log } from "./log.ts";
import { OVERRIDES } from "./overrides.ts";
import { describeError } from "./pacer.ts";
import { fetchCmsEntries, Registry } from "./registry.ts";
import type { Rpc } from "./rpc.ts";
import { windowStart } from "./rules.ts";
import type { Store } from "./store.ts";

export interface SyncOptions {
	/** Days of chain history to hold at least. */
	chainDays: number;
	/** Days of auction history to hold at least; chain history is extended to match. */
	auctionDays: number;
	/** Minutes after the start of the sync at which the backfill stops; null for no limit. */
	budgetMinutes: number | null;
	/**
	 * Writes the snapshot, once the data is current and again when the backfill adds history (on an
	 * empty database, only after the backfill).
	 */
	writeSnapshot: (() => Promise<void>) | null;
}

export interface SyncStats {
	chain: IngestStats;
	auctions: AuctionStats;
	terms: TermsStats;
}

/** Blocks the end may trail the head after a catch-up round before another round runs (5 min). */
const CATCH_UP_SLACK = 150;

/**
 * Brings the database up to date. Router transactions stored without their recipient are
 * repaired first. Then chain and auction data catch up with the chain head, which makes the data
 * current (the last run time) and is when the snapshot is written. Then chain and auction history
 * are backfilled to the requested depths, and the order terms of trades stored before terms were
 * kept are read, within the budget if there is one; the snapshot is written again if history
 * grew. Every step resumes where an interrupted or stopped run left off.
 */
export async function sync(
	store: Store,
	rpc: Rpc,
	cow: CowApi,
	options: SyncOptions
): Promise<SyncStats> {
	const { budgetMinutes, writeSnapshot } = options;
	const budget = budgetMinutes === null ? null : AbortSignal.timeout(budgetMinutes * 60_000);
	const registry = await refreshRegistry(store);
	const chainDays = Math.max(options.chainDays, options.auctionDays);
	if (store.chainRange() === null && chainDays === 0) {
		throw new Error("The database is empty: pass --chain-days to backfill");
	}
	const stats: SyncStats = {
		chain: { ranges: 0, receipts: 0, seconds: 0 },
		auctions: { txs: 0, lookups: 0, missing: 0, seconds: 0 },
		terms: { txs: 0, trades: 0, read: 0, seconds: 0 },
	};
	await repairRouterRecipients(store, rpc);
	await seedEthUsd(store, rpc);

	// Catch up: chain data to the head, then the auctions of the new blocks. A long pause since
	// the last run leaves the head far behind, so this repeats, at most three times, until the end
	// is within CATCH_UP_SLACK blocks of the head.
	// An empty database has nothing to catch up: its backfill starts at the head.
	const empty = store.chainRange() === null;
	if (!empty) {
		for (let round = 0; round < 3; round++) {
			await catchUpChain(store, rpc, await safeHead(rpc), stats.chain);
			await catchUpAuctions(store, cow, stats.auctions);
			if ((await safeHead(rpc)) - store.chainRange()!.to <= CATCH_UP_SLACK) break;
		}
		await resolveRouterSenders(store, cow, registry, stats.auctions);
		store.setLastRunAt(Date.now());
		await writeSnapshot?.();
	}

	// Backfill. The chain runs newest first and the auction backfill trails it, so the RPC and
	// the CoW API rate limits are spent at the same time, and the chain reaches the auction depth
	// before it goes deeper: auction history never waits for the full chain depth.
	const head = empty ? await safeHead(rpc) : store.chainRange()!.to;
	const history = () =>
		[store.chainRange()?.from, store.auctionRange()?.from, store.newestTxWithoutTerms()].join();
	const historyBefore = history();
	const chain: ChainWatch = { done: false };
	const abort = new AbortController();
	const stop = budget === null ? abort.signal : AbortSignal.any([abort.signal, budget]);
	const chainWork = (async () => {
		try {
			if (chainDays > 0) {
				const low = windowStart(head, chainDays);
				await backfillChain(store, rpc, low, head, stats.chain, budget ?? undefined);
			}
		} catch (error) {
			abort.abort(error);
			throw error;
		} finally {
			chain.done = true;
		}
	})();
	const auctionWork = (async () => {
		if (options.auctionDays > 0) {
			const low = windowStart(head, options.auctionDays);
			await backfillAuctions(store, cow, low, chain, stats.auctions, stop);
		}
		// Once the auction backfill is done, the CoW API's rate allowance is idle while the chain
		// backfill runs on: spend it on the router settlements whose attribution needs the API's
		// winner, as their blocks arrive.
		while (!chain.done) {
			await resolveRouterSenders(store, cow, registry, stats.auctions, stop);
			for (let waited = 0; waited < 20 && !chain.done; waited++) await sleep(500);
		}
	})();
	// The RPC budget the chain backfill leaves goes to the terms of the trades stored without them.
	const termsWork = backfillTerms(store, rpc, stats.terms, stop);
	const [chainDone, auctionsDone, termsDone] = await Promise.allSettled([
		chainWork,
		auctionWork,
		termsWork,
	]);
	if (chainDone.status === "rejected") throw chainDone.reason;
	if (auctionsDone.status === "rejected") throw auctionsDone.reason;
	if (termsDone.status === "rejected") throw termsDone.reason;
	if (budget?.aborted) {
		log(`sync: the ${budgetMinutes}-minute budget is spent; the next run resumes the backfill`);
	}
	await seedEthUsd(store, rpc);

	if (empty && store.chainRange() !== null) store.setLastRunAt(Date.now());
	if (history() !== historyBefore && store.lastRunAt() !== null) await writeSnapshot?.();
	return stats;
}

/** CMS entries refreshed into the cache and merged with the overrides; the cache covers outages. */
async function refreshRegistry(store: Store): Promise<Registry> {
	try {
		const entries = await fetchCmsEntries(NETWORK.chainId);
		if (entries.length === 0) throw new Error(`no entries for chain ${NETWORK.chainId}`);
		store.replaceCmsEntries(entries);
		log(`registry: ${entries.length} CMS entries + ${OVERRIDES.length} overrides`);
	} catch (error) {
		log(`registry: CMS unavailable (${describeError(error)}); using the cached copy`);
	}
	return new Registry(store.cmsEntries(), OVERRIDES);
}

async function safeHead(rpc: Rpc): Promise<number> {
	return Number(await rpc.call<string>("eth_blockNumber", [])) - CONFIRMATIONS;
}
