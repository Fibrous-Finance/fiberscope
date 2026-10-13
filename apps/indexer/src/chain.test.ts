import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseSettlementLogs, SETTLEMENT, TOPIC } from "./chain.ts";

const TX = "0x27beb03583b4b54a46f22e8cbe07534e09d7576eba60da126c01544d069fee63";

describe("settlement logs", () => {
	test("a trade carries the uid of the order it filled", () => {
		// Block 52,559,741 on Base: one trade, which CoW's trades API lists under this uid.
		const { trades } = parseSettlementLogs([
			{
				address: SETTLEMENT,
				topics: [
					TOPIC.trade,
					"0x000000000000000000000000256534d1b3042a4906696e27868c7b4905628921",
				],
				data:
					"0x000000000000000000000000acfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf" +
					"000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913" +
					"000000000000000000000000000000000000000000000000127a018254b9b06c" +
					"0000000000000000000000000000000000000000000000000000000001b82098" +
					"0000000000000000000000000000000000000000000000000000000000000000" +
					"00000000000000000000000000000000000000000000000000000000000000c0" +
					"0000000000000000000000000000000000000000000000000000000000000038" +
					"f4eda79948847ba58b0a6c5e54def1c92b5082ded993d9ec1803eefdafb3fe43" +
					"256534d1b3042a4906696e27868c7b49056289216ace65b60000000000000000",
				blockNumber: "0x321ff7d",
				transactionHash: TX,
				logIndex: "0x138",
			},
			{
				address: SETTLEMENT,
				topics: [
					TOPIC.settlement,
					"0x0000000000000000000000004c7bdd2d75050c4fdb84ad47dd328dc5c07d7743",
				],
				data: "0x",
				blockNumber: "0x321ff7d",
				transactionHash: TX,
				logIndex: "0x13f",
			},
		]);
		assert.equal(trades.length, 1);
		assert.equal(
			trades[0].orderUid,
			"0xf4eda79948847ba58b0a6c5e54def1c92b5082ded993d9ec1803eefdafb3fe43" +
				"256534d1b3042a4906696e27868c7b49056289216ace65b6"
		);
		assert.equal(trades[0].sellAmount, "1331378299120234604");
	});
});
