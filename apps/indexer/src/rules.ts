import { ROUTER } from "./chain.ts";
import { BLOCKS_PER_DAY, NATIVE_ETH, WETH } from "./config.ts";

/** The published methodology as pure functions: buckets, attribution, volume, surplus and cost. */

export interface BlockRange {
	from: number;
	to: number;
}

/**
 * The rolling-day bucket of a block: bucket d holds blocks (end − (d + 1) days, end − d days].
 * Blocks after `end` get -1.
 */
export function bucketOf(end: number, block: number): number {
	return block > end ? -1 : Math.floor((end - block) / BLOCKS_PER_DAY);
}

/** The first block of a window made of the `days` buckets that end at `end`. */
export function windowStart(end: number, days: number): number {
	return end - days * BLOCKS_PER_DAY + 1;
}

/**
 * How many buckets, counting from bucket 0, lie wholly inside an ingested range. Zero when the
 * range stops short of `end`, since bucket 0 is then incomplete.
 */
export function completeBuckets(end: number, range: BlockRange | null): number {
	if (range === null || range.to < end || range.from > end) return 0;
	return Math.floor((end - range.from + 1) / BLOCKS_PER_DAY);
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
 * The address credited with a settlement. The flash-loan router settles on behalf of the auction
 * winner, which calls it either from its own account or through its own contract, sent from
 * per-transaction helper accounts. So a router settlement goes to the transaction's recipient
 * when that is a registered or allow-listed solver other than the router itself; else to the
 * sender when it is registered or allow-listed; else to the competition's winning solution for
 * the transaction; and to the sender only if the competition is unknown too.
 */
export function creditedAddress(
	settlement: SettlementParties,
	isRegistered: (address: string) => boolean,
	apiWinner: () => string | null
): string {
	if (settlement.solver !== ROUTER) return settlement.solver;
	const { recipient, sender } = settlement;
	if (recipient !== null && recipient !== ROUTER) {
		if (settlement.recipientIsSolver || isRegistered(recipient)) return recipient;
	}
	if (settlement.senderIsSolver || isRegistered(sender)) return sender;
	return apiWinner() ?? sender;
}

/** The token whose native price values `token`: native ETH is priced as WETH. */
export function priceToken(token: string): string {
	return token === NATIVE_ETH ? WETH : token;
}

/**
 * A trade's USD value: the lower of its sell side and buy side, each valued as amount × native
 * price / 1e36 ETH (CoW native prices are in wei per token atom, scaled by 1e18), times ETH/USD.
 * A side with no price or a zero price is unpriced. With one priced side, that side is used; with
 * none, the trade has no value.
 */
export function tradeVolumeUsd(
	sellAmount: string,
	sellPrice: string | null,
	buyAmount: string,
	buyPrice: string | null,
	ethUsd: number
): number | null {
	const sellNative = sellPrice === null ? 0n : BigInt(sellPrice);
	const buyNative = buyPrice === null ? 0n : BigInt(buyPrice);
	const sell = sellNative > 0n ? BigInt(sellAmount) * sellNative : null;
	const buy = buyNative > 0n ? BigInt(buyAmount) * buyNative : null;
	const lower = sell !== null && buy !== null ? (sell < buy ? sell : buy) : (sell ?? buy);
	return lower === null ? null : (Number(lower) / 1e36) * ethUsd;
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
 * the L1 data fee (wei), in ETH at the ETH/USD rate of its block, split evenly between the
 * batches the transaction holds, as its gas is.
 */
export function batchCostUsd(tx: { fee: string; txBatches: number }, ethUsd: number): number {
	return (Number(BigInt(tx.fee)) / 1e18 / tx.txBatches) * ethUsd;
}
