import type {
	AuctionSummary,
	CreditedSettlement,
	RegisteredSolver,
	SettlementSummary,
	Snapshot,
	SnapshotSolver,
	SolverAddress,
} from "@fiberscope/core";

import { NETWORK, timeOf } from "./config.ts";
import { auctionOutcomes, loadBatches, TradeValuer } from "./facts.ts";
import type { Batch } from "./facts.ts";
import { shortAddress } from "./log.ts";
import type { Registry, RegistryEntry, SolverIdentity } from "./registry.ts";
import { bucketOf, completeBuckets, windowStart } from "./rules.ts";
import type { Store, TradeValueRow } from "./store.ts";

const LATEST_AUCTIONS = 48;
const LATEST_SETTLEMENTS = 6;
const LATEST_NETWORK_SETTLEMENTS = 50;

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
	/** Priced trades in the surplus coverage. */
	surplusPriced: number;
	/** Of those, trades without a surplus: their order terms are unknown. */
	noSurplus: number;
	/** Batches in the chain coverage without an ETH/USD rate, so without a cost. */
	uncosted: number;
}

interface Tally {
	identity: SolverIdentity;
	/** Submission addresses seen in the covered data. */
	seen: Set<string>;
	batches: number[];
	trades: number[];
	swaps: number[];
	gas: number[];
	cost: number[];
	volume: number[];
	surplus: number[];
	surplusTrades: number[];
	surplusVolume: number[];
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
	// Surplus also needs order terms, which the terms backfill reads newest first: it covers the
	// days after the newest transaction still unread.
	const unread = store.newestTxWithoutTerms();
	const surplusDays =
		unread === null ? auctionDays : Math.min(auctionDays, bucketOf(end, unread));
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
				swaps: zeros(chainDays),
				gas: zeros(chainDays),
				cost: zeros(chainDays),
				volume: zeros(auctionDays),
				surplus: zeros(surplusDays),
				surplusTrades: zeros(surplusDays),
				surplusVolume: zeros(surplusDays),
				entered: zeros(auctionDays),
				won: zeros(auctionDays),
				latest: [],
			};
			tallies.set(identity.id, entry);
		}
		return entry;
	};

	const stats: SnapshotStats = {
		trades: 0,
		unpriced: 0,
		oneSided: 0,
		surplusPriced: 0,
		noSurplus: 0,
		uncosted: 0,
	};

	const creditedTo = new Map<string, Tally>();
	// The latest batches of all solvers together, oldest first.
	const networkLatest: Batch[] = [];
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
			entry.swaps[d] += batch.swaps;
			entry.gas[d] += batch.gas;
			if (batch.cost === null) stats.uncosted++;
			else entry.cost[d] += batch.cost;
			entry.latest.push(batch);
			if (entry.latest.length > LATEST_SETTLEMENTS) entry.latest.shift();
			networkLatest.push(batch);
			if (networkLatest.length > LATEST_NETWORK_SETTLEMENTS) networkLatest.shift();
			creditedTo.set(`${batch.tx}:${batch.logIndex}`, entry);
		}
	}

	const valuer = new TradeValuer(store);
	const count = zeros(auctionDays);
	const solutions = zeros(auctionDays);
	if (auctionDays > 0) {
		const range = { from: windowStart(end, auctionDays), to: end };
		for (const trade of store.tradeRows(range)) {
			const { usd, pricedSides, surplus } = valuer.value(trade);
			stats.trades++;
			if (usd === null) stats.unpriced++;
			else if (pricedSides === 1) stats.oneSided++;
			const d = bucketOf(end, trade.block);
			const entry = creditedTo.get(`${trade.tx}:${trade.settlementLogIndex}`);
			if (usd === null || !entry) continue;
			entry.volume[d] += usd;
			if (d >= surplusDays) continue;
			stats.surplusPriced++;
			if (surplus === null) {
				stats.noSurplus++;
			} else {
				entry.surplus[d] += surplus;
				entry.surplusTrades[d]++;
				entry.surplusVolume[d] += usd;
			}
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

	// The trades of every listed settlement: the network's latest and each solver's latest.
	const listed = [...networkLatest, ...[...tallies.values()].flatMap((entry) => entry.latest)];
	const tradesOf = new Map<Batch, TradeValueRow[]>();
	for (const batch of listed) {
		if (!tradesOf.has(batch)) {
			tradesOf.set(batch, store.settlementTrades(batch.tx, batch.logIndex));
		}
	}
	const symbols = await options.symbols(
		[...tradesOf.values()].flatMap(([first]) => [first.sellToken, first.buyToken])
	);
	const symbol = (token: string) => symbols.get(token) ?? shortAddress(token);
	const summary = (batch: Batch): SettlementSummary => {
		const trades = tradesOf.get(batch)!;
		const values = trades.map((trade) => valuer.value(trade));
		const priced = values.flatMap(({ usd }) => (usd === null ? [] : [usd]));
		const surpluses = values.flatMap(({ surplus }) => (surplus === null ? [] : [surplus]));
		return {
			tx: batch.tx,
			block: batch.block,
			time: timeOf(batch.block) * 1000,
			trades: batch.trades,
			swaps: batch.swaps,
			pair: { sell: symbol(trades[0].sellToken), buy: symbol(trades[0].buyToken) },
			volume: priced.length === 0 ? null : cents(sum(priced)),
			surplus: surpluses.length === 0 ? null : subCents(sum(surpluses)),
			gas: Math.round(batch.gas),
			cost: batch.cost === null ? null : subCents(batch.cost),
		};
	};

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
			swaps: entry.swaps,
			gas: entry.gas.map(Math.round),
			volume: entry.volume.map(cents),
			surplus: entry.surplus.map(subCents),
			surplusTrades: entry.surplusTrades,
			surplusVolume: entry.surplusVolume.map(cents),
			cost: entry.cost.map(subCents),
			entered: entry.entered,
			won: entry.won,
			latestSettlements: entry.latest.toReversed().map(summary),
		}));

	const latestSettlements: CreditedSettlement[] = networkLatest
		.toReversed()
		.map((batch) => ({ ...summary(batch), solver: batch.solver.id }));

	const registered: RegisteredSolver[] = registry
		.solvers()
		.map(({ id, name, entries }) => {
			const history = tallies.get(id);
			const last = history?.latest.at(-1);
			return {
				id,
				name,
				active: entries.some((entry) => entry.active),
				addresses: entries
					.toSorted(addressOrder)
					.map(({ env, address, active }) => ({ env, address, active })),
				lastSettlement: last
					? { tx: last.tx, block: last.block, time: timeOf(last.block) * 1000 }
					: null,
				batches: history ? sum(history.batches) : 0,
			};
		})
		.sort(
			(a, b) =>
				(b.lastSettlement?.block ?? -1) - (a.lastSettlement?.block ?? -1) ||
				Number(b.active) - Number(a.active) ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id)
		);

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
		coverage: { chainDays, auctionDays, surplusDays },
		auctions: { count, solutions },
		solvers,
		latestAuctions,
		latestSettlements,
		registry: registered,
	} satisfies Snapshot;
	return { snapshot, stats };
}

/**
 * Registered addresses that are active or seen in the data, prod before barn. For a solver the
 * registry lacks, the addresses seen in the data, listed as prod.
 */
function addressesOf(entry: Tally, registry: Registry): SolverAddress[] {
	const registered = registry.addresses(entry.identity.id);
	if (registered.length === 0)
		return [...entry.seen].map((address) => ({ env: "prod", address }));
	return registered
		.filter((address) => address.active || entry.seen.has(address.address))
		.sort(addressOrder)
		.map(({ env, address }) => ({ env, address }));
}

/** Prod before barn, active before inactive, then by address. */
function addressOrder(a: RegistryEntry, b: RegistryEntry): number {
	return (
		Number(a.env === "barn") - Number(b.env === "barn") ||
		Number(b.active) - Number(a.active) ||
		a.address.localeCompare(b.address)
	);
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

/** USD to a hundredth of a cent: a batch often costs less than a cent. */
function subCents(usd: number): number {
	return Math.round(usd * 10_000) / 10_000;
}
