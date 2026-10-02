import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ROUTER } from "./chain.ts";
import { BLOCKS_PER_DAY, NATIVE_ETH, WETH } from "./config.ts";
import {
	bucketOf,
	completeBuckets,
	creditedAddress,
	priceToken,
	tradeVolumeUsd,
	windowStart,
} from "./rules.ts";
import type { SettlementParties } from "./rules.ts";

describe("buckets", () => {
	const end = 52_074_002;

	test("bucket d holds the blocks of (end − (d + 1) days, end − d days]", () => {
		assert.equal(bucketOf(end, end), 0);
		assert.equal(bucketOf(end, end - BLOCKS_PER_DAY + 1), 0);
		assert.equal(bucketOf(end, end - BLOCKS_PER_DAY), 1);
		assert.equal(bucketOf(end, end - 7 * BLOCKS_PER_DAY + 1), 6);
		assert.equal(bucketOf(end, end - 7 * BLOCKS_PER_DAY), 7);
		assert.equal(bucketOf(end, end + 1), -1);
	});

	test("a window of d days starts at the first block of bucket d − 1", () => {
		assert.equal(bucketOf(end, windowStart(end, 7)), 6);
		assert.equal(bucketOf(end, windowStart(end, 7) - 1), 7);
	});

	test("only whole buckets from bucket 0 count as complete", () => {
		assert.equal(completeBuckets(end, { from: windowStart(end, 30), to: end }), 30);
		assert.equal(completeBuckets(end, { from: windowStart(end, 30) + 1, to: end }), 29);
		assert.equal(completeBuckets(end, { from: windowStart(end, 30) - 1, to: end }), 30);
		assert.equal(completeBuckets(end, { from: windowStart(end, 2), to: end - 1 }), 0);
		assert.equal(completeBuckets(end, null), 0);
	});
});

describe("trade volume", () => {
	// Native prices value amount × price / 1e36 ETH: WETH is 1e18; USDC (6 decimals) at
	// $2,000 per ETH is 0.0005 ETH per USDC, so 5e26 per atom.
	const weth = { amount: "1000000000000000000", price: "1000000000000000000" };
	const usdc = { amount: "1990000000", price: "500000000000000000000000000" };
	const ethUsd = 2_000;

	test("takes the lower of the sell and buy sides", () => {
		const usd = tradeVolumeUsd(weth.amount, weth.price, usdc.amount, usdc.price, ethUsd);
		assert.ok(Math.abs(usd! - 1_990) < 1e-9);
	});

	test("uses the priced side when only one side has a price", () => {
		assert.ok(
			Math.abs(tradeVolumeUsd(weth.amount, null, usdc.amount, usdc.price, ethUsd)! - 1_990) <
				1e-9
		);
		assert.ok(
			Math.abs(tradeVolumeUsd(weth.amount, weth.price, usdc.amount, null, ethUsd)! - 2_000) <
				1e-9
		);
		assert.ok(
			Math.abs(tradeVolumeUsd(weth.amount, weth.price, usdc.amount, "0", ethUsd)! - 2_000) <
				1e-9
		);
	});

	test("has no value when neither side is priced", () => {
		assert.equal(tradeVolumeUsd(weth.amount, null, usdc.amount, null, ethUsd), null);
		assert.equal(tradeVolumeUsd(weth.amount, "0", usdc.amount, null, ethUsd), null);
	});

	test("prices native ETH with WETH", () => {
		assert.equal(priceToken(NATIVE_ETH), WETH);
		assert.equal(priceToken(WETH), WETH);
		assert.equal(
			priceToken("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
			"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
		);
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
		assert.equal(credited, rizzolver);
	});

	test("credits the router settlement's recipient when it is registered", () => {
		const parties = routed({ sender: nexroute, recipient: rizzolver });
		assert.equal(
			creditedAddress(parties, isRegistered, () => nexroute),
			rizzolver
		);
	});

	test("credits the router settlement's recipient when it is allow-listed", () => {
		const parties = routed({ sender: nexroute, recipient: operator, recipientIsSolver: true });
		assert.equal(
			creditedAddress(parties, isRegistered, () => nexroute),
			operator
		);
	});

	test("never credits the router itself as the recipient, but the sender", () => {
		const parties = routed({ sender: nexroute, recipientIsSolver: true });
		assert.equal(
			creditedAddress(parties, isRegistered, () => rizzolver),
			nexroute
		);
		const allowListed = routed({ sender: operator, senderIsSolver: true });
		assert.equal(
			creditedAddress(allowListed, isRegistered, () => rizzolver),
			operator
		);
	});

	test("falls back to the API's winner when neither recipient nor sender is a solver", () => {
		const parties = routed({ recipient: operator });
		assert.equal(
			creditedAddress(parties, isRegistered, () => rizzolver),
			rizzolver
		);
	});

	test("keeps the sender when nothing else is known", () => {
		const unknown = routed({ recipient: null });
		assert.equal(
			creditedAddress(unknown, isRegistered, () => null),
			helper
		);
		const unregistered = routed({ recipient: operator });
		assert.equal(
			creditedAddress(unregistered, isRegistered, () => null),
			helper
		);
	});
});
