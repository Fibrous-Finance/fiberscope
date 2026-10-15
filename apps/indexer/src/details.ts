import { setTimeout as sleep } from "node:timers/promises";

import { NETWORK } from "./config.ts";
import type { Competition, ExecutedFee, FeePolicy, OrderDetail, OrderTrade } from "./cow.ts";
import { duration, fmt, log, throttledLog } from "./log.ts";
import type { BlockRange } from "./rules.ts";
import type { PendingFeeTrade, Store, StoredFee } from "./store.ts";

/** Where scores, orders and fees come from: the CoW API, or a stub in tests. */
export interface DetailSource {
	competition(auctionId: number): Promise<Competition | null>;
	orders(uids: string[]): Promise<Map<string, OrderDetail>>;
	trades(uid: string): Promise<OrderTrade[]>;
}

/** Running totals of detail lookups, for throughput reports. */
export interface DetailStats {
	/** Auctions fetched again for their scores. */
	scores: number;
	/** Orders looked up in CoW's order book. */
	orders: number;
	/** Orders whose trades were looked up for their fees. */
	fees: number;
	/** Time spent looking up, excluding waits for other data. */
	seconds: number;
}

/** What the detail backfill trails: the auction backfill and the filling-in of order uids. */
export interface DetailWatch {
	auctionsDone: boolean;
	uidsDone: boolean;
}

/** Concurrent lookups. */
const LANES = 4;
/** The most uids `POST /api/v1/orders/by_uids` takes. */
const ORDERS_PER_REQUEST = 128;
/**
 * Seconds after a trade's block after which the API's silence on its fees is final; the API
 * normally lists a trade within seconds.
 */
const MISS_IS_FINAL_AFTER = 600;

/**
 * Marks which of a trade's protocol fees are partner fees. CoW applies its own fee policies first
 * and then one per partner fee of the order's app data, so the partner fees are the last ones.
 * When those do not match the app data's policies, which fee is which is unclear (null).
 */
export function withPartners(fees: ExecutedFee[], partnerFees: FeePolicy[]): StoredFee[] {
	const first = fees.length - partnerFees.length;
	const aligned =
		first >= 0 && partnerFees.every((policy, i) => fees[first + i].policy === policy);
	return fees.map((fee, i) => ({ ...fee, partner: aligned ? i >= first : null }));
}

/**
 * Looks up what a block range lacks: the scores of the auctions that started in it and were
 * stored without them, then the orders traded in it, then the protocol fees of those trades. A
 * trade of an order CoW's order book lacks has no fees to look up; one the API does not list yet
 * is looked up again by a later call, until MISS_IS_FINAL_AFTER. Returns whether the range is
 * done: false when `signal` aborted, or when some of its trades still lack their order uid (then
 * only the scores are looked up).
 */
export async function processDetailRange(
	store: Store,
	source: DetailSource,
	range: BlockRange,
	stats: DetailStats,
	signal?: AbortSignal
): Promise<boolean> {
	const started = performance.now();
	try {
		await lanes(store.unscoredAuctions(range), signal, async (id) => {
			const competition = await source.competition(id);
			store.saveScores(id, competition?.solutions ?? null);
			stats.scores++;
		});
		if (signal?.aborted || store.tradesWithoutUid(range)) return false;

		const unknown = store.unknownOrders(range);
		for (let i = 0; i < unknown.length; i += ORDERS_PER_REQUEST) {
			if (signal?.aborted) return false;
			const batch = unknown.slice(i, i + ORDERS_PER_REQUEST);
			const found = await source.orders(batch.map((order) => order.uid));
			store.saveOrders(
				batch.map(({ uid, block }) => ({ uid, block, detail: found.get(uid) ?? null }))
			);
			stats.orders += batch.length;
		}

		const byOrder = new Map<string, PendingFeeTrade[]>();
		for (const trade of store.pendingFeeTrades(range)) {
			const trades = byOrder.get(trade.uid);
			if (trades) trades.push(trade);
			else byOrder.set(trade.uid, [trade]);
		}
		const booked: [string, PendingFeeTrade[]][] = [];
		for (const [uid, trades] of byOrder) {
			if (trades[0].found) booked.push([uid, trades]);
			else
				store.saveTradeFees(
					uid,
					trades.map((trade) => ({ ...trade, fees: null }))
				);
		}
		await lanes(booked, signal, async ([uid, trades]) => {
			const listed = new Map(
				(await source.trades(uid)).map((trade) => [
					`${trade.block}:${trade.logIndex}`,
					trade,
				])
			);
			const now = Date.now() / 1000;
			const saved: { block: number; logIndex: number; fees: StoredFee[] | null }[] = [];
			for (const { block, logIndex, partnerFees } of trades) {
				const trade = listed.get(`${block}:${logIndex}`);
				if (trade)
					saved.push({ block, logIndex, fees: withPartners(trade.fees, partnerFees) });
				else if (now - store.timeOf(block) >= MISS_IS_FINAL_AFTER) {
					saved.push({ block, logIndex, fees: null });
				}
			}
			if (saved.length > 0) store.saveTradeFees(uid, saved);
			stats.fees++;
		});
		return !signal?.aborted;
	} finally {
		stats.seconds += (performance.now() - started) / 1000;
	}
}

/**
 * Extends the detail range down to `low`, newest blocks first. It trails the auction backfill and
 * the filling-in of order uids: each block range waits until both have reached it. When `signal`
 * aborts it stops cleanly; the detail range then ends at the last whole block range, and the next
 * backfill resumes below it.
 */
export async function backfillDetails(
	store: Store,
	source: DetailSource,
	low: number,
	watch: DetailWatch,
	stats: DetailStats,
	signal: AbortSignal
): Promise<void> {
	await until(() => store.auctionRange() !== null || watch.auctionsDone, signal);
	const existing = store.detailRange();
	const start = existing ? existing.from - 1 : store.auctionRange()?.to;
	if (start === undefined || start < low || signal.aborted) return;
	log(`details backfill: blocks ${low}..${start}`);
	const started = performance.now();
	const before = { ...stats };
	const report = throttledLog();
	for (let top = start; top >= low;) {
		const range = { from: Math.max(low, top - NETWORK.logRange + 1), to: top };
		const auctioned = () => (store.auctionRange()?.from ?? Infinity) <= range.from;
		await until(() => auctioned() || watch.auctionsDone, signal);
		if (!auctioned() || signal.aborted) break;
		await until(() => watch.uidsDone || !store.tradesWithoutUid(range), signal);
		if (!(await processDetailRange(store, source, range, stats, signal))) break;
		store.setDetailRange({ from: range.from, to: existing?.to ?? start });
		const seconds = (performance.now() - started) / 1000;
		const eta = (seconds / (start - range.from + 1)) * (range.from - low);
		report(
			() =>
				`details backfill: at block ${range.from} · ${progress(stats, before)} · eta ${duration(eta)}`
		);
		top = range.from - 1;
	}
	const reached = store.detailRange()?.from ?? start + 1;
	const outcome = reached > low ? `stopped at block ${reached}` : "done";
	const seconds = (performance.now() - started) / 1000;
	log(`details backfill: ${outcome}, ${progress(stats, before)} in ${duration(seconds)}`);
}

/**
 * The block range the details' catch-up goes over: from a little below the end of the detail
 * range, to look again for the fees of recent trades the API had not listed yet, to the end of
 * the auction data. Null when the details have caught up with the auctions.
 */
function catchUpRange(store: Store): BlockRange | null {
	const range = store.detailRange();
	const auctions = store.auctionRange();
	if (range === null || auctions === null || range.to >= auctions.to) return null;
	const recheck = Math.ceil(MISS_IS_FINAL_AFTER / NETWORK.blockTime);
	return { from: Math.max(range.from, range.to + 1 - recheck), to: auctions.to };
}

/**
 * About how many API requests the details' catch-up makes: one per auction to score, one per
 * ORDERS_PER_REQUEST orders to look up, and one per order whose trades' fees are due, counting
 * each order not looked up yet as one CoW's order book has.
 */
export function detailCatchUpRequests(store: Store): number {
	const range = catchUpRange(store);
	if (range === null) return 0;
	const unknown = store.unknownOrders(range).length;
	const due = new Set(
		store
			.pendingFeeTrades(range)
			.filter((trade) => trade.found)
			.map((trade) => trade.uid)
	);
	return (
		store.unscoredAuctions(range).length +
		Math.ceil(unknown / ORDERS_PER_REQUEST) +
		unknown +
		due.size
	);
}

/**
 * Extends the detail range up to the end of the auction data, over catchUpRange. When `signal`
 * aborts it stops after the lookups in flight, and the detail range ends at the last whole block
 * range.
 */
export async function catchUpDetails(
	store: Store,
	source: DetailSource,
	stats: DetailStats,
	signal?: AbortSignal
): Promise<void> {
	const span = catchUpRange(store);
	if (span === null) return;
	const range = store.detailRange()!;
	const started = performance.now();
	const before = { ...stats };
	for (let from = span.from; from <= span.to; from += NETWORK.logRange) {
		const to = Math.min(span.to, from + NETWORK.logRange - 1);
		if (!(await processDetailRange(store, source, { from, to }, stats, signal))) break;
		store.setDetailRange({ from: range.from, to: Math.max(range.to, to) });
	}
	const seconds = (performance.now() - started) / 1000;
	const reached = store.detailRange()?.to ?? range.to;
	log(`details catch-up: ${progress(stats, before)} to block ${reached} in ${duration(seconds)}`);
}

function progress(stats: DetailStats, before: DetailStats): string {
	return (
		`${fmt(stats.scores - before.scores)} auctions scored, ` +
		`${fmt(stats.orders - before.orders)} orders, ${fmt(stats.fees - before.fees)} fee lookups`
	);
}

/**
 * Runs `work` on each item, LANES at a time, until the items run out, `signal` aborts or one
 * fails. It waits for the work in flight before it returns, and rethrows the first failure.
 */
async function lanes<T>(
	items: T[],
	signal: AbortSignal | undefined,
	work: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const failures: unknown[] = [];
	const lane = async () => {
		while (next < items.length && failures.length === 0 && !signal?.aborted) {
			const item = items[next++];
			try {
				await work(item);
			} catch (error) {
				failures.push(error);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(LANES, items.length) }, lane));
	if (failures.length > 0) throw failures[0];
}

/** Waits until `ready`, or until `signal` aborts. */
async function until(ready: () => boolean, signal: AbortSignal): Promise<void> {
	while (!ready() && !signal.aborted) await sleep(500);
}
