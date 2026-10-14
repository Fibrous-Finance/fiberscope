import { setTimeout as sleep } from "node:timers/promises";

import { backfillAuctions, catchUpAuctions, resolveRouterSenders } from "./auctions.ts";
import type { AuctionStats, ChainWatch } from "./auctions.ts";
import { Clock } from "./clock.ts";
import type { Anchor } from "./clock.ts";
import { NETWORK } from "./config.ts";
import type { CowApi } from "./cow.ts";
import { backfillDetails, catchUpDetails } from "./details.ts";
import type { DetailStats, DetailWatch } from "./details.ts";
import { backfillChain, catchUpChain, fillOrderUids, seedNativeUsd } from "./ingest.ts";
import type { IngestStats } from "./ingest.ts";
import { log } from "./log.ts";
import { OVERRIDES } from "./overrides.ts";
import { describeError } from "./pacer.ts";
import { fetchCmsEntries, Registry } from "./registry.ts";
import type { Rpc } from "./rpc.ts";
import { Days } from "./rules.ts";
import type { Store } from "./store.ts";

export interface SyncOptions {
	/** Days of chain history to hold at least. */
	chainDays: number;
	/** Days of auction history to hold at least; chain history is extended to match. */
	auctionDays: number;
	/** Minutes after the start of the sync at which the backfill stops; null for no limit. */
	budgetMinutes: number | null;
	/** Delete the data older than the requested depths once the head is caught up. */
	prune: boolean;
	/**
	 * Writes the snapshot, once the data is current and again when the backfill adds history (on an
	 * empty database, only after the backfill).
	 */
	writeSnapshot: (() => Promise<void>) | null;
}

export interface SyncStats {
	chain: IngestStats;
	auctions: AuctionStats;
	details: DetailStats;
}

/** Blocks the end may trail the head after a catch-up round before another round runs: 5 minutes. */
const CATCH_UP_SLACK = Math.ceil(300 / NETWORK.blockTime);
/** The longest the details' catch-up may hold up the snapshot before it stops (2 minutes). */
const DETAIL_CATCH_UP_MS = 120_000;

/**
 * Brings the database up to date. Chain and auction data catch up with the network's safe block,
 * and the details (the auctions' scores, and the quotes and protocol fees of the orders traded)
 * with the auctions; that makes the data current (the last run time) and is when the snapshot is
 * written. Then chain, auction and detail history are backfilled to the requested depths, within
 * the budget if there is one; the snapshot is written again if history grew. Every step resumes
 * where an interrupted or stopped run left off.
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
		chain: { receipts: 0, seconds: 0 },
		auctions: { lookups: 0, missing: 0, seconds: 0 },
		details: { scores: 0, orders: 0, fees: 0, seconds: 0 },
	};
	await seedNativeUsd(store, rpc);

	// Catch up: chain data to the head, then the auctions of the new blocks. A long pause since
	// the last run leaves the head far behind, so this repeats, at most three times, until the end
	// is within CATCH_UP_SLACK blocks of the head. Then the days end at the end of the chain data.
	// An empty database has nothing to catch up: its backfill starts at the head, and the head's
	// own header places the days until the backfill brings the anchors of their blocks.
	const empty = store.chainRange() === null;
	let days: Days;
	if (empty) {
		const head = await safeHead(rpc);
		days = new Days(new Clock([head], NETWORK.blockTime), head.block);
	} else {
		for (let round = 0; round < 3; round++) {
			await catchUpChain(store, rpc, (await safeHead(rpc)).block, stats.chain);
			await catchUpAuctions(store, cow, stats.auctions);
			if ((await safeHead(rpc)).block - store.chainRange()!.to <= CATCH_UP_SLACK) break;
		}
		await resolveRouterSenders(store, cow, registry, stats.auctions);
		days = new Days(store.clock(), store.chainRange()!.to);
		if (options.prune && chainDays > 0) {
			store.prune(
				days.windowStart(chainDays),
				options.auctionDays > 0 ? days.windowStart(options.auctionDays) : null
			);
		}
		// The details of the new blocks, for the snapshot. Their lookups must not hold it up: if
		// one fails, or they run long, the snapshot goes without them and the next run catches up.
		try {
			await catchUpDetails(
				store,
				cow,
				stats.details,
				AbortSignal.timeout(DETAIL_CATCH_UP_MS)
			);
		} catch (error) {
			log(`details catch-up failed: ${describeError(error)}; the next run catches up`);
		}
		store.setLastRunAt(Date.now());
		await writeSnapshot?.();
	}

	// Backfill. The chain runs newest first and the auction backfill trails it, so the RPC and
	// the CoW API rate limits are spent at the same time, and the chain reaches the auction depth
	// before it goes deeper: auction history never waits for the full chain depth. The details
	// trail the auction backfill. The trades stored before the schema held order uids get them
	// from the RPC.
	const chainFrom = store.chainRange()?.from;
	const auctionFrom = store.auctionRange()?.from;
	const detailFrom = store.detailRange()?.from;
	const chain: ChainWatch = { done: false };
	const details: DetailWatch = { auctionsDone: false, uidsDone: false };
	const abort = new AbortController();
	const stop = budget === null ? abort.signal : AbortSignal.any([abort.signal, budget]);
	const chainWork = (async () => {
		try {
			if (chainDays > 0) {
				const low = days.reach(chainDays);
				await backfillChain(store, rpc, low, days.end, stats.chain, budget ?? undefined);
			}
		} catch (error) {
			abort.abort(error);
			throw error;
		} finally {
			chain.done = true;
		}
	})();
	const uidWork = (async () => {
		try {
			await fillOrderUids(store, rpc, stop);
		} catch (error) {
			abort.abort(error);
			throw error;
		} finally {
			details.uidsDone = true;
		}
	})();
	const auctionWork = (async () => {
		try {
			if (options.auctionDays > 0) {
				const low = days.reach(options.auctionDays);
				await backfillAuctions(store, cow, low, chain, stats.auctions, stop);
			}
		} finally {
			details.auctionsDone = true;
		}
		// Once the auction backfill is done, the CoW API's rate allowance is idle while the chain
		// backfill runs on: spend it on the router settlements whose attribution needs the API's
		// winner, as their blocks arrive.
		while (!chain.done) {
			await resolveRouterSenders(store, cow, registry, stats.auctions, stop);
			for (let waited = 0; waited < 20 && !chain.done; waited++) await sleep(500);
		}
	})();
	const detailWork = (async () => {
		// Whatever the catch-up before the snapshot left, if it stopped early.
		await catchUpDetails(store, cow, stats.details);
		if (options.auctionDays > 0) {
			const low = days.reach(options.auctionDays);
			await backfillDetails(store, cow, low, details, stats.details, stop);
		}
	})();
	const settled = await Promise.allSettled([chainWork, uidWork, auctionWork, detailWork]);
	for (const work of settled) if (work.status === "rejected") throw work.reason;
	if (budget?.aborted) {
		log(`sync: the ${budgetMinutes}-minute budget is spent; the next run resumes the backfill`);
	}
	await seedNativeUsd(store, rpc);

	if (empty && store.chainRange() !== null) store.setLastRunAt(Date.now());
	const grew =
		store.chainRange()?.from !== chainFrom ||
		store.auctionRange()?.from !== auctionFrom ||
		store.detailRange()?.from !== detailFrom;
	if (grew && store.lastRunAt() !== null) await writeSnapshot?.();
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

/**
 * The network's safe block, with its time. On Base, the newest block whose transactions Base has
 * posted to Ethereum: blocks up to it change only if Ethereum reorganizes the blocks holding that
 * data. On BNB Chain, the newest justified block, a block or two behind the head. The indexer
 * never stores a block past it, so never one the network itself might replace.
 */
async function safeHead(rpc: Rpc): Promise<Anchor> {
	const block = await rpc.call<{ number: string; timestamp: string } | null>(
		"eth_getBlockByNumber",
		["safe", false]
	);
	if (block === null) throw new Error("the RPC node has no safe block");
	return { block: Number(block.number), time: Number(block.timestamp) };
}
