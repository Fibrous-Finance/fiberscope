import { ROUTER } from "./chain.ts";
import type { Clock } from "./clock.ts";
import { NATIVE_TOKEN, NETWORK } from "./config.ts";

/** The published methodology as pure functions: buckets, attribution, volume, surplus and cost. */

export interface BlockRange {
	from: number;
	to: number;
}

/** Seconds in a rolling day. */
const DAY = 86_400;

/** How much deeper a backfill goes where its depth is estimated, as a share of the estimate. */
const REACH_MARGIN = 0.01;

/**
 * Rolling days that end at E, the time of block `end`: bucket d holds the blocks whose time lies
 * in (E − (d + 1) days, E − d days], so a block's bucket follows its time, however fast the
 * blocks came. On Base, a block every 2 seconds, a day is 43,200 blocks.
 */
export class Days {
	readonly end: number;
	readonly #clock: Clock;
	readonly #endTime: number;

	constructor(clock: Clock, end: number) {
		this.end = end;
		this.#clock = clock;
		this.#endTime = clock.time(end);
	}

	/** The bucket of a block; -1 after `end`. */
	bucketOf(block: number): number {
		if (block > this.end) return -1;
		return Math.floor((this.#endTime - this.#clock.time(block)) / DAY);
	}

	/** The first block of the window made of `days` buckets: the first block after E − days. */
	windowStart(days: number): number {
		return this.#clock.firstBlockAfter(this.#endTime - days * DAY);
	}

	/**
	 * How many buckets, counting from bucket 0, an ingested range holds entirely: those every
	 * block before the range is older than. Zero when the range stops short of `end`, since bucket
	 * 0 is then incomplete.
	 */
	completeBuckets(range: BlockRange | null): number {
		if (range === null || range.to < this.end || range.from > this.end) return 0;
		return Math.floor((this.#endTime - this.#clock.time(range.from - 1)) / DAY);
	}

	/**
	 * The block a backfill must reach down to for `days` buckets. Where the clock's anchors do
	 * not reach back as far, the window's start is only estimated, with the network's average
	 * block time, so the backfill goes deeper by REACH_MARGIN of the estimated blocks: the
	 * snapshot counts only whole buckets, so the extra blocks are harmless, and once they are
	 * ingested their anchors place the start.
	 */
	reach(days: number): number {
		const start = this.windowStart(days);
		const anchored = this.#clock.oldest!.block;
		if (start >= anchored) return start;
		return start - Math.ceil((anchored - start) * REACH_MARGIN);
	}
}

/** What attribution needs to know about a settlement. */
export interface SettlementParties {
	/** Topic 1 of the Settlement event: the address that called `settle`. */
	solver: string;
	/** The transaction's sender (`tx.from`). */
	sender: string;
	/** Whether the AllowList called the sender a solver; checked once per address (see ingest.ts). */
	senderIsSolver: boolean;
	/** The transaction's recipient (`tx.to`), or null when it is not known. */
	recipient: string | null;
	/** Whether the AllowList called the recipient a solver; checked once per address. */
	recipientIsSolver: boolean;
}

/**
 * How a settlement's credited address was chosen: the Settlement event's solver, or for a
 * flash-loan router settlement the transaction's recipient or sender, CoW's winning solution, or
 * the unverified sender.
 */
export type CreditSource = "event" | "recipient" | "sender" | "winner" | "unverified";

/**
 * The address credited with a settlement, and how it was chosen. The flash-loan router settles
 * on behalf of the auction winner, which calls it either from its own account or through its own
 * contract, sent from per-transaction helper accounts. So a router settlement goes to the
 * transaction's recipient when that is a registered or allow-listed solver other than the router
 * itself; else to the sender when it is registered or allow-listed; else to the competition's
 * winning solution for the transaction; and to the sender only if the competition is unknown too.
 */
export function creditedAddress(
	settlement: SettlementParties,
	isRegistered: (address: string) => boolean,
	apiWinner: () => string | null
): { address: string; source: CreditSource } {
	if (settlement.solver !== ROUTER) return { address: settlement.solver, source: "event" };
	const { recipient, sender } = settlement;
	if (recipient !== null && recipient !== ROUTER) {
		if (settlement.recipientIsSolver || isRegistered(recipient)) {
			return { address: recipient, source: "recipient" };
		}
	}
	if (settlement.senderIsSolver || isRegistered(sender))
		return { address: sender, source: "sender" };
	const winner = apiWinner();
	return winner === null
		? { address: sender, source: "unverified" }
		: { address: winner, source: "winner" };
}

/** The token whose native price values `token`: the native token is priced as its wrapped token. */
export function priceToken(token: string): string {
	return token === NATIVE_TOKEN ? NETWORK.native.wrapped : token;
}

/**
 * A trade's USD value: the lower of its sell side and buy side, each valued as amount × native
 * price / 1e36 native tokens (CoW native prices are in the native token's smallest unit per token
 * atom, scaled by 1e18), times the native token's USD price. A side with no price or a zero price
 * is unpriced. With one priced side, that side is used; with none, the trade has no value.
 */
export function tradeVolumeUsd(
	sellAmount: string,
	sellPrice: string | null,
	buyAmount: string,
	buyPrice: string | null,
	nativeUsd: number
): number | null {
	const sellNative = sellPrice === null ? 0n : BigInt(sellPrice);
	const buyNative = buyPrice === null ? 0n : BigInt(buyPrice);
	const sell = sellNative > 0n ? BigInt(sellAmount) * sellNative : null;
	const buy = buyNative > 0n ? BigInt(buyAmount) * buyNative : null;
	const lower = sell !== null && buy !== null ? (sell < buy ? sell : buy) : (sell ?? buy);
	return lower === null ? null : (Number(lower) / 1e36) * nativeUsd;
}

/**
 * A fee's USD value at its trade's own exchange rate: its share of the trade's amount in the fee's
 * token, times the trade's value. A single token's native price can be far off, which the trade's
 * value guards against by taking the lower of its two sides. Null when the fee is in neither of
 * the trade's tokens, or the trade's amount in it is zero.
 */
export function feeUsd(
	fee: { token: string; amount: string },
	trade: { sellToken: string; buyToken: string; sellAmount: string; buyAmount: string },
	tradeUsd: number
): number | null {
	const token = priceToken(fee.token);
	const side =
		token === priceToken(trade.buyToken)
			? trade.buyAmount
			: token === priceToken(trade.sellToken)
				? trade.sellAmount
				: null;
	if (side === null || BigInt(side) === 0n) return null;
	return (Number(BigInt(fee.amount)) / Number(BigInt(side))) * tradeUsd;
}

/** What surplus needs from a trade: its executed amounts and its order terms (see OrderTerms). */
export interface SurplusFacts {
	/** Sold, fee included. */
	sellAmount: string;
	buyAmount: string;
	limitSellAmount: string | null;
	limitBuyAmount: string | null;
	feeAmount: string | null;
}

/** A trade's surplus and how CoW classes it. */
export interface TradeSurplus {
	/** USD. */
	usd: number;
	/**
	 * More than a tenth of the trade's value: CoW's own split of trader surplus into "unusual"
	 * and "reasonable" (Dune query 1368423, "V3: Total User Surplus": surplus_usd > 0.1 ×
	 * usd_value). Unusual surplus comes from limits far from the market price, which say more
	 * about the order than about how well it was settled.
	 */
	unusual: boolean;
}

/**
 * A trade's surplus, the way Dune's CoW Protocol trades model computes `surplus_usd`: the
 * trade's USD value times how far its executed price beat its limit price,
 *
 *     (bought × limitSell − sold × limitBuy) ÷ (bought × limitSell)
 *
 * where bought and sold are the executed amounts, sold without the fee, and limitSell and
 * limitBuy are the signed order's amounts. The expression is the same for sell and buy orders,
 * and for whole and partial fills: it compares prices, not amounts. Since surplus is the value
 * times that ratio, it is unusual exactly when the ratio exceeds a tenth, whatever the prices,
 * so the class is decided on the amounts alone. Null when the trade has no USD value or its
 * order terms are unknown.
 */
export function tradeSurplus(usd: number | null, trade: SurplusFacts): TradeSurplus | null {
	const { limitSellAmount, limitBuyAmount, feeAmount } = trade;
	if (usd === null || limitSellAmount === null || limitBuyAmount === null || feeAmount === null) {
		return null;
	}
	const bought = BigInt(trade.buyAmount);
	const sold = BigInt(trade.sellAmount) - BigInt(feeAmount);
	const limit = bought * BigInt(limitSellAmount);
	if (limit === 0n) return null;
	const beat = limit - sold * BigInt(limitBuyAmount);
	return { usd: (usd * Number(beat)) / Number(limit), unusual: beat * 10n > limit };
}

/**
 * A batch's transaction cost in USD: its transaction's fee, gas used × effective gas price plus
 * Base's L1 data fee, in the native token at its USD price at the batch's block, split evenly
 * between the batches the transaction holds, as its gas is.
 */
export function batchCostUsd(tx: { fee: string; txBatches: number }, nativeUsd: number): number {
	return (Number(BigInt(tx.fee)) / 1e18 / tx.txBatches) * nativeUsd;
}

/** A solution of an auction, as the loss rules read it. */
export interface RankedSolution {
	/** Id of the solver that submitted it. */
	solver: string;
	/** Its score (CIP-20) in wei of the native token; null when CoW's API gave none. */
	score: string | null;
	/** Whether CIP-67's fairness filter removed it. */
	filteredOut: boolean;
	winner: boolean;
}

/**
 * The solvers that lost an auction with a single winning solution, each with whether it lost by
 * 1% or less: whether its best solution that passed CIP-67's filter scored at least 99% of the
 * winning score, decided exactly on the scores. A solver none of whose solutions passed the
 * filter did not compete, and the winning solver did not lose. Empty when the auction has
 * several winning solutions, since which winner a losing solution competed with is unknown, or
 * when the winning score is missing or zero.
 */
export function auctionLosses(solutions: RankedSolution[]): Map<string, boolean> {
	const losses = new Map<string, boolean>();
	const winners = solutions.filter((solution) => solution.winner);
	const won = winners.length === 1 ? winners[0] : null;
	if (won === null || won.score === null) return losses;
	const best = BigInt(won.score);
	if (best <= 0n) return losses;
	for (const solution of solutions) {
		if (solution.solver === won.solver || solution.filteredOut || solution.score === null) {
			continue;
		}
		const close = (best - BigInt(solution.score)) * 100n <= best;
		losses.set(solution.solver, (losses.get(solution.solver) ?? false) || close);
	}
	return losses;
}

/** The zero address, which some quotes give as their solver. */
const NO_SOLVER = "0x0000000000000000000000000000000000000000";

/** The solver an order's quote names; null for a quote that names none (the zero address). */
export function quoteSolver(address: string | null): string | null {
	return address === NO_SOLVER ? null : address;
}
