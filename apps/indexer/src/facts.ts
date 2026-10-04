import { ROUTER } from "./chain.ts";
import { ethUsdAt } from "./prices.ts";
import type { PricePoint } from "./prices.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import {
	batchCostUsd,
	creditedAddress,
	priceToken,
	tradeSurplus,
	tradeVolumeUsd,
} from "./rules.ts";
import type { BlockRange, TradeSurplus } from "./rules.ts";
import type { SolutionRow, Store, TradeValueRow } from "./store.ts";

/** Stored rows turned into methodology facts, shared by the snapshot and the window report. */

export interface Batch {
	tx: string;
	logIndex: number;
	block: number;
	/** The credited submission address. */
	address: string;
	solver: SolverIdentity;
	viaRouter: boolean;
	trades: number;
	/** DEX swaps: Interaction events other than approvals and WETH unwraps. */
	swaps: number;
	/** Gas used by the transaction, split evenly if it holds several batches. */
	gas: number;
	/** The transaction's cost in USD, split the same way; null without an ETH/USD rate. */
	cost: number | null;
}

/** The batches of a block range in block order, credited and costed, read one at a time. */
export function* creditedBatches(
	store: Store,
	registry: Registry,
	range: BlockRange
): Generator<Batch> {
	const points = store.ethUsdPoints();
	for (const row of store.batchRows(range)) {
		const address = creditedAddress(
			{
				solver: row.solver,
				sender: row.sender,
				senderIsSolver: row.senderIsSolver === 1,
				recipient: row.recipient,
				recipientIsSolver: row.recipientIsSolver === 1,
			},
			(candidate) => registry.has(candidate),
			() => store.apiWinner(row.tx)
		);
		const ethUsd = ethUsdAt(points, row.block);
		yield {
			tx: row.tx,
			logIndex: row.logIndex,
			block: row.block,
			address,
			solver: registry.identify(address),
			viaRouter: row.solver === ROUTER,
			trades: row.trades,
			swaps: row.swaps,
			gas: row.gasUsed / row.txBatches,
			cost: ethUsd === null ? null : batchCostUsd(row, ethUsd),
		};
	}
}

export interface TradeValue {
	/** USD, or null when the trade is unpriced. */
	usd: number | null;
	/** How many of the trade's two sides had a native price. */
	pricedSides: number;
	/** Trader surplus (see tradeSurplus); null when unpriced or without order terms. */
	surplus: TradeSurplus | null;
}

/** Values trades with their own auction's native prices and ETH/USD at their block. */
export class TradeValuer {
	readonly #store: Store;
	readonly #points: PricePoint[];
	readonly #prices = new Map<number, Map<string, string>>();

	constructor(store: Store) {
		this.#store = store;
		this.#points = store.ethUsdPoints();
	}

	value(trade: TradeValueRow): TradeValue {
		if (trade.auctionId === null) return { usd: null, pricedSides: 0, surplus: null };
		let prices = this.#prices.get(trade.auctionId);
		if (!prices) {
			if (this.#prices.size >= 4_096) this.#prices.clear();
			prices = this.#store.auctionPrices(trade.auctionId);
			this.#prices.set(trade.auctionId, prices);
		}
		const sellPrice = prices.get(priceToken(trade.sellToken)) ?? null;
		const buyPrice = prices.get(priceToken(trade.buyToken)) ?? null;
		const ethUsd = ethUsdAt(this.#points, trade.block);
		const usd =
			ethUsd === null
				? null
				: tradeVolumeUsd(trade.sellAmount, sellPrice, trade.buyAmount, buyPrice, ethUsd);
		return {
			usd,
			pricedSides: usd === null ? 0 : Number(sellPrice !== null) + Number(buyPrice !== null),
			surplus: tradeSurplus(usd, trade),
		};
	}
}

/** A solver that submitted at least one solution to an auction (filtered-out ones included). */
interface Entrant {
	identity: SolverIdentity;
	addresses: Set<string>;
}

export interface AuctionOutcome {
	id: number;
	startBlock: number;
	solutions: number;
	/** By solver id, best rank first. */
	entrants: Map<string, Entrant>;
	/** One entry per winning solver id, best rank first. */
	winners: { solver: string; tx: string | null }[];
}

/**
 * Groups solution rows (sorted by auction, then ranking) into auctions keyed by solver id, and
 * yields each auction once its rows are read.
 */
export function* auctionOutcomes(
	rows: Iterable<SolutionRow>,
	registry: Registry
): Generator<AuctionOutcome> {
	let current: AuctionOutcome | null = null;
	for (const row of rows) {
		if (current === null || current.id !== row.auctionId) {
			if (current !== null) yield current;
			current = {
				id: row.auctionId,
				startBlock: row.startBlock,
				solutions: 0,
				entrants: new Map(),
				winners: [],
			};
		}
		const identity = registry.identify(row.solver);
		current.solutions++;
		const entrant = current.entrants.get(identity.id);
		if (entrant) entrant.addresses.add(row.solver);
		else current.entrants.set(identity.id, { identity, addresses: new Set([row.solver]) });
		if (row.winner === 1 && !current.winners.some((winner) => winner.solver === identity.id)) {
			current.winners.push({ solver: identity.id, tx: row.tx });
		}
	}
	if (current !== null) yield current;
}
