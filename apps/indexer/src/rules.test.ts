import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ROUTER } from "./chain.ts";
import { Clock } from "./clock.ts";
import { NATIVE_TOKEN, NETWORK } from "./config.ts";
import {
	batchCostUsd,
	creditedAddress,
	Days,
	feeUsd,
	priceToken,
	tradeSurplus,
	tradeVolumeUsd,
} from "./rules.ts";
import type { SettlementParties } from "./rules.ts";

/** The wrapped native token of the network the tests run as: WETH on Base. */
const WETH = NETWORK.native.wrapped;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DAY = 86_400;

/** A clock with anchors at `blocks`, timed as on Base: block 0 at 1686789347, then every 2 s. */
function baseClock(blocks: number[]): Clock {
	return new Clock(
		blocks.map((block) => ({ block, time: 1_686_789_347 + 2 * block })),
		2
	);
}

describe("days", () => {
	test("on Base, buckets, windows and whole buckets are the old block arithmetic", () => {
		// A day of Base blocks is 43,200 of them: bucket d held (end − (d + 1) days, end − d days].
		const day = 43_200;
		const end = 52_074_002;
		const from = end - 180 * day + 1;
		// Anchored at the ends of the chain range, as an upgraded database is, or at many blocks.
		const many = Array.from({ length: 181 }, (_, i) => from + i * 43_123);
		for (const clock of [baseClock([from, end]), baseClock(many)]) {
			const days = new Days(clock, end);
			for (const block of [end, end - day + 1, end - day, end - 7 * day + 1, end - 7 * day]) {
				assert.equal(days.bucketOf(block), Math.floor((end - block) / day));
			}
			assert.equal(days.bucketOf(from), 179);
			assert.equal(days.bucketOf(end + 1), -1);
			for (const n of [1, 2, 7, 30, 90, 180]) {
				assert.equal(days.windowStart(n), end - n * day + 1);
			}
			for (const start of [from - 1, from, from + 1, end - day + 1, end - day + 2]) {
				const whole = Math.floor((end - start + 1) / day);
				assert.equal(days.completeBuckets({ from: start, to: end }), whole);
			}
			assert.equal(days.completeBuckets({ from, to: end - 1 }), 0);
			assert.equal(days.completeBuckets(null), 0);
		}
	});

	test("a block's bucket follows its time, however fast the blocks came", () => {
		// A day of 3-second blocks, then a day of half-second ones: 28,800 blocks, then 172,800.
		const start = 1_700_000_000;
		const clock = new Clock(
			[
				{ block: 0, time: start },
				{ block: 28_800, time: start + DAY },
				{ block: 201_600, time: start + 2 * DAY },
			],
			0.45
		);
		const days = new Days(clock, 201_600);
		// Bucket 0 is the last day's 172,800 blocks, bucket 1 the 28,800 of the day before.
		assert.equal(days.bucketOf(201_600), 0);
		assert.equal(days.bucketOf(28_801), 0);
		assert.equal(days.bucketOf(28_800), 1);
		assert.equal(days.bucketOf(1), 1);
		assert.equal(days.bucketOf(0), 2);
		assert.equal(days.windowStart(1), 28_801);
		assert.equal(days.windowStart(2), 1);
		assert.equal(days.completeBuckets({ from: 1, to: 201_600 }), 2);
		assert.equal(days.completeBuckets({ from: 2, to: 201_600 }), 1);
		assert.equal(days.completeBuckets({ from: 28_801, to: 201_600 }), 1);
		assert.equal(days.completeBuckets({ from: 28_802, to: 201_600 }), 0);
	});

	test("a backfill goes deeper than an estimated window start, not than an anchored one", () => {
		const head = 1_000_000;
		// Only the head is anchored: the day's 191,998 blocks at 0.45 s, and 1% more.
		const estimated = new Days(new Clock([{ block: head, time: 1_800_000_000 }], 0.45), head);
		assert.equal(estimated.windowStart(1), head - 191_998);
		assert.equal(estimated.reach(1), head - 191_998 - 1_920);
		const anchored = new Days(baseClock([0, head]), head);
		assert.equal(anchored.reach(1), head - 43_200 + 1);
	});
});

describe("trade volume", () => {
	// Native prices value amount × price / 1e36 ETH: WETH is 1e18; USDC (6 decimals) at
	// $2,000 per ETH is 0.0005 ETH per USDC, so 5e26 per atom.
	const weth = { amount: "1000000000000000000", price: "1000000000000000000" };
	const usdc = { amount: "1990000000", price: "500000000000000000000000000" };
	const nativeUsd = 2_000;

	test("takes the lower of the sell and buy sides", () => {
		const usd = tradeVolumeUsd(weth.amount, weth.price, usdc.amount, usdc.price, nativeUsd);
		assert.ok(Math.abs(usd! - 1_990) < 1e-9);
	});

	test("uses the priced side when only one side has a price", () => {
		assert.ok(
			Math.abs(
				tradeVolumeUsd(weth.amount, null, usdc.amount, usdc.price, nativeUsd)! - 1_990
			) < 1e-9
		);
		assert.ok(
			Math.abs(
				tradeVolumeUsd(weth.amount, weth.price, usdc.amount, null, nativeUsd)! - 2_000
			) < 1e-9
		);
		assert.ok(
			Math.abs(
				tradeVolumeUsd(weth.amount, weth.price, usdc.amount, "0", nativeUsd)! - 2_000
			) < 1e-9
		);
	});

	test("has no value when neither side is priced", () => {
		assert.equal(tradeVolumeUsd(weth.amount, null, usdc.amount, null, nativeUsd), null);
		assert.equal(tradeVolumeUsd(weth.amount, "0", usdc.amount, null, nativeUsd), null);
	});

	test("prices the native token as its wrapped token", () => {
		assert.equal(priceToken(NATIVE_TOKEN), WETH);
		assert.equal(priceToken(WETH), WETH);
		assert.equal(priceToken(USDC), USDC);
	});
});

describe("trade surplus", () => {
	// A sell order: 1,000 USDC for at least 0.4 WETH, filled for 0.45 WETH.
	const sell = {
		sellAmount: "1000000000",
		buyAmount: "450000000000000000",
		limitSellAmount: "1000000000",
		limitBuyAmount: "400000000000000000",
		feeAmount: "0",
	};

	test("is the trade's value times how far the executed price beat the limit", () => {
		// 0.05 WETH more than the limit asked, of the 0.45 bought: a ninth.
		assert.ok(Math.abs(tradeSurplus(900, sell)!.usd - 100) < 1e-9);
		// Filled exactly at the limit: no surplus.
		assert.equal(tradeSurplus(900, { ...sell, buyAmount: "400000000000000000" })?.usd, 0);
	});

	test("uses the same expression for buy orders: what the trader saved of the limit", () => {
		// 1,000 DAI for at most 0.5 WETH, bought for 0.45 WETH: a tenth saved.
		const buy = {
			sellAmount: "450000000000000000",
			buyAmount: "1000000000000000000000",
			limitSellAmount: "500000000000000000",
			limitBuyAmount: "1000000000000000000000",
			feeAmount: "0",
		};
		assert.ok(Math.abs(tradeSurplus(1_000, buy)!.usd - 100) < 1e-9);
	});

	test("compares prices, so a partial fill at the same price has the same ratio", () => {
		// Half of a 2,000 USDC order for at least 0.8 WETH.
		const half = {
			...sell,
			limitSellAmount: "2000000000",
			limitBuyAmount: "800000000000000000",
		};
		assert.ok(Math.abs(tradeSurplus(900, half)!.usd - 100) < 1e-9);
	});

	test("leaves the fee out of the amount sold", () => {
		// The same trade with 1 USDC of signed fee on top: the surplus does not change.
		const withFee = { ...sell, sellAmount: "1001000000", feeAmount: "1000000" };
		assert.ok(Math.abs(tradeSurplus(900, withFee)!.usd - 100) < 1e-9);
	});

	test("is unusual only when it is more than a tenth of the trade's value", () => {
		// A ninth of the value: unusual.
		assert.equal(tradeSurplus(900, sell)?.unusual, true);
		// Exactly a tenth (0.45 WETH bought where 0.405 was asked) is still reasonable; one atom
		// less asked tips it over. The value does not matter: the ratio decides.
		const tenth = { ...sell, limitBuyAmount: "405000000000000000" };
		assert.ok(Math.abs(tradeSurplus(900, tenth)!.usd - 90) < 1e-9);
		assert.equal(tradeSurplus(900, tenth)?.unusual, false);
		assert.equal(tradeSurplus(1, tenth)?.unusual, false);
		const over = { ...sell, limitBuyAmount: "404999999999999999" };
		assert.equal(tradeSurplus(900, over)?.unusual, true);
		assert.equal(
			tradeSurplus(900, { ...sell, buyAmount: "400000000000000000" })?.unusual,
			false
		);
	});

	test("has none without a value or without order terms", () => {
		assert.equal(tradeSurplus(null, sell), null);
		assert.equal(tradeSurplus(900, { ...sell, limitSellAmount: null }), null);
		assert.equal(tradeSurplus(900, { ...sell, feeAmount: null }), null);
		assert.equal(tradeSurplus(900, { ...sell, limitSellAmount: "0" }), null);
	});
});

describe("fee value", () => {
	// 1,000 USDC sold for 0.5 WETH, a trade worth $1,000 at its lower side.
	const trade = {
		sellToken: USDC,
		buyToken: WETH,
		sellAmount: "1000000000",
		buyAmount: "500000000000000000",
	};

	test("is the fee's share of the trade's amount in its token, times the trade's value", () => {
		// 0.0005 WETH of 0.5 WETH bought, and 2 USDC of 1,000 USDC sold.
		assert.equal(feeUsd({ token: WETH, amount: "500000000000000" }, trade, 1_000), 1);
		assert.equal(feeUsd({ token: trade.sellToken, amount: "2000000" }, trade, 1_000), 2);
		// The native token is the same side as its wrapped token.
		const native = { ...trade, buyToken: NATIVE_TOKEN };
		assert.equal(feeUsd({ token: WETH, amount: "500000000000000" }, native, 1_000), 1);
	});

	test("has none in a token the trade did not touch, or on an empty side", () => {
		const other = "0x4200000000000000000000000000000000000042";
		assert.equal(feeUsd({ token: other, amount: "1" }, trade, 1_000), null);
		assert.equal(
			feeUsd({ token: WETH, amount: "1" }, { ...trade, buyAmount: "0" }, 1_000),
			null
		);
	});
});

describe("batch cost", () => {
	// 400K gas at 0.01 gwei plus 0.0000001 ETH of L1 data fee: 0.0000041 ETH.
	const tx = { fee: "4100000000000", txBatches: 1 };

	test("is the transaction's fee in the native token at its USD price", () => {
		assert.ok(Math.abs(batchCostUsd(tx, 2_500) - 0.01025) < 1e-12);
	});

	test("splits the fee evenly between the batches of a transaction", () => {
		assert.ok(Math.abs(batchCostUsd({ ...tx, txBatches: 2 }, 2_500) - 0.005125) < 1e-12);
	});
});

describe("attribution", () => {
	const nexroute = "0x588ef3de14875ff9c4fc74c9e2c308767d665e30";
	const operator = "0x416f727baea5ff3118e4f96c1d2cec8a1e2bab57";
	const rizzolver = "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7";
	const helper = "0x95988b6700000000000000000000000000007e00";
	const isRegistered = (address: string) => address === nexroute || address === rizzolver;
	const routed = (parties: Partial<SettlementParties>): SettlementParties => ({
		solver: ROUTER,
		sender: helper,
		senderIsSolver: false,
		recipient: ROUTER,
		recipientIsSolver: false,
		...parties,
	});

	test("credits the Settlement event's solver", () => {
		const credited = creditedAddress(
			routed({ solver: rizzolver, sender: operator, recipient: nexroute }),
			isRegistered,
			() => nexroute
		);
		assert.deepEqual(credited, { address: rizzolver, source: "event" });
	});

	test("credits the router settlement's recipient when it is registered", () => {
		const parties = routed({ sender: nexroute, recipient: rizzolver });
		assert.deepEqual(
			creditedAddress(parties, isRegistered, () => nexroute),
			{
				address: rizzolver,
				source: "recipient",
			}
		);
	});

	test("credits the router settlement's recipient when it is allow-listed", () => {
		const parties = routed({ sender: nexroute, recipient: operator, recipientIsSolver: true });
		assert.deepEqual(
			creditedAddress(parties, isRegistered, () => nexroute),
			{
				address: operator,
				source: "recipient",
			}
		);
	});

	test("never credits the router itself as the recipient, but the sender", () => {
		const parties = routed({ sender: nexroute, recipientIsSolver: true });
		assert.deepEqual(
			creditedAddress(parties, isRegistered, () => rizzolver),
			{
				address: nexroute,
				source: "sender",
			}
		);
		const allowListed = routed({ sender: operator, senderIsSolver: true });
		assert.deepEqual(
			creditedAddress(allowListed, isRegistered, () => rizzolver),
			{
				address: operator,
				source: "sender",
			}
		);
	});

	test("falls back to the API's winner when neither recipient nor sender is a solver", () => {
		const parties = routed({ recipient: operator });
		assert.deepEqual(
			creditedAddress(parties, isRegistered, () => rizzolver),
			{
				address: rizzolver,
				source: "winner",
			}
		);
	});

	test("keeps the sender, unverified, when nothing else is known", () => {
		const unknown = routed({ recipient: null });
		assert.deepEqual(
			creditedAddress(unknown, isRegistered, () => null),
			{
				address: helper,
				source: "unverified",
			}
		);
		const unregistered = routed({ recipient: operator });
		assert.deepEqual(
			creditedAddress(unregistered, isRegistered, () => null),
			{
				address: helper,
				source: "unverified",
			}
		);
	});
});
