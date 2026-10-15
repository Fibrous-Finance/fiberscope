import type {
	AuctionSolution,
	AuctionSummary,
	CreditedSettlement,
	RegisteredSolver,
	SettlementSummary,
	Snapshot,
	SnapshotSolver,
	SolverAddress,
} from "@fiberscope/core";

import { RELAYS } from "./chain.ts";
import { NETWORK } from "./config.ts";
import { auctionOutcomes, creditedBatches, tradeFees, TradeValuer } from "./facts.ts";
import type { Batch } from "./facts.ts";
import { shortAddress } from "./log.ts";
import { nativeUsdAt } from "./prices.ts";
import type { Registry, RegistryEntry, SolverIdentity } from "./registry.ts";
import { auctionLosses, Days, quoteSolver } from "./rules.ts";
import type { RankedSolution } from "./rules.ts";
import type { Store, TradeDetailRow, TradeValueRow } from "./store.ts";

const LATEST_AUCTIONS = 48;
const LATEST_SETTLEMENTS = 6;
const LATEST_NETWORK_SETTLEMENTS = 50;

export interface SnapshotOptions {
	store: Store;
	registry: Registry;
	refreshMinutes: number;
	/** The indexer's commit, written into the snapshot; null when unknown. */
	commit: string | null;
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
	/** Of the trades with a surplus, the unusual ones (more than a tenth of their value). */
	unusual: number;
	/** Batches in the chain coverage without the native token's USD price, so without a cost. */
	uncosted: number;
	/** Trades in the detail coverage. */
	detailTrades: number;
	/** Of those, trades whose order's quote names no solver. */
	unnamedQuotes: number;
	/** Of those, trades whose protocol fees are unknown. */
	unknownFees: number;
	/** Fees on those trades that could not be valued. */
	unvaluedFees: number;
	/** Fees on those trades not marked as either CoW's own or a partner's. */
	unsplitFees: number;
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
	unusualSurplus: number[];
	unusualTrades: number[];
	unusualVolume: number[];
	entered: number[];
	won: number[];
	solutions: number[];
	filteredOut: number[];
	losses: number[];
	closeLosses: number[];
	quotes: number[];
	quotesVerified: number[];
	quotesSettled: number[];
	protocolFees: number[];
	partnerFees: number[];
	/** The latest batches, oldest first. */
	latest: Batch[];
}

/** The whole days of each kind of data a snapshot ending at `days.end` shows. */
export function coverage(store: Store, days: Days): Snapshot["coverage"] {
	const chainDays = days.completeBuckets(store.chainRange());
	const auctionDays = Math.min(chainDays, days.completeBuckets(store.auctionRange()));
	// Surplus also needs order terms, read from each trade's calldata as it is stored.
	const surplusDays = auctionDays;
	// Scores, quotes and fees are looked up in CoW's API after the auction data.
	const detailDays = Math.min(auctionDays, days.completeBuckets(store.detailRange()));
	return { chainDays, auctionDays, surplusDays, detailDays };
}

/** Builds the snapshot from stored rows; buckets are cut fresh at every call. */
export async function buildSnapshot(
	options: SnapshotOptions
): Promise<{ snapshot: Snapshot; stats: SnapshotStats }> {
	const { store, registry } = options;
	const chain = store.chainRange();
	if (chain === null) throw new Error("The database holds no chain data: run sync first");
	const end = chain.to;
	const clock = store.clock();
	const days = new Days(clock, end);
	const { chainDays, auctionDays, surplusDays, detailDays } = coverage(store, days);
	const auctionRange = store.auctionRange();
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
				unusualSurplus: zeros(surplusDays),
				unusualTrades: zeros(surplusDays),
				unusualVolume: zeros(surplusDays),
				entered: zeros(auctionDays),
				won: zeros(auctionDays),
				solutions: zeros(detailDays),
				filteredOut: zeros(detailDays),
				losses: zeros(detailDays),
				closeLosses: zeros(detailDays),
				quotes: zeros(detailDays),
				quotesVerified: zeros(detailDays),
				quotesSettled: zeros(detailDays),
				protocolFees: zeros(detailDays),
				partnerFees: zeros(detailDays),
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
		unusual: 0,
		uncosted: 0,
		detailTrades: 0,
		unnamedQuotes: 0,
		unknownFees: 0,
		unvaluedFees: 0,
		unsplitFees: 0,
	};

	// The native token's USD price points, read once for every batch's cost and trade's value.
	const points = store.nativeUsdPoints();
	// Trades follow their batch's credit: a relay batch's by its block and log index, any other
	// to the solver that settled it.
	const relayed = new Map<string, Tally>();
	// The latest batches of all solvers together, oldest first.
	const networkLatest: Batch[] = [];
	if (chainDays > 0) {
		const range = { from: days.windowStart(chainDays), to: end };
		for (const batch of creditedBatches(store, registry, range, points)) {
			const d = days.bucketOf(batch.block);
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
			if (batch.relay !== null) relayed.set(`${batch.block}:${batch.logIndex}`, entry);
		}
	}
	// The tally a trade's batch is credited to.
	const creditOf = (trade: { solver: string; block: number; settlementLogIndex: number }) =>
		RELAYS.includes(trade.solver)
			? relayed.get(`${trade.block}:${trade.settlementLogIndex}`)
			: tallies.get(registry.identify(trade.solver).id);

	const valuer = new TradeValuer(points);
	const count = zeros(auctionDays);
	const solutions = zeros(auctionDays);
	if (auctionDays > 0) {
		const range = { from: days.windowStart(auctionDays), to: end };
		for (const trade of store.tradeRows(range)) {
			const { usd, pricedSides, surplus } = valuer.value(trade);
			stats.trades++;
			if (usd === null) stats.unpriced++;
			else if (pricedSides === 1) stats.oneSided++;
			const d = days.bucketOf(trade.block);
			const entry = creditOf(trade);
			if (usd === null || !entry) continue;
			entry.volume[d] += usd;
			if (d >= surplusDays) continue;
			stats.surplusPriced++;
			if (surplus === null) {
				stats.noSurplus++;
				continue;
			}
			entry.surplus[d] += surplus.usd;
			entry.surplusTrades[d]++;
			entry.surplusVolume[d] += usd;
			if (surplus.unusual) {
				stats.unusual++;
				entry.unusualSurplus[d] += surplus.usd;
				entry.unusualTrades[d]++;
				entry.unusualVolume[d] += usd;
			}
		}
		for (const auction of auctionOutcomes(store.solutionsByStart(range), registry)) {
			const d = days.bucketOf(auction.startBlock);
			if (d < 0) continue;
			count[d]++;
			solutions[d] += auction.solutions;
			const detailed = d < detailDays && auction.scored;
			for (const entrant of auction.entrants.values()) {
				const entry = tally(entrant.identity);
				entry.entered[d]++;
				for (const address of entrant.addresses) entry.seen.add(address);
				if (!detailed) continue;
				entry.solutions[d] += entrant.solutions;
				entry.filteredOut[d] += entrant.filteredOut;
			}
			for (const winner of auction.winners) tallies.get(winner.solver)!.won[d]++;
			if (!detailed) continue;
			for (const [solver, close] of auctionLosses(auction.ranked)) {
				const entry = tallies.get(solver)!;
				entry.losses[d]++;
				if (close) entry.closeLosses[d]++;
			}
		}
	}

	// Quotes count for the solver that gave them, fees for the solver that settled the trade.
	if (detailDays > 0) {
		const range = { from: days.windowStart(detailDays), to: end };
		for (const trade of store.tradeDetails(range)) {
			stats.detailTrades++;
			const d = days.bucketOf(trade.block);
			const settler = creditOf(trade);
			const quoter = quoteSolver(trade.quoteSolver);
			if (quoter !== null) {
				const entry = tally(registry.identify(quoter));
				entry.quotes[d]++;
				if (trade.quoteVerified === 1) entry.quotesVerified[d]++;
				if (entry === settler) entry.quotesSettled[d]++;
			} else if (trade.quoteSolver !== null) stats.unnamedQuotes++;
			if (trade.feesChecked !== 1) stats.unknownFees++;
			if (!settler) continue;
			for (const fee of tradeFees(trade, valuer)) {
				if (fee.usd === null) stats.unvaluedFees++;
				else if (fee.partner === null) stats.unsplitFees++;
				else if (fee.partner) settler.partnerFees[d] += fee.usd;
				else settler.protocolFees[d] += fee.usd;
			}
		}
	}

	// The trades of every listed settlement: the network's latest and each solver's latest.
	const listed = [...networkLatest, ...[...tallies.values()].flatMap((entry) => entry.latest)];
	const tradesOf = new Map<Batch, TradeValueRow[]>();
	const detailsOf = new Map<Batch, TradeDetailRow[]>();
	for (const batch of listed) {
		if (!tradesOf.has(batch)) {
			tradesOf.set(batch, store.settlementTrades(batch.block, batch.logIndex));
			detailsOf.set(batch, store.settlementDetails(batch.block, batch.logIndex));
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
		const surpluses = values.flatMap(({ surplus }) => (surplus === null ? [] : [surplus.usd]));
		const row: SettlementSummary = {
			tx: batch.tx,
			block: batch.block,
			time: clock.time(batch.block) * 1000,
			trades: batch.trades,
			swaps: batch.swaps,
			pair: { sell: symbol(trades[0].sellToken), buy: symbol(trades[0].buyToken) },
			volume: priced.length === 0 ? null : cents(sum(priced)),
			surplus: surpluses.length === 0 ? null : subCents(sum(surpluses)),
			gas: Math.round(batch.gas),
			cost: batch.cost === null ? null : subCents(batch.cost),
		};
		// The quote of the first trade's order, once the order was looked up.
		const [first] = detailsOf.get(batch)!;
		if (first.found !== null) {
			const quoter = quoteSolver(first.quoteSolver);
			row.quotedBy = quoter === null ? null : registry.identify(quoter).id;
		}
		return row;
	};
	// A settlement's fees by kind, when every trade's fees are known, valued and marked.
	const feesOf = (batch: Batch): Pick<CreditedSettlement, "protocolFee" | "partnerFee"> => {
		const unknown = { protocolFee: null, partnerFee: null };
		let protocolFee = 0;
		let partnerFee = 0;
		for (const trade of detailsOf.get(batch)!) {
			if (trade.feesChecked !== 1) return unknown;
			for (const fee of tradeFees(trade, valuer)) {
				if (fee.usd === null || fee.partner === null) return unknown;
				if (fee.partner) partnerFee += fee.usd;
				else protocolFee += fee.usd;
			}
		}
		return { protocolFee: subCents(protocolFee), partnerFee: subCents(partnerFee) };
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
			unusualSurplus: entry.unusualSurplus.map(subCents),
			unusualTrades: entry.unusualTrades,
			unusualVolume: entry.unusualVolume.map(cents),
			cost: entry.cost.map(subCents),
			entered: entry.entered,
			won: entry.won,
			solutions: entry.solutions,
			filteredOut: entry.filteredOut,
			losses: entry.losses,
			closeLosses: entry.closeLosses,
			quotes: entry.quotes,
			quotesVerified: entry.quotesVerified,
			quotesSettled: entry.quotesSettled,
			protocolFees: entry.protocolFees.map(subCents),
			partnerFees: entry.partnerFees.map(subCents),
			latestSettlements: entry.latest.toReversed().map(summary),
		}));

	const latestSettlements: CreditedSettlement[] = networkLatest
		.toReversed()
		.map((batch) => ({ ...summary(batch), solver: batch.solver.id, ...feesOf(batch) }));

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
					? { tx: last.tx, block: last.block, time: clock.time(last.block) * 1000 }
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

	const latestAuctions: AuctionSummary[] = [
		...auctionOutcomes(
			auctionRange ? store.latestSolutions(auctionRange, LATEST_AUCTIONS) : [],
			registry
		),
	].map((auction) => {
		const nativeUsd = nativeUsdAt(points, auction.startBlock);
		return {
			id: auction.id,
			time: clock.time(auction.startBlock) * 1000,
			entered: [...auction.entrants.keys()],
			winners: auction.winners,
			solutions: auction.ranked.map((solution) => listedSolution(solution, nativeUsd)),
		};
	});

	const snapshot = {
		schema: 1,
		network: NETWORK.id,
		builtAt: Date.now(),
		commit: options.commit ?? undefined,
		end: { block: end, time: clock.time(end) * 1000 },
		lastRunAt,
		refreshMinutes: options.refreshMinutes,
		coverage: { chainDays, auctionDays, surplusDays, detailDays },
		auctions: { count, solutions },
		solvers,
		latestAuctions,
		latestSettlements,
		registry: registered,
	} satisfies Snapshot;
	return { snapshot, stats };
}

/**
 * A solution as the snapshot lists it: its score in USD at the native token's USD price when the
 * auction started, to 6 significant figures (enough to tell scores 0.001% apart), and its flags
 * only when set.
 */
function listedSolution(solution: RankedSolution, nativeUsd: number | null): AuctionSolution {
	const score =
		solution.score === null || nativeUsd === null
			? null
			: Number(((Number(solution.score) / 1e18) * nativeUsd).toPrecision(6));
	const listed: AuctionSolution = { solver: solution.solver, score };
	if (solution.filteredOut) listed.filteredOut = true;
	if (solution.winner) listed.winner = true;
	return listed;
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
