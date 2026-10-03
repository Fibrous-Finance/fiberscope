import type { TradeRow } from "./chain.ts";

/**
 * The signed order terms that surplus needs, read from `settle` calldata. A Trade event holds
 * the executed amounts and the fee but not the order's limit amounts; the settle() call that
 * produced it does.
 */

/** `GPv2Settlement.settle(tokens, clearingPrices, trades, interactions)`. */
const SETTLE = "13d79a0b";
/** More tokens or trades than any settlement holds: a candidate that claims more is not one. */
const MAX_ITEMS = 4_096;

/** What surplus needs from a trade's signed order. */
export interface OrderTerms {
	/** The order's signed sell amount in sell-token atoms: its limit, before any fee. */
	limitSellAmount: string;
	/** The order's signed buy amount in buy-token atoms. */
	limitBuyAmount: string;
	/** The fee the trade paid in sell-token atoms: the Trade event's `feeAmount`. */
	feeAmount: string;
}

/** One trade of a settle() call, as the solver submitted it. */
export interface CalldataTrade {
	sellTokenIndex: number;
	buyTokenIndex: number;
	/** The signed order's amounts and fee. */
	sellAmount: bigint;
	buyAmount: bigint;
	feeAmount: bigint;
	/** Bit 0: buy order; bit 1: partially fillable; then balances and the signing scheme. */
	flags: bigint;
	/** The amount filled by this trade, for partially fillable orders. */
	executedAmount: bigint;
}

/** The arguments of one settle() call; its interactions are not read. */
export interface SettleCall {
	tokens: string[];
	clearingPrices: bigint[];
	trades: CalldataTrade[];
}

/** The amounts settle() moves for one trade, as its Trade event reports them. */
interface Execution {
	sellToken: string;
	buyToken: string;
	/** Sold, fee included. */
	sellAmount: bigint;
	buyAmount: bigint;
	/** The share of the signed fee this fill pays, in sell-token atoms. */
	feeAmount: bigint;
}

/** The fields of a stored trade that matching needs. */
export type TradeFacts = Pick<
	TradeRow,
	"logIndex" | "settlementLogIndex" | "sellToken" | "buyToken" | "sellAmount" | "buyAmount"
>;

/** ABI-encoded data read by byte offset; every read is bounds-checked, null past the end. */
class Calldata {
	readonly #hex: string;
	readonly size: number;

	constructor(input: string) {
		this.#hex = input.startsWith("0x") ? input.slice(2) : input;
		this.size = Math.floor(this.#hex.length / 2);
	}

	uint(at: number): bigint | null {
		if (at < 0 || at + 32 > this.size) return null;
		return BigInt(`0x${this.#hex.slice(at * 2, at * 2 + 64)}`);
	}

	/** A word that is an offset, a length or an index: small enough to point inside the data. */
	small(at: number): number | null {
		const value = this.uint(at);
		return value === null || value > BigInt(this.size) ? null : Number(value);
	}

	address(at: number): string | null {
		if (at < 0 || at + 32 > this.size) return null;
		const word = this.#hex.slice(at * 2, at * 2 + 64);
		return /^0{24}/.test(word) ? `0x${word.slice(24)}`.toLowerCase() : null;
	}

	/** Byte offsets of every settle() selector. */
	selectors(): number[] {
		const found: number[] = [];
		for (let at = this.#hex.indexOf(SETTLE); at >= 0; at = this.#hex.indexOf(SETTLE, at + 1)) {
			if (at % 2 === 0) found.push(at / 2);
		}
		return found;
	}
}

/**
 * Every settle() argument list a transaction's input holds. Candidates are the arguments of the
 * outer call (a direct settle(), or a solver contract that takes settle()'s arguments first) and
 * whatever follows each settle() selector: calldata the flash-loan router or a solver contract
 * passes on verbatim. A candidate that does not decode is dropped.
 */
export function settleCalls(input: string): SettleCall[] {
	const data = new Calldata(input);
	const starts = new Set([4, ...data.selectors().map((at) => at + 4)]);
	const calls: SettleCall[] = [];
	for (const start of starts) {
		const call = readSettle(data, start);
		if (call !== null) calls.push(call);
	}
	return calls;
}

function readSettle(data: Calldata, base: number): SettleCall | null {
	const tokensAt = data.small(base);
	const pricesAt = data.small(base + 32);
	const tradesAt = data.small(base + 64);
	if (tokensAt === null || pricesAt === null || tradesAt === null) return null;
	const tokens = readArray(data, base + tokensAt, (at) => data.address(at));
	const clearingPrices = readArray(data, base + pricesAt, (at) => data.uint(at));
	if (tokens === null || clearingPrices === null || tokens.length !== clearingPrices.length) {
		return null;
	}
	const trades = readTrades(data, base + tradesAt, tokens.length);
	return trades === null ? null : { tokens, clearingPrices, trades };
}

function readArray<T>(data: Calldata, at: number, item: (at: number) => T | null): T[] | null {
	const length = data.small(at);
	if (length === null || length > MAX_ITEMS) return null;
	const items: T[] = [];
	for (let i = 0; i < length; i++) {
		const value = item(at + 32 * (i + 1));
		if (value === null) return null;
		items.push(value);
	}
	return items;
}

/** Trades are tuples with a dynamic member (the signature), so the array holds their offsets. */
function readTrades(data: Calldata, at: number, tokenCount: number): CalldataTrade[] | null {
	const length = data.small(at);
	if (length === null || length > MAX_ITEMS) return null;
	const content = at + 32;
	const trades: CalldataTrade[] = [];
	for (let i = 0; i < length; i++) {
		const offset = data.small(content + 32 * i);
		if (offset === null) return null;
		const tuple = content + offset;
		const sellTokenIndex = data.small(tuple);
		const buyTokenIndex = data.small(tuple + 32);
		const sellAmount = data.uint(tuple + 96);
		const buyAmount = data.uint(tuple + 128);
		const feeAmount = data.uint(tuple + 224);
		const flags = data.uint(tuple + 256);
		const executedAmount = data.uint(tuple + 288);
		if (
			sellTokenIndex === null ||
			buyTokenIndex === null ||
			sellTokenIndex >= tokenCount ||
			buyTokenIndex >= tokenCount ||
			sellAmount === null ||
			buyAmount === null ||
			feeAmount === null ||
			flags === null ||
			executedAmount === null
		) {
			return null;
		}
		trades.push({
			sellTokenIndex,
			buyTokenIndex,
			sellAmount,
			buyAmount,
			feeAmount,
			flags,
			executedAmount,
		});
	}
	return trades;
}

/**
 * What settle() makes of a trade, following `GPv2Settlement.computeTradeExecution`: a sell order
 * sells its sell amount (a partially fillable one its executed amount) and buys that at the
 * clearing prices, rounded up; a buy order buys its buy amount (or its executed amount) and sells
 * that at the clearing prices, rounded down. A partial fill pays its share of the signed fee,
 * rounded down. Null where the contract would divide by zero.
 */
function execution(call: SettleCall, trade: CalldataTrade): Execution | null {
	const sellPrice = call.clearingPrices[trade.sellTokenIndex];
	const buyPrice = call.clearingPrices[trade.buyTokenIndex];
	if (sellPrice === 0n || buyPrice === 0n) return null;
	const partial = (trade.flags & 2n) !== 0n;
	let sold: bigint;
	let bought: bigint;
	let fee: bigint;
	if ((trade.flags & 1n) === 0n) {
		if (partial && trade.sellAmount === 0n) return null;
		sold = partial ? trade.executedAmount : trade.sellAmount;
		fee = partial ? (trade.feeAmount * sold) / trade.sellAmount : trade.feeAmount;
		bought = (sold * sellPrice + buyPrice - 1n) / buyPrice;
	} else {
		if (partial && trade.buyAmount === 0n) return null;
		bought = partial ? trade.executedAmount : trade.buyAmount;
		fee = partial ? (trade.feeAmount * bought) / trade.buyAmount : trade.feeAmount;
		sold = (bought * buyPrice) / sellPrice;
	}
	return {
		sellToken: call.tokens[trade.sellTokenIndex],
		buyToken: call.tokens[trade.buyTokenIndex],
		sellAmount: sold + fee,
		buyAmount: bought,
		feeAmount: fee,
	};
}

/**
 * The order terms of a transaction's trades, by trade log index. Each settlement, its trades in
 * log order, takes the first unused settle() call of the input whose trades execute to exactly
 * its Trade events: the same count, tokens and amounts. That check is what makes a candidate a
 * settle() call. A settlement no call reproduces gets no terms.
 */
export function readOrderTerms(input: string, trades: TradeFacts[]): Map<number, OrderTerms> {
	// Log order puts each settlement's trades together, settlements in the order they ran.
	const settlements = new Map<number, TradeFacts[]>();
	for (const trade of [...trades].sort((a, b) => a.logIndex - b.logIndex)) {
		const list = settlements.get(trade.settlementLogIndex);
		if (list) list.push(trade);
		else settlements.set(trade.settlementLogIndex, [trade]);
	}
	const calls = settleCalls(input);
	const used = new Set<SettleCall>();
	const terms = new Map<number, OrderTerms>();
	for (const settled of settlements.values()) {
		for (const call of calls) {
			if (used.has(call)) continue;
			const matched = match(call, settled);
			if (matched === null) continue;
			used.add(call);
			settled.forEach((trade, i) => terms.set(trade.logIndex, matched[i]));
			break;
		}
	}
	return terms;
}

function match(call: SettleCall, settled: TradeFacts[]): OrderTerms[] | null {
	if (call.trades.length !== settled.length) return null;
	const terms: OrderTerms[] = [];
	for (let i = 0; i < settled.length; i++) {
		const trade = call.trades[i];
		const executed = execution(call, trade);
		const event = settled[i];
		if (
			executed === null ||
			executed.sellToken !== event.sellToken ||
			executed.buyToken !== event.buyToken ||
			executed.sellAmount !== BigInt(event.sellAmount) ||
			executed.buyAmount !== BigInt(event.buyAmount)
		) {
			return null;
		}
		terms.push({
			limitSellAmount: trade.sellAmount.toString(),
			limitBuyAmount: trade.buyAmount.toString(),
			feeAmount: executed.feeAmount.toString(),
		});
	}
	return terms;
}
