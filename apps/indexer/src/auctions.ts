import { setTimeout as sleep } from "node:timers/promises";

import { ROUTER } from "./chain.ts";
import { LOG_RANGE, NETWORK, timeOf } from "./config.ts";
import type { Competition } from "./cow.ts";
import { duration, fmt, log, throttledLog } from "./log.ts";
import type { Registry } from "./registry.ts";
import { priceToken } from "./rules.ts";
import type { BlockRange } from "./rules.ts";
import type { CompetitionLink, Store } from "./store.ts";

/** Where competitions come from: the CoW API, or a stub in tests. */
export interface CompetitionSource {
	competitionByTx(tx: string): Promise<Competition | null>;
}

/** Shared with the chain backfill, which the auction backfill trails. */
export interface ChainWatch {
	done: boolean;
}

/** Running totals of auction ingestion, for throughput reports. */
export interface AuctionStats {
	/** Batch transactions looked up in the API. */
	lookups: number;
	/** Lookups the API had no competition for. */
	missing: number;
	/** Time spent looking up, excluding waits for chain data. */
	seconds: number;
}

/** Concurrent lookups. */
const LANES = 4;
/**
 * Blocks within which one auction's settlements land: between its start and its deadline,
 * observed at 6–8 blocks after the start on Base.
 */
const SAME_AUCTION_BLOCKS = 10;
/**
 * Seconds after a settlement's block after which an API miss is final; the API normally links a
 * settlement much sooner.
 */
const MISS_IS_FINAL_AFTER = 600;

/** Whether a batch transaction still needs a competition lookup. */
function needsLookup(link: CompetitionLink | null, block: number): boolean {
	if (link === null) return true;
	if (link.auctionId !== null) return !link.priced;
	return link.checkedAt - timeOf(block) < MISS_IS_FINAL_AFTER;
}

/**
 * Fetches the competition of a settlement transaction and stores it, together with the native
 * prices of the tokens traded by those of its transactions that are already ingested. Its other
 * transactions are linked unpriced and looked up again once their blocks are ingested.
 */
async function lookUpCompetition(
	store: Store,
	source: CompetitionSource,
	tx: string
): Promise<Competition | null> {
	const competition = await source.competitionByTx(tx);
	const checkedAt = Math.floor(Date.now() / 1000);
	if (competition === null) {
		store.saveMissingCompetition(tx, checkedAt);
		return null;
	}
	const prices = new Map<string, string>();
	const links: { tx: string; priced: boolean }[] = [];
	for (const linked of new Set([tx, ...competition.txHashes])) {
		const tokens = store.tradedTokens(linked);
		links.push({ tx: linked, priced: tokens !== null });
		for (const token of tokens ?? []) {
			const price = competition.prices.get(priceToken(token));
			if (price !== undefined) prices.set(priceToken(token), price);
		}
	}
	store.saveCompetition(competition, [...prices], links, checkedAt);
	return competition;
}

/**
 * Looks up the competition of every batch transaction in a block range, in block order, skipping
 * transactions an earlier lookup already linked: a multi-winner auction settles in several
 * transactions and lists them all. Lookups overlap, but each transaction first waits for the
 * lookups of the transactions just before it, since one of them may link it. When `signal`
 * aborts it stops early, leaving the range partly done: every lookup made is stored, so going
 * over the range again only looks up the rest.
 */
export async function processAuctionRange(
	store: Store,
	source: CompetitionSource,
	range: BlockRange,
	stats: AuctionStats,
	signal?: AbortSignal
): Promise<void> {
	const started = performance.now();
	const inFlight = new Map<string, { block: number; done: Promise<void> }>();
	const errors: unknown[] = [];
	for (const { tx, block } of store.batchTxs(range)) {
		const nearby = [...inFlight.values()].filter(
			(job) => job.block >= block - SAME_AUCTION_BLOCKS
		);
		await Promise.all(nearby.map((job) => job.done));
		while (inFlight.size >= LANES)
			await Promise.race([...inFlight.values()].map((job) => job.done));
		if (errors.length > 0 || signal?.aborted) break;
		if (!needsLookup(store.competitionLink(tx), block)) continue;
		stats.lookups++;
		const done = lookUpCompetition(store, source, tx)
			.then((competition) => {
				if (competition === null) stats.missing++;
			})
			.catch((error: unknown) => {
				errors.push(error);
			})
			.finally(() => inFlight.delete(tx));
		inFlight.set(tx, { block, done });
	}
	await Promise.all([...inFlight.values()].map((job) => job.done));
	stats.seconds += (performance.now() - started) / 1000;
	if (errors.length > 0) throw errors[0];
}

/**
 * Extends auction data down to `low`, newest blocks first. It trails the chain backfill, which
 * also runs newest first: each block range waits until its chain data is ingested. When `signal`
 * aborts it stops cleanly; the auction range then ends at the last whole block range, and the
 * next backfill resumes below it.
 */
export async function backfillAuctions(
	store: Store,
	source: CompetitionSource,
	low: number,
	chain: ChainWatch,
	stats: AuctionStats,
	signal: AbortSignal
): Promise<void> {
	await until(() => store.chainRange() !== null || chain.done, signal);
	const existing = store.auctionRange();
	const start = existing ? existing.from - 1 : store.chainRange()?.to;
	if (start === undefined || start < low || signal.aborted) return;
	log(`auctions backfill: blocks ${low}..${start}`);
	const started = performance.now();
	const lookupsBefore = stats.lookups;
	const report = throttledLog();
	for (let top = start; top >= low;) {
		const from = Math.max(low, top - LOG_RANGE + 1);
		const ingested = () => (store.chainRange()?.from ?? Infinity) <= from;
		await until(() => ingested() || chain.done, signal);
		if (!ingested() || signal.aborted) break;
		await processAuctionRange(store, source, { from, to: top }, stats, signal);
		if (signal.aborted) break;
		store.setAuctionRange({ from, to: existing?.to ?? start });
		const seconds = (performance.now() - started) / 1000;
		const lookups = stats.lookups - lookupsBefore;
		const eta = (seconds / (start - from + 1)) * (from - low);
		report(
			() =>
				`auctions backfill: at block ${from} · ${fmt(lookups)} lookups ` +
				`(${(lookups / seconds).toFixed(2)}/s) · ${fmt(stats.missing)} not found · eta ${duration(eta)}`
		);
		top = from - 1;
	}
	const seconds = (performance.now() - started) / 1000;
	const lookups = fmt(stats.lookups - lookupsBefore);
	const reached = store.auctionRange()?.from ?? start + 1;
	const outcome = reached > low ? `stopped at block ${reached}` : "done";
	log(`auctions backfill: ${outcome}, ${lookups} lookups in ${duration(seconds)}`);
}

/**
 * Extends auction data up to the end of the chain data. It starts a little below the previous
 * end to look again at recent misses, which the API may have filled in since.
 */
export async function catchUpAuctions(
	store: Store,
	source: CompetitionSource,
	stats: AuctionStats
): Promise<void> {
	const range = store.auctionRange();
	const chain = store.chainRange();
	if (range === null || chain === null || range.to >= chain.to) return;
	const recheck = Math.ceil(MISS_IS_FINAL_AFTER / NETWORK.blockTime);
	const started = performance.now();
	const lookupsBefore = stats.lookups;
	const report = throttledLog();
	for (
		let from = Math.max(range.from, range.to + 1 - recheck);
		from <= chain.to;
		from += LOG_RANGE
	) {
		const to = Math.min(chain.to, from + LOG_RANGE - 1);
		await processAuctionRange(store, source, { from, to }, stats);
		store.setAuctionRange({ from: range.from, to: Math.max(range.to, to) });
		report(
			() =>
				`auctions catch-up: at block ${to} of ${chain.to} · ${fmt(stats.lookups - lookupsBefore)} lookups`
		);
	}
	const seconds = (performance.now() - started) / 1000;
	const lookups = stats.lookups - lookupsBefore;
	log(`auctions catch-up: ${fmt(lookups)} lookups to block ${chain.to} in ${duration(seconds)}`);
}

/**
 * Looks up the competitions of flash-loan router settlements anywhere in the chain data, not only
 * in the auction range, whose recipient and sender are neither registered nor allow-listed: their
 * attribution falls back to the API's winner.
 */
export async function resolveRouterSenders(
	store: Store,
	source: CompetitionSource,
	registry: Registry,
	stats: AuctionStats,
	signal?: AbortSignal
): Promise<void> {
	const pending = store
		.unresolvedRouterTxs(ROUTER)
		.filter(
			({ sender, recipient }) =>
				!registry.has(sender) && (recipient === null || !registry.has(recipient))
		);
	if (pending.length === 0) return;
	const started = performance.now();
	let next = 0;
	let failed = false;
	const lane = async () => {
		while (next < pending.length && !failed && !signal?.aborted) {
			const { tx } = pending[next++];
			stats.lookups++;
			try {
				if ((await lookUpCompetition(store, source, tx)) === null) stats.missing++;
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(LANES, pending.length) }, lane));
	const seconds = (performance.now() - started) / 1000;
	stats.seconds += seconds;
	log(`router settlements with unknown solvers: ${fmt(next)} looked up in ${duration(seconds)}`);
}

/** Waits until `ready`, or until `signal` aborts. */
async function until(ready: () => boolean, signal: AbortSignal): Promise<void> {
	while (!ready() && !signal.aborted) await sleep(500);
}
