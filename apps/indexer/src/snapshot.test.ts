import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Snapshot } from "@fiberscope/core";

import { ROUTER, SETTLEMENT } from "./chain.ts";
import type { OrderDetail, Solution } from "./cow.ts";
import { Registry } from "./registry.ts";
import type { RegistryEntry } from "./registry.ts";
import { buildSnapshot } from "./snapshot.ts";
import { Store } from "./store.ts";
import type { StoredFee } from "./store.ts";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
/** A day of Base blocks, one every 2 seconds. */
const DAY = 43_200;
/** Three whole days of chain data, from block 1: bucket 2 starts there, bucket 0 ends here. */
const END = 3 * DAY;

/** A block's time as on Base: block 0 at 1686789347, then one every 2 seconds. */
function timeOf(block: number): number {
	return 1_686_789_347 + 2 * block;
}

const ARC = "0xa1c1";
const RIZZOLVER = "0x8f58";
const RIZZOLVER_RETIRED = "0x4dd1";
const SECTOR = "0x5c35";
const CURVE = "0x821a";
/** A per-transaction account that sends router settlements; never a solver. */
const HELPER = "0x9598";
/** An address no registry lists. */
const STRANGER = "0xdead";

const CMS: RegistryEntry[] = [
	{ address: ARC, env: "prod", active: true, solverId: "arc", name: "Arc" },
	{
		address: RIZZOLVER_RETIRED,
		env: "prod",
		active: false,
		solverId: "rizzolver",
		name: "Rizzolver",
	},
	{ address: SECTOR, env: "prod", active: true, solverId: "sector", name: "Sector Finance" },
	{ address: SECTOR, env: "barn", active: false, solverId: "sector", name: "Sector Finance" },
	{ address: CURVE, env: "prod", active: false, solverId: "curve", name: "Curve" },
];
const OVERRIDES: RegistryEntry[] = [
	{ address: RIZZOLVER, env: "prod", active: true, solverId: "rizzolver", name: "Rizzolver" },
];

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
}

interface Settled {
	tx: string;
	block: number;
	/** The Settlement event's solver: the address that called `settle`. */
	solver: string;
	swaps: number;
	trades?: number;
	logIndex?: number;
	/** The transaction's sender; the solver by default. */
	sender?: string;
	/** The transaction's recipient; the settlement contract by default. */
	recipient?: string;
	/** The order's limit buy amount (WETH atoms); 0.4 WETH by default. */
	limitBuy?: string;
}

/** Oldest first. Sector and Curve never settle; the stranger is not in the registry. */
const SETTLED: Settled[] = [
	{ tx: hash("old"), block: 100, solver: ARC, swaps: 4 },
	{
		tx: hash("routed-old"),
		block: 50_000,
		solver: ROUTER,
		sender: HELPER,
		recipient: RIZZOLVER,
		swaps: 5,
	},
	// 52 batches of Arc in bucket 0; the newest, arc0, at END − 1,000.
	...Array.from({ length: 52 }, (_, i) => ({
		tx: hash(`arc${i}`),
		block: END - 1_000 - i,
		solver: ARC,
		swaps: 1,
	})).reverse(),
	{ tx: hash("stranger"), block: END - 30, solver: STRANGER, swaps: 1 },
	// A buffer settlement: no trade, so no batch.
	{ tx: hash("buffer"), block: END - 20, solver: ARC, trades: 0, swaps: 7 },
	// Two batches in one transaction. Each fills 1,000 USDC for 0.5 WETH: the first against a
	// limit of 0.45 WETH, a surplus of exactly a tenth of its value; the second one atom lower.
	{
		tx: hash("pair"),
		block: END - 15,
		logIndex: 3,
		solver: ARC,
		swaps: 1,
		limitBuy: "450000000000000000",
	},
	{
		tx: hash("pair"),
		block: END - 15,
		logIndex: 7,
		solver: ARC,
		swaps: 6,
		limitBuy: "449999999999999999",
	},
	// Neither sender nor recipient is a solver: the auction's winning solution (Arc's) decides.
	{
		tx: hash("won"),
		block: END - 10,
		solver: ROUTER,
		sender: HELPER,
		recipient: ROUTER,
		swaps: 3,
	},
	{
		tx: hash("routed"),
		block: END - 5,
		solver: ROUTER,
		sender: HELPER,
		recipient: RIZZOLVER,
		swaps: 2,
	},
];

/** Every trade sells 1,000 USDC for 0.5 WETH; its order asked for at least `limitBuy`. */
function terms(limitBuy = "400000000000000000") {
	return { limitSellAmount: "1000000000", limitBuyAmount: limitBuy, feeAmount: "0" };
}

/** The uid of the order of a settlement's first trade. */
function uid(label: string): string {
	return `${hash(label)}${"0".repeat(48)}`;
}

/** Solutions in CoW's ranking, in the order given; scores in wei of ETH. */
function ranked(
	...entries: [solver: string, score: string, flag?: "won" | "filtered"][]
): Solution[] {
	return entries.map(([solver, score, flag], i) => ({
		solver,
		ranking: i + 1,
		winner: flag === "won",
		tx: null,
		score,
		referenceScore: null,
		filteredOut: flag === "filtered",
	}));
}

/** An order in CoW's order book, placed with a solver's quote. */
function quoted(solver: string, verified: boolean): OrderDetail {
	const amounts = { sellAmount: "1000000000", buyAmount: "500000000000000000", feeAmount: "0" };
	return {
		kind: "sell",
		appClass: null,
		partnerFees: [],
		quote: { solver, verified, ...amounts },
	};
}

function fee(partner: boolean, amount: string, token: string): StoredFee {
	return { policy: "volume", factor: 0.0002, maxVolumeFactor: null, partner, amount, token };
}

/** Builds the snapshot of SETTLED. */
async function build(): Promise<Snapshot> {
	const store = new Store(":memory:");
	const range = { from: 1, to: END };
	store.commitChunk(
		{
			range,
			settlements: SETTLED.map(({ tx, block, solver, swaps, trades = 1, logIndex = 10 }) => ({
				tx,
				logIndex,
				block,
				solver,
				trades,
				swaps,
			})),
			trades: SETTLED.flatMap(({ tx, block, trades = 1, logIndex = 10, limitBuy }) =>
				Array.from({ length: trades }, (_, i) => ({
					tx,
					logIndex: logIndex - trades + i,
					block,
					settlementLogIndex: logIndex,
					sellToken: USDC,
					buyToken: WETH,
					sellAmount: "1000000000",
					buyAmount: "500000000000000000",
					orderUid: `${tx}${String(i).padStart(48, "0")}`,
					terms: terms(limitBuy),
				}))
			),
			// 400K gas at 0.01 gwei plus 0.0000001 ETH of L1 fee: 0.0000041 ETH, $0.0082.
			txs: [...new Map(SETTLED.map((s) => [s.tx, s])).values()].map((s) => ({
				tx: s.tx,
				block: s.block,
				sender: s.sender ?? s.solver,
				recipient: s.recipient ?? SETTLEMENT,
				gasUsed: 400_000,
				fee: "4100000000000",
			})),
			prices: [{ block: 1, answer: 2_000e8 }],
			// Base's block times, anchored at the ends of the range.
			anchors: [1, END].map((block) => ({ block, time: timeOf(block) })),
		},
		range
	);
	// The auction of won and pair priced USDC at $1 and WETH at $2,000.
	store.saveCompetition(
		{
			auctionId: 4,
			startBlock: END - 14,
			txHashes: [hash("won"), hash("pair")],
			prices: new Map(),
			solutions: [
				{
					solver: ARC,
					ranking: 1,
					winner: true,
					tx: hash("won"),
					score: "1000",
					referenceScore: null,
					filteredOut: false,
				},
			],
		},
		[
			[USDC, "500000000000000000000000000"],
			[WETH, "1000000000000000000"],
		],
		[
			{ tx: hash("won"), priced: true },
			{ tx: hash("pair"), priced: true },
		],
		0
	);
	const compete = (auctionId: number, startBlock: number, solutions: Solution[]) =>
		store.saveCompetition(
			{ auctionId, startBlock, txHashes: [], prices: new Map(), solutions },
			[],
			[],
			0
		);
	// Older than the detail days.
	compete(1, 100, ranked([ARC, "1000000000000000000", "won"]));
	// Two winners.
	compete(
		2,
		END - 200,
		ranked(
			[ARC, "1000000000000000000", "won"],
			[SECTOR, "500000000000000000", "won"],
			[CURVE, "400000000000000000"]
		)
	);
	// One winner, Arc's 1 ETH: Sector 0.5% below with its best solution, Rizzolver exactly 1%,
	// Curve 1.2%; the stranger's only solution, though higher, was filtered out.
	compete(
		3,
		END - 100,
		ranked(
			[ARC, "1000000000000000000", "won"],
			[SECTOR, "995000000000000000"],
			[RIZZOLVER, "990000000000000000"],
			[CURVE, "987654321000000000"],
			[ARC, "900000000000000000"],
			[SECTOR, "500000000000000000"],
			[STRANGER, "1500000000000000000", "filtered"]
		)
	);
	store.setAuctionRange(range);
	// The details cover the last two days. arc0's order is not in CoW's order book; the
	// stranger's quote names the zero address; the orders of the other arc batches were never
	// looked up.
	store.setDetailRange({ from: END - 2 * DAY + 1, to: END });
	store.saveOrders([
		{ uid: uid("won"), block: END - 10, detail: quoted(ARC, true) },
		{ uid: uid("routed"), block: END - 5, detail: quoted(ARC, false) },
		{ uid: uid("pair"), block: END - 15, detail: quoted(RIZZOLVER_RETIRED, true) },
		{
			uid: uid("stranger"),
			block: END - 30,
			detail: quoted("0x0000000000000000000000000000000000000000", true),
		},
		{ uid: uid("arc0"), block: END - 1_000, detail: null },
	]);
	store.saveTradeFees(uid("won"), [
		{
			block: END - 10,
			logIndex: 9,
			fees: [fee(false, "1000000000000000", WETH), fee(true, "1000000", USDC)],
		},
	]);
	store.saveTradeFees(uid("routed"), [
		{ block: END - 5, logIndex: 9, fees: [fee(false, "500000", USDC)] },
	]);
	store.saveTradeFees(uid("pair"), [
		{ block: END - 15, logIndex: 2, fees: [fee(false, "500000000000000", WETH)] },
		{ block: END - 15, logIndex: 6, fees: [fee(false, "500000000000000", WETH)] },
	]);
	store.saveTradeFees(uid("stranger"), [{ block: END - 30, logIndex: 9, fees: [] }]);
	store.saveTradeFees(uid("arc0"), [{ block: END - 1_000, logIndex: 9, fees: null }]);
	store.setLastRunAt(Date.now());
	const { snapshot } = await buildSnapshot({
		store,
		registry: new Registry(CMS, OVERRIDES),
		refreshMinutes: 10,
		commit: null,
		symbols: async () =>
			new Map([
				[USDC, "USDC"],
				[WETH, "WETH"],
			]),
	});
	return snapshot;
}

describe("snapshot", () => {
	test("a solver's daily swaps are the DEX swaps of the batches credited to it", async () => {
		const { coverage, solvers } = await build();
		assert.equal(coverage.chainDays, 3);
		const byId = new Map(solvers.map((solver) => [solver.id, solver]));
		assert.deepEqual(byId.get("arc")?.batches, [55, 0, 1]);
		assert.deepEqual(byId.get("arc")?.swaps, [62, 0, 4]);
		assert.deepEqual(byId.get("rizzolver")?.batches, [1, 1, 0]);
		assert.deepEqual(byId.get("rizzolver")?.swaps, [2, 5, 0]);
		assert.deepEqual(byId.get(STRANGER)?.swaps, [1, 0, 0]);
		// The network's swaps: every batch's, without the buffer settlement's 7.
		const total = solvers.flatMap((solver) => solver.swaps).reduce((a, b) => a + b, 0);
		assert.equal(total, 74);
	});

	test("the latest settlements are the newest 50 batches of all solvers, newest first", async () => {
		const { latestSettlements } = await build();
		assert.equal(latestSettlements.length, 50);
		assert.deepEqual(latestSettlements[0], {
			tx: hash("routed"),
			block: END - 5,
			time: timeOf(END - 5) * 1000,
			trades: 1,
			pair: { sell: "USDC", buy: "WETH" },
			volume: null,
			surplus: null,
			gas: 400_000,
			cost: 0.0082,
			solver: "rizzolver",
			swaps: 2,
			protocolFee: null,
			partnerFee: null,
			quotedBy: "arc",
		});
		assert.deepEqual(
			latestSettlements.slice(0, 5).map(({ tx, solver, swaps }) => ({ tx, solver, swaps })),
			[
				{ tx: hash("routed"), solver: "rizzolver", swaps: 2 },
				{ tx: hash("won"), solver: "arc", swaps: 3 },
				// The later Settlement event of the transaction first.
				{ tx: hash("pair"), solver: "arc", swaps: 6 },
				{ tx: hash("pair"), solver: "arc", swaps: 1 },
				{ tx: hash("stranger"), solver: STRANGER, swaps: 1 },
			]
		);
		assert.deepEqual(
			latestSettlements.slice(5).map((settlement) => settlement.tx),
			Array.from({ length: 45 }, (_, i) => hash(`arc${i}`))
		);
	});

	test("a batch costs its tx's fee at ETH/USD, split between the tx's batches", async () => {
		const { solvers, latestSettlements } = await build();
		const arc = solvers.find((solver) => solver.id === "arc");
		// Bucket 0: 52 one-batch txs, won, and the two batches of pair at $0.0041 each.
		assert.deepEqual(
			arc?.cost,
			[54 * 0.0082, 0, 0.0082].map((usd) => +usd.toFixed(4))
		);
		assert.deepEqual(
			latestSettlements.slice(2, 4).map(({ tx, gas, cost }) => ({ tx, gas, cost })),
			[
				{ tx: hash("pair"), gas: 200_000, cost: 0.0041 },
				{ tx: hash("pair"), gas: 200_000, cost: 0.0041 },
			]
		);
	});

	test("surplus is priced like volume, over the trades with order terms", async () => {
		const { coverage, solvers, latestSettlements } = await build();
		assert.deepEqual(coverage, { chainDays: 3, auctionDays: 3, surplusDays: 3, detailDays: 2 });
		const arc = solvers.find((solver) => solver.id === "arc");
		// Only the auction of won and pair is priced: three trades of $1,000. won got 0.1 WETH
		// over the 0.4 asked of 0.5, a surplus of $200; each pair trade about $100.
		assert.deepEqual(arc?.volume, [3_000, 0, 0]);
		assert.deepEqual(arc?.surplus, [400, 0, 0]);
		assert.deepEqual(arc?.surplusTrades, [3, 0, 0]);
		assert.deepEqual(arc?.surplusVolume, [3_000, 0, 0]);
		assert.deepEqual(
			latestSettlements
				.filter(({ tx }) => tx === hash("won"))
				.map(({ volume, surplus }) => ({ volume, surplus })),
			[{ volume: 1_000, surplus: 200 }]
		);
	});

	test("surplus of more than a tenth of the trade's value counts as unusual", async () => {
		const arc = (await build()).solvers.find((solver) => solver.id === "arc");
		// won (a fifth) and the second pair trade (a tenth and a hair) are unusual; the first pair
		// trade, at exactly a tenth, is not.
		assert.deepEqual(arc?.unusualTrades, [2, 0, 0]);
		assert.deepEqual(arc?.unusualSurplus, [300, 0, 0]);
		assert.deepEqual(arc?.unusualVolume, [2_000, 0, 0]);
	});

	test("the registry lists every registry solver, also the ones that never settled", async () => {
		const { registry } = await build();
		assert.deepEqual(registry, [
			{
				id: "rizzolver",
				name: "Rizzolver",
				// Active through the override; the CMS only lists a retired address.
				active: true,
				addresses: [
					{ env: "prod", address: RIZZOLVER, active: true },
					{ env: "prod", address: RIZZOLVER_RETIRED, active: false },
				],
				lastSettlement: {
					tx: hash("routed"),
					block: END - 5,
					time: timeOf(END - 5) * 1000,
				},
				batches: 2,
			},
			{
				id: "arc",
				name: "Arc",
				active: true,
				addresses: [{ env: "prod", address: ARC, active: true }],
				lastSettlement: { tx: hash("won"), block: END - 10, time: timeOf(END - 10) * 1000 },
				batches: 56,
			},
			{
				id: "sector",
				name: "Sector Finance",
				active: true,
				addresses: [
					{ env: "prod", address: SECTOR, active: true },
					{ env: "barn", address: SECTOR, active: false },
				],
				lastSettlement: null,
				batches: 0,
			},
			{
				id: "curve",
				name: "Curve",
				active: false,
				addresses: [{ env: "prod", address: CURVE, active: false }],
				lastSettlement: null,
				batches: 0,
			},
		]);
	});

	test("an auction lists every solution in CoW's ranking, with its score in USD", async () => {
		const { latestAuctions } = await build();
		assert.deepEqual(
			latestAuctions.map(({ id }) => id),
			[1, 2, 3, 4]
		);
		const auction = latestAuctions.find(({ id }) => id === 3);
		// ETH at $2,000; scores to 6 significant figures; the flags only when set.
		assert.deepEqual(auction?.solutions, [
			{ solver: "arc", score: 2_000, winner: true },
			{ solver: "sector", score: 1_990 },
			{ solver: "rizzolver", score: 1_980 },
			{ solver: "curve", score: 1_975.31 },
			{ solver: "arc", score: 1_800 },
			{ solver: "sector", score: 1_000 },
			{ solver: STRANGER, score: 3_000, filteredOut: true },
		]);
		assert.deepEqual(auction?.entered, ["arc", "sector", "rizzolver", "curve", STRANGER]);
	});

	test("losses count only single-winner auctions, as close ones within 1% of the winner", async () => {
		const byId = new Map((await build()).solvers.map((solver) => [solver.id, solver]));
		const figures = (id: string) => {
			const solver = byId.get(id);
			return [solver?.solutions, solver?.filteredOut, solver?.losses, solver?.closeLosses];
		};
		// Solutions in auctions 2, 3 and 4; auction 1 is older than the detail days. Only auction
		// 3 has a single winner.
		assert.deepEqual(figures("arc"), [
			[4, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		]);
		assert.deepEqual(figures("sector"), [
			[3, 0],
			[0, 0],
			[1, 0],
			[1, 0],
		]);
		assert.deepEqual(figures("rizzolver"), [
			[1, 0],
			[0, 0],
			[1, 0],
			[1, 0],
		]);
		assert.deepEqual(figures("curve"), [
			[2, 0],
			[0, 0],
			[1, 0],
			[0, 0],
		]);
		assert.deepEqual(figures(STRANGER), [
			[1, 0],
			[1, 0],
			[0, 0],
			[0, 0],
		]);
	});

	test("a quote counts for the solver that gave it, settled itself when it settled the trade", async () => {
		const byId = new Map((await build()).solvers.map((solver) => [solver.id, solver]));
		const quotes = (id: string) => {
			const solver = byId.get(id);
			return [solver?.quotes, solver?.quotesVerified, solver?.quotesSettled];
		};
		// Arc quoted won, which the API's winner credits to it, and routed, Rizzolver's; Rizzolver
		// quoted both pair trades from its retired address. The stranger's quote names no solver.
		assert.deepEqual(quotes("arc"), [
			[2, 0],
			[1, 0],
			[1, 0],
		]);
		assert.deepEqual(quotes("rizzolver"), [
			[2, 0],
			[2, 0],
			[0, 0],
		]);
		assert.deepEqual(quotes(STRANGER), [
			[0, 0],
			[0, 0],
			[0, 0],
		]);
	});

	test("fees are valued at their trade's rate and go to the solver that settled it", async () => {
		const { solvers, latestSettlements } = await build();
		const byId = new Map(solvers.map((solver) => [solver.id, solver]));
		// won's $1,000 trade bought 0.5 WETH: CoW's 0.001 WETH is $2, the partner's 1 of the 1,000
		// USDC sold $1. Each pair trade paid 0.0005 WETH, $1. routed's fee cannot be valued: its
		// trade has no auction prices.
		assert.deepEqual(byId.get("arc")?.protocolFees, [4, 0]);
		assert.deepEqual(byId.get("arc")?.partnerFees, [1, 0]);
		assert.deepEqual(byId.get("rizzolver")?.protocolFees, [0, 0]);
		const rows = (label: string) =>
			latestSettlements
				.filter(({ tx }) => tx === hash(label))
				.map(({ protocolFee, partnerFee, quotedBy }) => [
					protocolFee,
					partnerFee,
					quotedBy,
				]);
		assert.deepEqual(rows("won"), [[2, 1, "arc"]]);
		assert.deepEqual(rows("routed"), [[null, null, "arc"]]);
		assert.deepEqual(rows("pair"), [
			[1, 0, "rizzolver"],
			[1, 0, "rizzolver"],
		]);
		assert.deepEqual(rows("stranger"), [[0, 0, null]]);
		// arc0's order is not in CoW's order book, so its fees are unknown and it had no quote.
		assert.deepEqual(rows("arc0"), [[null, null, null]]);
		// arc1's order was never looked up.
		const arc1 = latestSettlements.find(({ tx }) => tx === hash("arc1"));
		assert.deepEqual(
			[arc1?.protocolFee, arc1?.partnerFee, arc1 && "quotedBy" in arc1],
			[null, null, false]
		);
		// A solver's own latest settlements carry the quote but not the fees.
		const [latest] = byId.get("arc")?.latestSettlements ?? [];
		assert.deepEqual(
			[latest.tx, latest.quotedBy, "protocolFee" in latest],
			[hash("won"), "arc", false]
		);
	});
});
