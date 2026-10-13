import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseCompetition, parseOrderDetail, parseOrderTrade, partnerFeePolicies } from "./cow.ts";

const RECIPIENT = "0x8025BAcF968aa82BDfE51B513123b55BFb0060D3";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

// Trimmed from CoW's API for Base: auction 29,511,873, its winning order and that order's trade.
describe("CoW API payloads", () => {
	test("a competition keeps each solution's score, reference score and filter outcome", () => {
		const competition = parseCompetition({
			auctionId: 29511873,
			auctionStartBlock: 52559737,
			transactionHashes: [
				"0x27BEB03583B4B54A46F22E8CBE07534E09D7576EBA60DA126C01544D069FEE63",
			],
			referenceScores: { "0x4c7bdd2d75050c4fdb84ad47dd328dc5c07d7743": "3713016942728466" },
			auction: { orders: ["0xf4ed"], prices: { [USDC]: "238604963515138470000000000" } },
			solutions: [
				{
					solverAddress: "0x5c3593481cba011737e36ded62f1797c9f6afce1",
					score: "3713016942728466",
					ranking: 2,
					isWinner: false,
					filteredOut: true,
					txHash: null,
					referenceScore: null,
				},
				{
					solverAddress: "0x4C7BDD2D75050C4FDB84AD47DD328DC5C07D7743",
					score: "3714082417859443",
					ranking: 1,
					isWinner: true,
					filteredOut: false,
					txHash: "0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63",
					referenceScore: "3713016942728466",
				},
			],
		});
		assert.deepEqual(competition.solutions, [
			{
				solver: "0x5c3593481cba011737e36ded62f1797c9f6afce1",
				ranking: 2,
				winner: false,
				tx: null,
				score: "3713016942728466",
				referenceScore: null,
				filteredOut: true,
			},
			{
				solver: "0x4c7bdd2d75050c4fdb84ad47dd328dc5c07d7743",
				ranking: 1,
				winner: true,
				tx: "0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63",
				score: "3714082417859443",
				referenceScore: "3713016942728466",
				filteredOut: false,
			},
		]);
		assert.deepEqual(competition.txHashes, [
			"0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63",
		]);
	});

	test("an order keeps its quote, its app data's order class and its partner fees", () => {
		const detail = parseOrderDetail({
			uid: "0xf4eda79948847ba58b0a6c5e54def1c92b5082ded993d9ec1803eefdafb3fe43256534d1b3042a4906696e27868c7b49056289216ace65b6",
			kind: "sell",
			class: "limit",
			fullAppData: JSON.stringify({
				appCode: "CoW Swap-SafeApp",
				metadata: {
					orderClass: { orderClass: "twap" },
					partnerFee: { recipient: RECIPIENT, volumeBps: 10 },
					quote: { slippageBips: 4500 },
				},
				version: "1.15.0",
			}),
			quote: {
				gasAmount: "231100",
				gasPrice: "6209338",
				sellTokenPrice: "0.00861733234563727",
				sellAmount: "1331378299120234604",
				buyAmount: "28890491",
				feeAmount: "166522301130291",
				solver: "0x8f5835E9D756C9bd934bcE527157A4B0ef3C5cB7",
				verified: true,
				metadata: { version: "1.0" },
			},
		});
		assert.deepEqual(detail, {
			kind: "sell",
			appClass: "twap",
			partnerFees: ["volume"],
			quote: {
				solver: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
				verified: true,
				sellAmount: "1331378299120234604",
				buyAmount: "28890491",
				feeAmount: "166522301130291",
			},
		});
	});

	test("a trade keeps its protocol fees in the order CoW applied them", () => {
		const trade = parseOrderTrade({
			blockNumber: 52559741,
			logIndex: 312,
			orderUid: "0xf4ed",
			txHash: "0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63",
			executedProtocolFees: [
				{
					policy: {
						priceImprovement: {
							factor: 0.5,
							maxVolumeFactor: 0.0098,
							quote: {
								sellAmount: "1331378299120234604",
								buyAmount: "28890491",
								fee: "166522301130290",
							},
						},
					},
					amount: "0",
					token: USDC,
				},
				{ policy: { volume: { factor: 0.0002 } }, amount: "5775", token: USDC },
				{ policy: { volume: { factor: 0.001 } }, amount: "28873", token: USDC },
			],
		});
		assert.deepEqual(trade, {
			block: 52559741,
			logIndex: 312,
			fees: [
				{
					policy: "priceImprovement",
					factor: 0.5,
					maxVolumeFactor: 0.0098,
					amount: "0",
					token: USDC,
				},
				{
					policy: "volume",
					factor: 0.0002,
					maxVolumeFactor: null,
					amount: "5775",
					token: USDC,
				},
				{
					policy: "volume",
					factor: 0.001,
					maxVolumeFactor: null,
					amount: "28873",
					token: USDC,
				},
			],
		});
	});
});

describe("partner fees in app data", () => {
	test("reads one fee or a list, in the formats CoW accepts", () => {
		assert.deepEqual(partnerFeePolicies({ recipient: RECIPIENT, volumeBps: 10 }), ["volume"]);
		assert.deepEqual(partnerFeePolicies({ recipient: RECIPIENT, bps: 50 }), ["volume"]);
		assert.deepEqual(
			partnerFeePolicies([
				{ recipient: RECIPIENT, surplusBps: 5000, maxVolumeBps: 100 },
				{ recipient: RECIPIENT, priceImprovementBps: 5000, maxVolumeBps: 100 },
			]),
			["surplus", "priceImprovement"]
		);
		assert.deepEqual(partnerFeePolicies(undefined), []);
	});

	test("a malformed fee drops them all, as CoW then charges none", () => {
		assert.deepEqual(
			partnerFeePolicies([
				{ recipient: RECIPIENT, volumeBps: 10 },
				{ recipient: RECIPIENT, volumeBps: 10, surplusBps: 5000 },
			]),
			[]
		);
		assert.deepEqual(partnerFeePolicies({ volumeBps: 10 }), []);
		assert.deepEqual(partnerFeePolicies({ recipient: RECIPIENT, volumeBps: 2.5 }), []);
	});
});
