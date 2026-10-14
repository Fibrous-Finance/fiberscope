import { relayOf } from "./chain.ts";
import type { Relay } from "./chain.ts";
import { nativeUsdAt } from "./prices.ts";
import type { PricePoint } from "./prices.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import {
	batchCostUsd,
	creditedAddress,
	feeUsd,
	priceToken,
	tradeSurplus,
	tradeVolumeUsd,
} from "./rules.ts";
import type { BlockRange, CreditSource, RankedSolution, TradeSurplus } from "./rules.ts";
import type { SolutionRow, Store, TradeDetailRow, TradeValueRow } from "./store.ts";

/** Stored rows turned into methodology facts, shared by the snapshot and the window report. */

export interface Batch {
	tx: string;
	logIndex: number;
	block: number;
	/** The credited submission address. */
	address: string;
	/** How that address was chosen (see creditedAddress). */
	credit: CreditSource;
	solver: SolverIdentity;
	/** The kind of relay that settled it for its solver; null when the solver called `settle`. */
	relay: Relay | null;
	trades: number;
	/** DEX swaps: Interaction events other than approvals and unwraps. */
	swaps: number;
	/** Gas used by the transaction, split evenly if it holds several batches. */
	gas: number;
	/** The transaction's cost in USD, split the same way; null without the native token's price. */
	cost: number | null;
}

/** The batches of a block range in block order, credited and costed, read one at a time. */
export function* creditedBatches(
	store: Store,
	registry: Registry,
	range: BlockRange
): Generator<Batch> {
	const points = store.nativeUsdPoints();
	for (const row of store.batchRows(range)) {
		const credited = creditedAddress(
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
		const nativeUsd = nativeUsdAt(points, row.block);
		const address = credited.address;
		yield {
			tx: row.tx,
			logIndex: row.logIndex,
			block: row.block,
			address,
			credit: credited.source,
			solver: registry.identify(address),
			relay: relayOf(row.solver),
			trades: row.trades,
			swaps: row.swaps,
			gas: row.gasUsed / row.txBatches,
			cost: nativeUsd === null ? null : batchCostUsd(row, nativeUsd),
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

/** What valuing a trade needs: its auction, its block and its two sides. */
export type PricedTrade = Pick<
	TradeValueRow,
	"auctionId" | "block" | "sellToken" | "buyToken" | "sellAmount" | "buyAmount"
>;

/**
 * Values trades with their own auction's native prices and the native token's USD price at their
 * block.
 */
export class TradeValuer {
	readonly #store: Store;
	readonly #points: PricePoint[];
	readonly #prices = new Map<number, Map<string, string>>();

	constructor(store: Store) {
		this.#store = store;
		this.#points = store.nativeUsdPoints();
	}

	value(trade: TradeValueRow): TradeValue {
		const { usd, sellPrice, buyPrice } = this.#priced(trade);
		return {
			usd,
			pricedSides: usd === null ? 0 : Number(sellPrice !== null) + Number(buyPrice !== null),
			surplus: tradeSurplus(usd, trade),
		};
	}

	/** A trade's USD value alone (see value). */
	usd(trade: PricedTrade): number | null {
		return this.#priced(trade).usd;
	}

	#priced(trade: PricedTrade): {
		usd: number | null;
		sellPrice: string | null;
		buyPrice: string | null;
	} {
		if (trade.auctionId === null) return { usd: null, sellPrice: null, buyPrice: null };
		const prices = this.#pricesOf(trade.auctionId);
		const sellPrice = prices.get(priceToken(trade.sellToken)) ?? null;
		const buyPrice = prices.get(priceToken(trade.buyToken)) ?? null;
		const nativeUsd = nativeUsdAt(this.#points, trade.block);
		const usd =
			nativeUsd === null
				? null
				: tradeVolumeUsd(trade.sellAmount, sellPrice, trade.buyAmount, buyPrice, nativeUsd);
		return { usd, sellPrice, buyPrice };
	}

	#pricesOf(auctionId: number): Map<string, string> {
		let prices = this.#prices.get(auctionId);
		if (!prices) {
			if (this.#prices.size >= 4_096) this.#prices.clear();
			prices = this.#store.auctionPrices(auctionId);
			this.#prices.set(auctionId, prices);
		}
		return prices;
	}
}

/** A protocol fee of a trade: whether it is a partner fee, and its USD value. */
export interface TradeFee {
	/** Null when it is unclear whether it is a partner fee or CoW's own. */
	partner: boolean | null;
	/** At the trade's exchange rate (see feeUsd); null when it cannot be valued. */
	usd: number | null;
}

/** The protocol fees stored for a trade (see Store.tradeDetails), valued. */
export function tradeFees(trade: TradeDetailRow, valuer: TradeValuer): TradeFee[] {
	if (trade.fees === null) return [];
	const tradeUsd = valuer.usd(trade);
	return trade.fees.split(",").map((item) => {
		const [partner, amount, token] = item.split(" ");
		return {
			partner: partner === "?" ? null : partner === "1",
			usd: tradeUsd === null ? null : feeUsd({ token, amount }, trade, tradeUsd),
		};
	});
}

/** A solver that submitted at least one solution to an auction (filtered-out ones included). */
interface Entrant {
	identity: SolverIdentity;
	addresses: Set<string>;
	/** Its solutions in the auction. */
	solutions: number;
	/** Those of them CIP-67's filter removed. */
	filteredOut: number;
}

export interface AuctionOutcome {
	id: number;
	startBlock: number;
	solutions: number;
	/** Whether its solutions carry their scores and filter outcomes. */
	scored: boolean;
	/** By solver id, best rank first. */
	entrants: Map<string, Entrant>;
	/** One entry per winning solver id, best rank first. */
	winners: { solver: string; tx: string | null }[];
	/** Every solution in CoW's ranking, with its solver's id. */
	ranked: RankedSolution[];
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
				scored: row.filteredOut !== null,
				entrants: new Map(),
				winners: [],
				ranked: [],
			};
		}
		const identity = registry.identify(row.solver);
		current.solutions++;
		let entrant = current.entrants.get(identity.id);
		if (!entrant) {
			entrant = { identity, addresses: new Set(), solutions: 0, filteredOut: 0 };
			current.entrants.set(identity.id, entrant);
		}
		entrant.addresses.add(row.solver);
		entrant.solutions++;
		if (row.filteredOut === 1) entrant.filteredOut++;
		current.ranked.push({
			solver: identity.id,
			score: row.score,
			filteredOut: row.filteredOut === 1,
			winner: row.winner === 1,
		});
		if (row.winner === 1 && !current.winners.some((winner) => winner.solver === identity.id)) {
			current.winners.push({ solver: identity.id, tx: row.tx });
		}
	}
	if (current !== null) yield current;
}
