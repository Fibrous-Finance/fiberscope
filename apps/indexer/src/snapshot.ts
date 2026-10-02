import type {
	AuctionSummary,
	SettlementSummary,
	Snapshot,
	SnapshotSolver,
	SolverAddress,
} from "@fiberscope/core";

import { NETWORK, timeOf } from "./config.ts";
import { auctionOutcomes, loadBatches, TradeValuer } from "./facts.ts";
import type { Batch } from "./facts.ts";
import { shortAddress } from "./log.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import { bucketOf, completeBuckets, windowStart } from "./rules.ts";
import type { Store, TradeValueRow } from "./store.ts";

const LATEST_AUCTIONS = 48;
const LATEST_SETTLEMENTS = 6;

export interface SnapshotOptions {
	store: Store;
	registry: Registry;
	refreshMinutes: number;
	/** Token symbols by address, for the given tokens; it may fetch the ones it lacks. */
	symbols: (tokens: string[]) => Promise<Map<string, string>>;
}

export interface SnapshotStats {
	/** Trades in the auction coverage. */
	trades: number;
	/** Of those, trades with no priced side (no volume). */
	unpriced: number;
	/** Of those, trades valued from one side only. */
	oneSided: number;
}

interface Tally {
	identity: SolverIdentity;
	/** Submission addresses seen in the covered data. */
	seen: Set<string>;
	batches: number[];
	trades: number[];
	gas: number[];
	volume: number[];
	entered: number[];
	won: number[];
	/** The latest batches, oldest first. */
	latest: Batch[];
}

/** Builds the snapshot from stored rows; buckets are cut fresh at every call. */
export async function buildSnapshot(
	options: SnapshotOptions
): Promise<{ snapshot: Snapshot; stats: SnapshotStats }> {
	const { store, registry } = options;
	const chain = store.chainRange();
	if (chain === null) throw new Error("The database holds no chain data: run sync first");
	const end = chain.to;
	const chainDays = completeBuckets(end, chain);
	const auctionRange = store.auctionRange();
	const auctionDays = Math.min(chainDays, completeBuckets(end, auctionRange));
	const lastRunAt = store.lastRunAt();
	if (lastRunAt === null) throw new Error("No sync has completed yet");

	const tallies = new Map<string, Tally>();
	const tally = (identity: SolverIdentity): Tally => {
		let entry = tallies.get(identity.id);
		if (!entry) {
			entry = {
				identity,
				seen: new Set(),
				batches: zeros(chainDays),
				trades: zeros(chainDays),
				gas: zeros(chainDays),
				volume: zeros(auctionDays),
				entered: zeros(auctionDays),
				won: zeros(auctionDays),
				latest: [],
			};
			tallies.set(identity.id, entry);
		}
		return entry;
	};

	const creditedTo = new Map<string, Tally>();
	if (chainDays > 0) {
		for (const batch of loadBatches(store, registry, {
			from: windowStart(end, chainDays),
			to: end,
		})) {
			const d = bucketOf(end, batch.block);
			const entry = tally(batch.solver);
			entry.seen.add(batch.address);
			entry.batches[d]++;
			entry.trades[d] += batch.trades;
			entry.gas[d] += batch.gas;
			entry.latest.push(batch);
			if (entry.latest.length > LATEST_SETTLEMENTS) entry.latest.shift();
			creditedTo.set(`${batch.tx}:${batch.logIndex}`, entry);
		}
	}

	const valuer = new TradeValuer(store);
	const stats: SnapshotStats = { trades: 0, unpriced: 0, oneSided: 0 };
	const count = zeros(auctionDays);
	const solutions = zeros(auctionDays);
	if (auctionDays > 0) {
		const range = { from: windowStart(end, auctionDays), to: end };
		for (const trade of store.tradeRows(range)) {
			const { usd, pricedSides } = valuer.value(trade);
			stats.trades++;
			if (usd === null) stats.unpriced++;
			else if (pricedSides === 1) stats.oneSided++;
			const entry = creditedTo.get(`${trade.tx}:${trade.settlementLogIndex}`);
			if (usd !== null && entry) entry.volume[bucketOf(end, trade.block)] += usd;
		}
		for (const auction of auctionOutcomes(store.solutionsByStart(range), registry)) {
			const d = bucketOf(end, auction.startBlock);
			if (d < 0) continue;
			count[d]++;
			solutions[d] += auction.solutions;
			for (const { identity, addresses } of auction.entrants.values()) {
				const entry = tally(identity);
				entry.entered[d]++;
				for (const address of addresses) entry.seen.add(address);
			}
			for (const winner of auction.winners) tallies.get(winner.solver)!.won[d]++;
		}
	}

	const latestBySolver = new Map<Tally, { batch: Batch; trades: TradeValueRow[] }[]>();
	const tokens: string[] = [];
	for (const entry of tallies.values()) {
		const latest = entry.latest.toReversed().map((batch) => ({
			batch,
			trades: store.settlementTrades(batch.tx, batch.logIndex),
		}));
		for (const { trades } of latest) tokens.push(trades[0].sellToken, trades[0].buyToken);
		latestBySolver.set(entry, latest);
	}
	const symbols = await options.symbols(tokens);
	const symbol = (token: string) => symbols.get(token) ?? shortAddress(token);

	const solvers: SnapshotSolver[] = [...tallies.values()]
		.sort(
			(a, b) =>
				sum(b.batches) - sum(a.batches) ||
				sum(b.entered) - sum(a.entered) ||
				a.identity.id.localeCompare(b.identity.id)
		)
		.map((entry) => ({
			id: entry.identity.id,
			name: entry.identity.name,
			addresses: addressesOf(entry, registry),
			batches: entry.batches,
			trades: entry.trades,
			gas: entry.gas.map(Math.round),
			volume: entry.volume.map(cents),
			entered: entry.entered,
			won: entry.won,
			latestSettlements: latestBySolver
				.get(entry)!
				.map(({ batch, trades }): SettlementSummary => {
					const values = trades.map((trade) => valuer.value(trade).usd);
					const priced = values.filter((usd) => usd !== null);
					return {
						tx: batch.tx,
						block: batch.block,
						time: timeOf(batch.block) * 1000,
						trades: batch.trades,
						pair: {
							sell: symbol(trades[0].sellToken),
							buy: symbol(trades[0].buyToken),
						},
						volume:
							priced.length === 0 ? null : cents(priced.reduce((a, b) => a + b, 0)),
						gas: Math.round(batch.gas),
					};
				}),
		}));

	const latestAuctions: AuctionSummary[] = auctionOutcomes(
		auctionRange ? store.latestSolutions(auctionRange, LATEST_AUCTIONS) : [],
		registry
	).map((auction) => ({
		id: auction.id,
		time: timeOf(auction.startBlock) * 1000,
		entered: [...auction.entrants.keys()],
		winners: auction.winners,
	}));

	const snapshot = {
		schema: 1,
		network: NETWORK.id,
		builtAt: Date.now(),
		end: { block: end, time: timeOf(end) * 1000 },
		lastRunAt,
		refreshMinutes: options.refreshMinutes,
		coverage: { chainDays, auctionDays },
		auctions: { count, solutions },
		solvers,
		latestAuctions,
	} satisfies Snapshot;
	return { snapshot, stats };
}

/** Registered addresses that are active or seen in the data, prod before barn; else the address. */
function addressesOf(entry: Tally, registry: Registry): SolverAddress[] {
	const registered = registry.addresses(entry.identity.id);
	if (registered.length === 0)
		return [...entry.seen].map((address) => ({ env: "prod", address }));
	return registered
		.filter((address) => address.active || entry.seen.has(address.address))
		.sort(
			(a, b) =>
				Number(a.env === "barn") - Number(b.env === "barn") ||
				Number(b.active) - Number(a.active) ||
				a.address.localeCompare(b.address)
		)
		.map(({ env, address }) => ({ env, address }));
}

function zeros(length: number): number[] {
	return new Array<number>(length).fill(0);
}

function sum(values: number[]): number {
	return values.reduce((a, b) => a + b, 0);
}

function cents(usd: number): number {
	return Math.round(usd * 100) / 100;
}
