import { ROUTER } from "./chain.ts";
import { BLOCKS_PER_DAY, NATIVE_ETH, WETH } from "./config.ts";

/** The published methodology as pure functions: buckets, attribution and volume. */

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
