import {
	ethCall,
	getLogs,
	getReceipts,
	parseSettlementLogs,
	ROUTER,
	SELECTOR,
	SETTLEMENT,
	TOPIC,
} from "./chain.ts";
import { LOG_RANGE, NETWORK } from "./config.ts";
import { duration, fmt, log, throttledLog } from "./log.ts";
import { feedSegments, pricePoints } from "./prices.ts";
import type { FeedSegment } from "./prices.ts";
import type { Rpc } from "./rpc.ts";
import type { BlockRange } from "./rules.ts";
import type { ChainChunk, Store, TxRow } from "./store.ts";

/** Block ranges fetched ahead of the one being committed. */
const PIPELINE = 2;

/** Running totals of chain ingestion, for throughput reports. */
export interface IngestStats {
	ranges: number;
	/** Batch transactions, one receipt each. */
	receipts: number;
	/** Time spent ingesting. */
	seconds: number;
}

/**
 * AllowList `isSolver` verdicts on flash-loan router senders and recipients. Each address is
 * checked once, at the block of the first router settlement seen with it, and the verdict is
 * kept: the public RPC allows about one `eth_call` every two seconds, and an address does not
 * switch between being a solver and being an operator account.
 */
export class AllowList {
	readonly #store: Store;
	readonly #rpc: Rpc;
	readonly #checks = new Map<string, Promise<boolean>>();

	constructor(store: Store, rpc: Rpc) {
		this.#store = store;
		this.#rpc = rpc;
	}

	async isSolver(address: string, block: number): Promise<boolean> {
		const known = this.#store.allowListVerdict(address);
		if (known !== null) return known;
		let check = this.#checks.get(address);
		if (!check) {
			check = this.#check(address, block);
			this.#checks.set(address, check);
		}
		return check;
	}

	async #check(address: string, block: number): Promise<boolean> {
		try {
			const data = SELECTOR.isSolver + address.slice(2).padStart(64, "0");
			const call = ethCall(NETWORK.contracts.allowList, data, block);
			const verdict = BigInt(await this.#rpc.call<string>(call.method, call.params)) === 1n;
			this.#store.saveAllowListVerdict(address, verdict, block);
			return verdict;
		} finally {
			this.#checks.delete(address);
		}
	}
}

/**
 * Fetches everything a block range adds: settlements and trades from the settlement contract's
 * logs, a receipt per batch transaction, and the ETH/USD answers of the aggregators that `feed`
 * says the Chainlink proxy used. Flash-loan router senders and recipients get an AllowList
 * verdict on the way.
 */
export async function fetchChunk(
	rpc: Rpc,
	range: BlockRange,
	feed: FeedSegment[],
	allowList: AllowList
): Promise<ChainChunk> {
	const aggregators = feed
		.filter((segment) => segment.from <= range.to && range.from <= segment.to)
		.map((segment) => segment.aggregator);
	const logs = await getLogs(
		rpc,
		range.from,
		range.to,
		[SETTLEMENT, ...new Set(aggregators)],
		[[TOPIC.settlement, TOPIC.trade, TOPIC.interaction, TOPIC.answerUpdated]]
	);
	const { settlements, trades } = parseSettlementLogs(
		logs.filter((entry) => entry.address.toLowerCase() === SETTLEMENT)
	);
	const blockOf = new Map<string, number>();
	const routed = new Set<string>();
	for (const settlement of settlements) {
		if (settlement.trades === 0) continue;
		blockOf.set(settlement.tx, settlement.block);
		if (settlement.solver === ROUTER) routed.add(settlement.tx);
	}
	const receipts = await getReceipts(rpc, [...blockOf.keys()]);
	const txs: TxRow[] = [...receipts].map(([tx, receipt]) => {
		const block = Number(receipt.blockNumber);
		if (block !== blockOf.get(tx)) {
			throw new Error(
				`receipt of ${tx} is in block ${block}, its logs in ${blockOf.get(tx)}`
			);
		}
		return {
			tx,
			block,
			sender: receipt.from.toLowerCase(),
			recipient: receipt.to?.toLowerCase() ?? null,
			gasUsed: Number(receipt.gasUsed),
			gasPrice: BigInt(receipt.effectiveGasPrice).toString(),
			l1Fee: BigInt(receipt.l1Fee ?? 0).toString(),
		};
	});
	for (const { tx, block, sender, recipient } of txs) {
		if (routed.has(tx)) await checkRouterParties(allowList, sender, recipient, block);
	}
	return { range, settlements, trades, txs, prices: pricePoints(feed, logs, range) };
}

/** AllowList verdicts on what attribution may credit a router settlement to. */
async function checkRouterParties(
	allowList: AllowList,
	sender: string,
	recipient: string | null,
	block: number
): Promise<void> {
	await allowList.isSolver(sender, block);
	if (recipient !== null && recipient !== ROUTER) await allowList.isSolver(recipient, block);
}

/** Router batch transactions whose recipient one repair round fetches and stores. */
const REPAIR_CHUNK = 100;

/**
 * Fills in the recipient of flash-loan router batch transactions stored before recipients were
 * kept, with the recipients' AllowList verdicts. Each round is committed, so a rerun resumes.
 */
export async function repairRouterRecipients(store: Store, rpc: Rpc): Promise<void> {
	const pending = store.routerTxsWithoutRecipient(ROUTER);
	if (pending.length === 0) return;
	const started = performance.now();
	log(`router recipients: repairing ${fmt(pending.length)} txs`);
	const allowList = new AllowList(store, rpc);
	const report = throttledLog();
	for (let start = 0; start < pending.length; start += REPAIR_CHUNK) {
		const chunk = pending.slice(start, start + REPAIR_CHUNK);
		const receipts = await getReceipts(
			rpc,
			chunk.map(({ tx }) => tx)
		);
		const rows = chunk.map(({ tx, block }) => {
			const receipt = receipts.get(tx)!;
			if (receipt.to === null) throw new Error(`receipt of ${tx} has no recipient`);
			const sender = receipt.from.toLowerCase();
			return { tx, block, sender, recipient: receipt.to.toLowerCase() };
		});
		for (const { block, sender, recipient } of rows) {
			await checkRouterParties(allowList, sender, recipient, block);
		}
		store.saveRecipients(rows);
		const done = start + chunk.length;
		report(() => `router recipients: ${fmt(done)}/${fmt(pending.length)} txs repaired`);
	}
	const seconds = (performance.now() - started) / 1000;
	log(`router recipients: ${fmt(pending.length)} txs repaired in ${duration(seconds)}`);
}

/**
 * Extends chain data down to `low`, newest blocks first, so recent days complete first. When
 * `stop` aborts it commits the ranges already being fetched and stops; the next backfill resumes
 * below them.
 */
export async function backfillChain(
	store: Store,
	rpc: Rpc,
	low: number,
	head: number,
	stats: IngestStats,
	stop?: AbortSignal
): Promise<void> {
	const top = (store.chainRange()?.from ?? head + 1) - 1;
	const ranges: BlockRange[] = [];
	for (let to = top; to >= low; to -= LOG_RANGE) {
		ranges.push({ from: Math.max(low, to - LOG_RANGE + 1), to });
	}
	await ingest(store, rpc, ranges, "backfill", stats, stop);
}

/** Extends chain data up to `head`. */
export async function catchUpChain(
	store: Store,
	rpc: Rpc,
	head: number,
	stats: IngestStats
): Promise<void> {
	const ranges: BlockRange[] = [];
	for (let from = store.chainRange()!.to + 1; from <= head; from += LOG_RANGE) {
		ranges.push({ from, to: Math.min(head, from + LOG_RANGE - 1) });
	}
	await ingest(store, rpc, ranges, "catch-up", stats);
}

/**
 * Fetches ranges a few at a time and commits them strictly in order, each in one transaction
 * with the new chain range, so the ingested range stays contiguous and a crash loses nothing.
 * The ETH/USD feed's aggregators are resolved once for the whole pass. Once `stop` aborts, no
 * further range is fetched.
 */
async function ingest(
	store: Store,
	rpc: Rpc,
	ranges: BlockRange[],
	label: string,
	stats: IngestStats,
	stop?: AbortSignal
): Promise<void> {
	if (ranges.length === 0 || stop?.aborted) return;
	const started = performance.now();
	const callsBefore = rpc.stats.calls;
	const low = ranges.reduce((min, range) => Math.min(min, range.from), Infinity);
	const high = ranges.reduce((max, range) => Math.max(max, range.to), -Infinity);
	log(`chain ${label}: blocks ${low}..${high}, ${fmt(ranges.length)} ranges`);
	const feed = await feedSegments(rpc, low, high);
	const allowList = new AllowList(store, rpc);
	let done = 0;
	let receipts = 0;
	const report = throttledLog();
	const queue: Promise<ChainChunk>[] = [];
	let next = 0;
	const refill = () => {
		while (queue.length < PIPELINE && next < ranges.length && !stop?.aborted) {
			const pending = fetchChunk(rpc, ranges[next++], feed, allowList);
			pending.catch(() => {}); // awaited in order below
			queue.push(pending);
		}
	};
	refill();
	while (queue.length > 0) {
		const chunk = await queue.shift()!;
		const current = store.chainRange();
		store.commitChunk(chunk, {
			from: Math.min(current?.from ?? chunk.range.from, chunk.range.from),
			to: Math.max(current?.to ?? chunk.range.to, chunk.range.to),
		});
		refill();
		done++;
		receipts += chunk.txs.length;
		stats.ranges++;
		stats.receipts += chunk.txs.length;
		report(() => {
			const seconds = (performance.now() - started) / 1000;
			const eta = (seconds / done) * (ranges.length - done);
			return (
				`chain ${label}: ${fmt(done)}/${fmt(ranges.length)} ranges · at block ${chunk.range.from} · ` +
				`${(receipts / seconds).toFixed(1)} receipts/s · ` +
				`${((rpc.stats.calls - callsBefore) / seconds).toFixed(1)} calls/s · eta ${duration(eta)}`
			);
		});
	}
	const seconds = (performance.now() - started) / 1000;
	stats.seconds += seconds;
	const outcome = done < ranges.length ? `stopped at block ${store.chainRange()?.from}` : "done";
	log(`chain ${label}: ${outcome}, ${fmt(receipts)} batch txs in ${duration(seconds)}`);
}
