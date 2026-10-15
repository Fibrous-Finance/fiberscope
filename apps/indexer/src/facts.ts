import { relayOf } from "./chain.ts";
import type { Relay } from "./chain.ts";
import { nativeUsdAt } from "./prices.ts";
import type { PricePoint } from "./prices.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import { batchCostUsd, creditedAddress, feeUsd, tradeSurplus, tradeVolumeUsd } from "./rules.ts";
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

/**
 * The batches of a block range in block order, credited and costed, read one at a time. `points`
 * are the native token's USD price points (Store.nativeUsdPoints), for a caller that has them.
 */
export function* creditedBatches(
	store: Store,
	registry: Registry,
	range: BlockRange,
	points: PricePoint[] = store.nativeUsdPoints()
): Generator<Batch> {
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

/** What valuing a trade needs: its block and its two sides with their native prices. */
export type PricedTrade = Pick<
	TradeValueRow,
	"block" | "sellAmount" | "sellPrice" | "buyAmount" | "buyPrice"
>;

/**
 * Values trades with their own auction's native prices, which their rows carry, and the native
 * token's USD price at their block.
 */
export class TradeValuer {
	readonly #points: PricePoint[];

	/** `points`: the native token's USD price points, sorted by block (Store.nativeUsdPoints). */
	constructor(points: PricePoint[]) {
		this.#points = points;
	}

	value(trade: TradeValueRow): TradeValue {
		const usd = this.usd(trade);
		return {
			usd,
			pricedSides:
				usd === null
					? 0
					: Number(trade.sellPrice !== null) + Number(trade.buyPrice !== null),
			surplus: tradeSurplus(usd, trade),
		};
	}

	/** A trade's USD value alone (see value); null when it is unpriced. */
	usd(trade: PricedTrade): number | null {
		const nativeUsd = nativeUsdAt(this.#points, trade.block);
		return nativeUsd === null
			? null
			: tradeVolumeUsd(
					trade.sellAmount,
					trade.sellPrice,
					trade.buyAmount,
					trade.buyPrice,
					nativeUsd
				);
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
	/** By solver id, in the rows' order: best rank first when they come by ranking. */
	entrants: Map<string, Entrant>;
	/** One entry per winning solver id, in the rows' order as entrants are. */
	winners: { solver: string; tx: string | null }[];
	/** Every solution with its solver's id, in the rows' order: CoW's ranking when they come by it. */
	ranked: RankedSolution[];
}

/**
 * Groups solution rows, which come auction by auction, into auctions keyed by solver id, and
 * yields each auction once its rows are read. The counts do not depend on the order of an
 * auction's rows; the lists follow it, so a caller that lists them reads the rows by ranking
 * (Store.latestSolutions).
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
