import { ROUTER } from "./chain.ts";
import { ethUsdAt } from "./prices.ts";
import type { PricePoint } from "./prices.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import { creditedAddress, priceToken, tradeVolumeUsd } from "./rules.ts";
import type { BlockRange } from "./rules.ts";
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
	/** Gas used by the transaction, split evenly if it holds several batches. */
	gas: number;
}

export function loadBatches(store: Store, registry: Registry, range: BlockRange): Batch[] {
	return store.batchRows(range).map((row) => {
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
		return {
			tx: row.tx,
			logIndex: row.logIndex,
			block: row.block,
			address,
			solver: registry.identify(address),
			viaRouter: row.solver === ROUTER,
			trades: row.trades,
			gas: row.gasUsed / row.txBatches,
		};
	});
}

export interface TradeValue {
	/** USD, or null when the trade is unpriced. */
	usd: number | null;
	/** How many of the trade's two sides had a native price. */
	pricedSides: number;
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
		if (trade.auctionId === null) return { usd: null, pricedSides: 0 };
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
		};
	}
}

/** A solver that submitted at least one solution to an auction (filtered-out ones included). */
export interface Entrant {
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

/** Groups solution rows (sorted by auction, then ranking) into auctions keyed by solver id. */
export function auctionOutcomes(rows: SolutionRow[], registry: Registry): AuctionOutcome[] {
	const outcomes: AuctionOutcome[] = [];
	let current: AuctionOutcome | null = null;
	for (const row of rows) {
		if (current === null || current.id !== row.auctionId) {
			current = {
				id: row.auctionId,
				startBlock: row.startBlock,
				solutions: 0,
				entrants: new Map(),
				winners: [],
			};
			outcomes.push(current);
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
	return outcomes;
}
