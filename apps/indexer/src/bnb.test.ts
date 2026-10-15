import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";

import { BNB } from "@fiberscope/core";

import type { Rpc } from "./rpc.ts";
import type { SettlementParties } from "./rules.ts";

// The indexer as BNB Chain's. config.ts reads NETWORK when it loads, and static imports would load
// before NETWORK is set here; each test file runs in a process of its own.
process.env.NETWORK = "bnb";
const { DEFAULT_DB_PATH, NATIVE_TOKEN, readEnv } = await import("./config.ts");
const { ROUTER } = await import("./chain.ts");
const { TradeValuer } = await import("./facts.ts");
const { fillRelayVerdicts } = await import("./ingest.ts");
const { OVERRIDES } = await import("./overrides.ts");
const { Registry } = await import("./registry.ts");
const { creditedAddress } = await import("./rules.ts");
const { buildSnapshot } = await import("./snapshot.ts");
const { Store } = await import("./store.ts");
const { resolveSymbols } = await import("./symbols.ts");
const { windowReport } = await import("./window.ts");

const USDT = "0x55d398326f99059ff775485246999027b3197955";
const SOLVER = "0x5050505050505050505050505050505050505050";
const TX = `0x${"e".repeat(64)}`;
/** Euler's open-position bundle. */
const OPEN_POSITION = "0x64c26b3a182826fe2ab8c04c8caf40b0c4bf9a66";
/** Fractal's submission address: an account with an EIP-7702 delegation. */
const FRACTAL = "0x95480d3f27658e73b2785d30beb0c847d78294c7";
/** Rizzolver's solver contract, which its executor accounts call. */
const RIZZOLVER = "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7";
const EXECUTOR = "0x7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e7e";
/** A per-transaction account that sends router settlements; never a solver. */
const HELPER = "0x9598959895989598959895989598959895989598";
/** A day and a minute of blocks from block 1, which comes at T0. */
const END = 200_000;
const T0 = 1_790_000_000;

/** A transaction hash spelled from a readable label. */
function hash(label: string): string {
	return `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
}

/**
 * Batches, each a trade of 600 USDT for 1 BNB, oldest first. A transaction's recipient is the
 * address that called `settle` unless one is given.
 */
const RELAYED = [
	// Fractal sends the transaction to Euler's open-position bundle, which calls `settle`.
	{ label: "bundled", block: END - 100, solver: OPEN_POSITION, sender: FRACTAL },
	// A helper account sends it to Rizzolver's contract, which calls the flash-loan router.
	{ label: "routed", block: END - 90, solver: ROUTER, sender: HELPER, recipient: RIZZOLVER },
	// Rizzolver's contract calls `settle` itself, sent by one of its executors.
	{ label: "direct", block: END - 80, solver: RIZZOLVER, sender: EXECUTOR },
	{ label: "bundled again", block: END - 50, solver: OPEN_POSITION, sender: FRACTAL },
];

/** The chain data of RELAYED, and one auction that settled them all, with BNB at $600. */
function relayStore() {
	const store = new Store(":memory:");
	const range = { from: 1, to: END };
	store.commitChunk(
		{
			range,
			settlements: RELAYED.map(({ label, block, solver }) => ({
				tx: hash(label),
				logIndex: 2,
				block,
				solver,
				trades: 1,
				swaps: 1,
			})),
			trades: RELAYED.map(({ label, block }) => ({
				tx: hash(label),
				logIndex: 1,
				block,
				settlementLogIndex: 2,
				sellToken: USDT,
				buyToken: NATIVE_TOKEN,
				sellAmount: "600000000000000000000",
				buyAmount: "1000000000000000000",
				orderUid: `${hash(label)}${"0".repeat(48)}`,
			})),
			txs: RELAYED.map(({ label, block, solver, sender, recipient }) => ({
				tx: hash(label),
				block,
				sender,
				recipient: recipient ?? solver,
				gasUsed: 400_000,
				fee: "22000000000000",
			})),
			prices: [{ block: 1, answer: 600e8 }],
			anchors: [
				{ block: 1, time: T0 },
				{ block: END, time: T0 + 86_460 },
			],
		},
		range
	);
	store.saveCompetition(
		{
			auctionId: 1,
			startBlock: END - 110,
			txHashes: RELAYED.map(({ label }) => hash(label)),
			prices: new Map(),
			solutions: [],
		},
		[
			[BNB.native.wrapped, "1000000000000000000"],
			[USDT, "1666666666666667"],
		],
		RELAYED.map(({ label }) => ({ tx: hash(label), priced: true })),
		0
	);
	store.setAuctionRange(range);
	return store;
}

describe("BNB Chain", () => {
	test("reads its RPC from BNB_RPC_URL and BNB_RPC_RPS, and has a database of its own", () => {
		const env = readEnv({ BNB_RPC_URL: "https://bnb.example", BNB_RPC_RPS: "50" });
		assert.equal(env.rpcUrl, "https://bnb.example");
		assert.equal(env.rpcRps, 50);
		assert.throws(() => readEnv({ BASE_RPC_URL: "https://base.example" }), /BNB_RPC_URL/);
		assert.ok(DEFAULT_DB_PATH.endsWith(join(".data", "bnb.db")));
	});

	test("prices a buy of BNB as WBNB, at the BNB/USD rate, and names it BNB", async () => {
		const store = new Store(":memory:");
		const range = { from: 100, to: 199 };
		// 600 USDT (18 decimals on BNB Chain) sold for 1 BNB, with BNB at $600.
		store.commitChunk(
			{
				range,
				settlements: [
					{ tx: TX, logIndex: 2, block: 100, solver: SOLVER, trades: 1, swaps: 1 },
				],
				trades: [
					{
						tx: TX,
						logIndex: 1,
						block: 100,
						settlementLogIndex: 2,
						sellToken: USDT,
						buyToken: NATIVE_TOKEN,
						sellAmount: "600000000000000000000",
						buyAmount: "1000000000000000000",
						orderUid: `${TX}${"0".repeat(48)}`,
					},
				],
				txs: [
					{
						tx: TX,
						block: 100,
						sender: SOLVER,
						recipient: BNB.contracts.settlement,
						gasUsed: 400_000,
						fee: "22000000000000",
					},
				],
				prices: [{ block: 100, answer: 600e8 }],
				anchors: [{ block: 100, time: 1_790_000_000 }],
			},
			range
		);
		// CoW's native prices on BNB Chain are in BNB: WBNB is 1e18, a USDT atom a 600th of that.
		store.saveCompetition(
			{ auctionId: 1, startBlock: 95, txHashes: [TX], prices: new Map(), solutions: [] },
			[
				[BNB.native.wrapped, "1000000000000000000"],
				[USDT, "1666666666666667"],
			],
			[{ tx: TX, priced: true }],
			0
		);
		const [trade] = store.tradeRows(range);
		const { usd, pricedSides } = new TradeValuer(store).value(trade);
		assert.equal(pricedSides, 2);
		assert.ok(Math.abs(usd! - 600) < 1e-6);

		const rpc = { batch: () => assert.fail("no symbol to look up") } as unknown as Rpc;
		const symbols = await resolveSymbols(rpc, store, [NATIVE_TOKEN]);
		assert.equal(symbols.get(NATIVE_TOKEN), "BNB");
	});

	test("refuses Base's database without touching it", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "base.db");
		// A version 3 database, which only the Base indexer wrote.
		const base = new DatabaseSync(path);
		base.exec(`
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
			CREATE TABLE settlements (block INTEGER NOT NULL, log_index INTEGER NOT NULL,
				PRIMARY KEY (block, log_index)) WITHOUT ROWID;
			CREATE TABLE eth_usd (block INTEGER PRIMARY KEY, answer INTEGER NOT NULL);
			PRAGMA user_version = 3;
		`);
		base.close();
		assert.throws(
			() => new Store(path),
			/is a Base database; this indexer covers BNB Chain \(NETWORK=bnb\)/
		);
		const after = new DatabaseSync(path, { readOnly: true });
		assert.equal(after.prepare("PRAGMA user_version").get()?.user_version, 3);
		assert.equal(
			after.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'anchors'").get(),
			undefined
		);
		after.close();
	});

	test("records its chain id in a new database", () => {
		const path = join(mkdtempSync(join(tmpdir(), "fiberscope-")), "bnb.db");
		new Store(path).close();
		const db = new DatabaseSync(path, { readOnly: true });
		assert.equal(
			db.prepare("SELECT value FROM meta WHERE key = 'chain_id'").get()?.value,
			"56"
		);
		db.close();
	});
});

describe("BNB Chain attribution", () => {
	const unregistered = () => false;

	test("credits a bundle settlement to the solver that sent it, never to the bundle", () => {
		// The bundle is the transaction's recipient, and allow-listed itself.
		const bundled: SettlementParties = {
			solver: OPEN_POSITION,
			sender: FRACTAL,
			senderIsSolver: true,
			recipient: OPEN_POSITION,
			recipientIsSolver: true,
		};
		assert.deepEqual(
			creditedAddress(bundled, unregistered, () => null),
			{
				address: FRACTAL,
				source: "sender",
			}
		);
		// A sender the AllowList was never asked about counts when it is registered.
		const unchecked = { ...bundled, senderIsSolver: false, recipientIsSolver: false };
		assert.deepEqual(
			creditedAddress(
				unchecked,
				(address) => address === FRACTAL,
				() => null
			),
			{ address: FRACTAL, source: "sender" }
		);
		// Sent by an account that is neither: CoW's winner.
		const helped = { ...bundled, sender: HELPER, senderIsSolver: false };
		assert.deepEqual(
			creditedAddress(helped, unregistered, () => FRACTAL),
			{
				address: FRACTAL,
				source: "winner",
			}
		);
	});

	test("credits a router settlement as before, and never to a bundle that called it", () => {
		const routed: SettlementParties = {
			solver: ROUTER,
			sender: HELPER,
			senderIsSolver: false,
			recipient: RIZZOLVER,
			recipientIsSolver: true,
		};
		assert.deepEqual(
			creditedAddress(routed, unregistered, () => null),
			{
				address: RIZZOLVER,
				source: "recipient",
			}
		);
		const bundled = {
			...routed,
			sender: FRACTAL,
			senderIsSolver: true,
			recipient: OPEN_POSITION,
		};
		assert.deepEqual(
			creditedAddress(bundled, unregistered, () => null),
			{
				address: FRACTAL,
				source: "sender",
			}
		);
	});

	test("registers Rizzolver and Fractal, which the CMS lists for Ethereum only", () => {
		assert.deepEqual(OVERRIDES, [
			{
				address: RIZZOLVER,
				env: "prod",
				active: true,
				solverId: "rizzolver",
				name: "Rizzolver",
			},
			{ address: FRACTAL, env: "prod", active: true, solverId: "fractal", name: "Fractal" },
		]);
	});

	test("fills the AllowList verdicts that relay settlements lack, and only those", async () => {
		const store = relayStore();
		store.saveAllowListVerdict(HELPER, false);
		const checked: [address: string, block: number][] = [];
		const rpc = {
			call: async (method: string, params: unknown[]) => {
				const [{ to, data }, block] = params as [{ to: string; data: string }, string];
				assert.equal(method, "eth_call");
				assert.equal(to, BNB.contracts.allowList);
				checked.push([`0x${data.slice(-40)}`, Number(block)]);
				return `0x${"1".padStart(64, "0")}`;
			},
		} as unknown as Rpc;
		await fillRelayVerdicts(store, rpc);
		// Once per address, at its first relay settlement; never a relay, an address already
		// checked, or the parties of a settlement no relay made.
		assert.deepEqual(checked, [
			[FRACTAL, END - 100],
			[RIZZOLVER, END - 90],
		]);
		assert.equal(store.allowListVerdict(FRACTAL), true);
		assert.equal(store.allowListVerdict(RIZZOLVER), true);
		assert.equal(store.allowListVerdict(HELPER), false);
		for (const address of [OPEN_POSITION, ROUTER, EXECUTOR]) {
			assert.equal(store.allowListVerdict(address), null);
		}
		const done = { call: () => assert.fail("nothing is left to check") } as unknown as Rpc;
		await fillRelayVerdicts(store, done);
	});

	test("a bundle's batches and their trades count for the solver that sent them", async () => {
		const store = relayStore();
		store.setLastRunAt(Date.now());
		const registry = new Registry([], OVERRIDES);
		const { snapshot } = await buildSnapshot({
			store,
			registry,
			refreshMinutes: 10,
			commit: null,
			symbols: async () =>
				new Map([
					[USDT, "USDT"],
					[NATIVE_TOKEN, "BNB"],
				]),
		});
		assert.deepEqual(snapshot.coverage, {
			chainDays: 1,
			auctionDays: 1,
			surplusDays: 1,
			detailDays: 0,
		});
		assert.deepEqual(
			snapshot.solvers.map(({ id, batches, trades, volume }) => ({
				id,
				batches,
				trades,
				volume,
			})),
			[
				{ id: "fractal", batches: [2], trades: [2], volume: [1_200] },
				{ id: "rizzolver", batches: [2], trades: [2], volume: [1_200] },
			]
		);
		const report = windowReport(store, registry, { from: 1, to: END });
		assert.match(report, /^Batches {4}4 \(1 via the flash-loan router, 2 via Atomic Bundles;/m);
		assert.match(report, /^Volume {5}\$2,400$/m);
	});

	test("a bundle settlement keeps its auction while it is in the chain data", () => {
		const store = relayStore();
		// Auction data goes below the last settlement, but the relays' settlements keep theirs:
		// their attribution may need the auction's winner.
		store.prune(1, END - 60);
		assert.equal(store.competitionLink(hash("bundled"))?.auctionId, 1);
		assert.equal(store.competitionLink(hash("routed"))?.auctionId, 1);
		assert.equal(store.competitionLink(hash("direct")), null);
	});
});
