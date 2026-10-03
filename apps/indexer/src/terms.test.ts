import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { WETH } from "./config.ts";
import { readOrderTerms, settleCalls } from "./terms.ts";
import type { CalldataTrade, TradeFacts } from "./terms.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DAI = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb";
const SETTLE = "13d79a0b";

/** One ABI word: a number, or an address left-padded. */
function word(value: bigint | number | string): string {
	return typeof value === "string"
		? value.slice(2).padStart(64, "0")
		: BigInt(value).toString(16).padStart(64, "0");
}

/** `bytes` content: its length, then the data padded to whole words. */
function bytes(hex: string): string {
	return word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
}

/**
 * settle()'s arguments, ABI-encoded; `extra` static words follow the four offsets, as in a
 * solver contract that takes settle()'s arguments and more.
 */
function settleArgs(
	tokens: string[],
	prices: bigint[],
	trades: CalldataTrade[],
	extra: bigint[] = []
): string {
	const tokensPart = word(tokens.length) + tokens.map(word).join("");
	const pricesPart = word(prices.length) + prices.map(word).join("");
	const signature = bytes("11".repeat(65));
	const tuples = trades.map(
		(t) =>
			[
				t.sellTokenIndex,
				t.buyTokenIndex,
				"0x0000000000000000000000000000000000000000",
				t.sellAmount,
				t.buyAmount,
				1_900_000_000,
				0,
				t.feeAmount,
				t.flags,
				t.executedAmount,
				11 * 32,
			]
				.map(word)
				.join("") + signature
	);
	let at = trades.length * 32;
	const offsets = tuples.map((tuple) => {
		const offset = word(at);
		at += tuple.length / 2;
		return offset;
	});
	const tradesPart = word(trades.length) + offsets.join("") + tuples.join("");
	const interactionsPart = [96, 128, 160, 0, 0, 0].map(word).join("");
	const head = (4 + extra.length) * 32;
	const parts = [tokensPart, pricesPart, tradesPart];
	const heads: string[] = [];
	let offset = head;
	for (const part of parts) {
		heads.push(word(offset));
		offset += part.length / 2;
	}
	heads.push(word(offset));
	return heads.join("") + extra.map(word).join("") + parts.join("") + interactionsPart;
}

// Clearing prices: 1,000 USDC buys 0.45 WETH, and 1,000 DAI costs 0.45 WETH.
const TOKENS = [USDC, WETH, DAI];
const PRICES = [450_000_000_000_000_000n, 1_000_000_000n, 450_000n];

/** A whole sell order: 1,000 USDC for at least 0.4 WETH. */
const SELL: CalldataTrade = {
	sellTokenIndex: 0,
	buyTokenIndex: 1,
	sellAmount: 1_000_000_000n,
	buyAmount: 400_000_000_000_000_000n,
	feeAmount: 0n,
	flags: 0n,
	executedAmount: 0n,
};
/**
 * A partially fillable buy order with a signed fee: 2,000 DAI for at most 1 WETH plus 0.001 WETH
 * of fee, half filled here.
 */
const PARTIAL_BUY: CalldataTrade = {
	sellTokenIndex: 1,
	buyTokenIndex: 2,
	sellAmount: 1_000_000_000_000_000_000n,
	buyAmount: 2_000_000_000_000_000_000_000n,
	feeAmount: 1_000_000_000_000_000n,
	flags: 3n,
	executedAmount: 1_000_000_000_000_000_000_000n,
};

/** The Trade events settle() emits for those two orders, in a settlement at log index 9. */
function events(settlementLogIndex = 9, first = 7): TradeFacts[] {
	return [
		{
			logIndex: first,
			settlementLogIndex,
			sellToken: USDC,
			buyToken: WETH,
			sellAmount: "1000000000",
			// 1,000 USDC at the clearing prices, rounded up.
			buyAmount: "450000000000000000",
		},
		{
			logIndex: first + 1,
			settlementLogIndex,
			sellToken: WETH,
			buyToken: DAI,
			// 0.45 WETH for 1,000 DAI, plus half the signed fee.
			sellAmount: "450500000000000000",
			buyAmount: "1000000000000000000000",
		},
	];
}

const EXPECTED = [
	{ limitSellAmount: "1000000000", limitBuyAmount: "400000000000000000", feeAmount: "0" },
	{
		limitSellAmount: "1000000000000000000",
		limitBuyAmount: "2000000000000000000000",
		feeAmount: "500000000000000",
	},
];

describe("order terms", () => {
	const direct = `0x${SETTLE}${settleArgs(TOKENS, PRICES, [SELL, PARTIAL_BUY])}`;

	test("reads the limits and the fee of a direct settle() call", () => {
		const terms = readOrderTerms(direct, events());
		assert.deepEqual([terms.get(7), terms.get(8)], EXPECTED);
	});

	test("finds settle() calldata that a wrapper passes on as bytes, at any byte offset", () => {
		// flashLoanAndSettle(loans, settlement): no loans, then the settle() calldata.
		const inner = `${SETTLE}${settleArgs(TOKENS, PRICES, [SELL, PARTIAL_BUY])}`;
		const routed = `0xe7c438c9${word(64)}${word(96)}${word(0)}${bytes(inner)}`;
		assert.deepEqual([...readOrderTerms(routed, events()).values()], EXPECTED);
	});

	test("reads a solver contract that takes settle()'s arguments first, with more after", () => {
		const args = settleArgs(TOKENS, PRICES, [SELL, PARTIAL_BUY], [29_360_020n]);
		const custom = `0x4a7cf362${args}`;
		assert.deepEqual([...readOrderTerms(custom, events()).values()], EXPECTED);
	});

	test("gives each settlement of a transaction the settle() call that reproduces it", () => {
		// Two settle() calls in one input; the second settlement's call comes first.
		const first = `${SETTLE}${settleArgs(TOKENS, PRICES, [SELL, PARTIAL_BUY])}`;
		const second = `${SETTLE}${settleArgs(TOKENS, PRICES, [SELL])}`;
		const head = word(64) + word(64 + bytes(second).length / 2);
		const input = `0xdeadbeef${head}${bytes(second)}${bytes(first)}`;
		const trades = [...events(9, 7), { ...events(12, 11)[0] }];
		const terms = readOrderTerms(input, trades);
		assert.deepEqual([terms.get(7), terms.get(8), terms.get(11)], [...EXPECTED, EXPECTED[0]]);
	});

	test("gives no terms when no call reproduces the Trade events exactly", () => {
		const [sell, buy] = events();
		// One atom off, a different token, a missing trade: each rules the call out.
		assert.equal(readOrderTerms(direct, [sell, { ...buy, buyAmount: "1" }]).size, 0);
		assert.equal(readOrderTerms(direct, [{ ...sell, buyToken: DAI }, buy]).size, 0);
		assert.equal(readOrderTerms(direct, [sell]).size, 0);
	});

	test("skips input that is not a settle() call, without throwing", () => {
		assert.deepEqual(settleCalls("0x"), []);
		assert.deepEqual(settleCalls(`0x${SETTLE}${word(2 ** 40)}`), []);
		assert.deepEqual(settleCalls(`0xa9059cbb${word(USDC)}${word(5)}`), []);
		assert.equal(readOrderTerms("0x095ea7b3", events()).size, 0);
	});
});
