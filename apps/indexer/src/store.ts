import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";

import { BASE, NETWORKS } from "@fiberscope/core";

import { RELAYS } from "./chain.ts";
import type { SettlementRow, TradeRow } from "./chain.ts";
import { Clock } from "./clock.ts";
import type { Anchor } from "./clock.ts";
import { NATIVE_TOKEN, NETWORK } from "./config.ts";
import type { Competition, ExecutedFee, FeePolicy, OrderDetail, Solution } from "./cow.ts";
import { log } from "./log.ts";
import type { PricePoint } from "./prices.ts";
import type { RegistryEntry } from "./registry.ts";
import type { BlockRange } from "./rules.ts";

/** Receipt facts of a transaction that holds at least one batch. */
export interface TxRow {
	tx: string;
	block: number;
	sender: string;
	/**
	 * The receipt's `to`. Null in rows stored before it was kept; attribution reads it only for
	 * the transactions of relay settlements, and those all have it.
	 */
	recipient: string | null;
	gasUsed: number;
	/** What the transaction paid, in wei: gas used × effective gas price, plus Base's L1 data fee. */
	fee: string;
}

/** Everything one block range of chain data adds to the database. */
export interface ChainChunk {
	range: BlockRange;
	settlements: SettlementRow[];
	trades: TradeRow[];
	txs: TxRow[];
	prices: PricePoint[];
	/** Block times in the range, for the clock. */
	anchors: Anchor[];
}

/** How a settlement transaction is linked to its competition. */
export interface CompetitionLink {
	/** Null when the API had no competition for the transaction. */
	auctionId: number | null;
	/** Whether auction_prices holds the prices of this transaction's trades. */
	priced: boolean;
	/** Unix seconds of the lookup. */
	checkedAt: number;
}

export interface BatchRow {
	tx: string;
	logIndex: number;
	block: number;
	solver: string;
	trades: number;
	/** Interaction events other than approvals and unwraps of the wrapped native token. */
	swaps: number;
	sender: string;
	recipient: string | null;
	gasUsed: number;
	/** The transaction's fee in wei (see TxRow). */
	fee: string;
	/** The AllowList verdict on the sender, if it was ever checked (relay settlements' senders). */
	senderIsSolver: number | null;
	/** The same for the recipient (relay settlements' recipients, other than relays). */
	recipientIsSolver: number | null;
	/** Batches in the same transaction; they share its gas and its fee. */
	txBatches: number;
}

export interface TradeValueRow {
	tx: string;
	/** The address that called `settle` for the trade's settlement. */
	solver: string;
	settlementLogIndex: number;
	block: number;
	sellToken: string;
	buyToken: string;
	sellAmount: string;
	buyAmount: string;
	/** The order terms (see OrderTerms); null when they are not known. */
	limitSellAmount: string | null;
	limitBuyAmount: string | null;
	feeAmount: string | null;
	/**
	 * The native prices its auction gave its sell and buy tokens (see priceToken); null when the
	 * trade has no auction or the auction gave its token no price.
	 */
	sellPrice: string | null;
	buyPrice: string | null;
}

/** A trade with its order terms and its transaction's recipient, for checking the terms. */
export interface TermRow {
	tx: string;
	block: number;
	logIndex: number;
	/** The transaction's recipient (`tx.to`); null in rows stored before it was kept. */
	recipient: string | null;
	sellToken: string;
	buyToken: string;
	limitSellAmount: string | null;
	limitBuyAmount: string | null;
	feeAmount: string | null;
}

export interface SolutionRow {
	auctionId: number;
	startBlock: number;
	solver: string;
	winner: number;
	tx: string | null;
	/** 1 when CIP-67's filter removed the solution; null until its auction is scored. */
	filteredOut: number | null;
	/** Its score in wei of the native token (see Solution); null until its auction is scored. */
	score: string | null;
}

/** A trade whose protocol fees were never looked up, with what its order's lookup found. */
export interface PendingFeeTrade {
	uid: string;
	block: number;
	logIndex: number;
	/** Whether CoW's order book has the order. */
	found: boolean;
	/** The policies of the partner fees in the order's app data, in order. */
	partnerFees: FeePolicy[];
}

/** A protocol fee as stored: whether it is a partner fee, or null when that is unclear. */
export interface StoredFee extends ExecutedFee {
	partner: boolean | null;
}

/** A trade with its order's quote and its protocol fees, for reports. */
export interface TradeDetailRow {
	block: number;
	logIndex: number;
	settlementLogIndex: number;
	/** The address that called `settle` for the trade's settlement. */
	solver: string;
	sellToken: string;
	buyToken: string;
	sellAmount: string;
	buyAmount: string;
	/** See TradeValueRow. */
	sellPrice: string | null;
	buyPrice: string | null;
	/** 1 when CoW's order book has the order, 0 when it lacks it, null when not looked up. */
	found: number | null;
	quoteSolver: string | null;
	quoteVerified: number | null;
	/** See the trades table. */
	feesChecked: number | null;
	/** The fee rows as `partner amount token` items joined by commas; partner is 1, 0 or ?. */
	fees: string | null;
}

/** The schema's `PRAGMA user_version`. */
const SCHEMA_VERSION = 4;

/**
 * When Base's block 0 came (Unix seconds). Base makes a block every 2 seconds exactly, so this
 * gives every Base block's time: the anchors of a database upgraded from version 3, which every
 * earlier indexer wrote for Base.
 */
const BASE_GENESIS = 1_686_789_347;

/**
 * Settlements and trades are keyed by block and log index, so a block range is one stretch of
 * each table. Addresses are stored once, in `addresses`, and referred to by id; transaction
 * hashes and order uids are stored as their bytes.
 */
const SCHEMA = `
-- Sync progress, and chain_id: the network whose data the database holds.
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) WITHOUT ROWID;

-- Every address the other tables refer to by id: solvers, senders, recipients and tokens.
CREATE TABLE IF NOT EXISTS addresses (
	id INTEGER PRIMARY KEY,
	address TEXT NOT NULL UNIQUE
);

-- One row per Settlement event; a batch is a settlement with at least one trade. A batch carries
-- its transaction's receipt facts (see TxRow) and tx_batches, the batches in that transaction,
-- which share its gas and fee; they are null for a settlement without trades.
CREATE TABLE IF NOT EXISTS settlements (
	block INTEGER NOT NULL,
	log_index INTEGER NOT NULL,
	tx BLOB NOT NULL,
	solver INTEGER NOT NULL,
	trades INTEGER NOT NULL,
	swaps INTEGER NOT NULL,
	sender INTEGER,
	recipient INTEGER,
	gas_used INTEGER,
	fee INTEGER,
	tx_batches INTEGER,
	PRIMARY KEY (block, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS settlements_by_tx ON settlements (tx);
CREATE INDEX IF NOT EXISTS settlements_by_solver ON settlements (solver, block);

-- One row per Trade event, under the settlement at settlement_log_index in the same block.
-- limit_sell_amount, limit_buy_amount and fee_amount are the order terms read from the settle()
-- calldata (see OrderTerms); null when no settle() call in the calldata reproduces the trade.
-- order_uid is null only in rows stored before the schema held it, until it is filled in.
-- fees_checked is null until the trade's protocol fees are looked up; then 1 when trade_fees
-- holds them (possibly none), 0 when they are unknown: the order is not in CoW's order book, or
-- the API never listed the trade.
CREATE TABLE IF NOT EXISTS trades (
	block INTEGER NOT NULL,
	log_index INTEGER NOT NULL,
	settlement_log_index INTEGER NOT NULL,
	sell_token INTEGER NOT NULL,
	buy_token INTEGER NOT NULL,
	sell_amount TEXT NOT NULL,
	buy_amount TEXT NOT NULL,
	limit_sell_amount TEXT,
	limit_buy_amount TEXT,
	fee_amount TEXT,
	order_uid BLOB,
	fees_checked INTEGER,
	PRIMARY KEY (block, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS trades_without_uid ON trades (block) WHERE order_uid IS NULL;

-- AllowList isSolver verdicts, checked once per address (relay settlements' senders, recipients).
CREATE TABLE IF NOT EXISTS allow_list (
	address INTEGER PRIMARY KEY,
	is_solver INTEGER NOT NULL
);

-- Chainlink answers for the native token's USD price (8 decimals), each valid from its block until
-- the next row.
CREATE TABLE IF NOT EXISTS native_usd (
	block INTEGER PRIMARY KEY,
	answer INTEGER NOT NULL
);

-- The clock's anchors (see Clock): blocks with their timestamps (Unix seconds), from the logs and
-- headers of the ingested block ranges.
CREATE TABLE IF NOT EXISTS anchors (
	block INTEGER PRIMARY KEY,
	time INTEGER NOT NULL
);

-- Auctions that ended in a settlement, and every solution submitted to them, in the API's order.
-- scored is 1 once the solutions carry their scores (0 for auctions stored before the schema
-- held them, until they are fetched again).
CREATE TABLE IF NOT EXISTS auctions (
	id INTEGER PRIMARY KEY,
	start_block INTEGER NOT NULL,
	scored INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS auctions_by_start ON auctions (start_block);

-- tx: the settlement of a winning solution; null for the others and for winners that never settled.
-- score and reference_score (see Solution) are decimal wei; filtered_out is 1 when CIP-67's
-- filter removed the solution. All three are null until the auction is scored.
CREATE TABLE IF NOT EXISTS solutions (
	auction_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	solver INTEGER NOT NULL,
	ranking INTEGER NOT NULL,
	winner INTEGER NOT NULL,
	tx BLOB,
	score TEXT,
	reference_score TEXT,
	filtered_out INTEGER,
	PRIMARY KEY (auction_id, position)
) WITHOUT ROWID;

-- The native prices an auction gave the tokens its settlements traded (not its whole price list).
CREATE TABLE IF NOT EXISTS auction_prices (
	auction_id INTEGER NOT NULL,
	token INTEGER NOT NULL,
	price TEXT NOT NULL,
	PRIMARY KEY (auction_id, token)
) WITHOUT ROWID;

-- The competition of each settlement transaction (see CompetitionLink).
CREATE TABLE IF NOT EXISTS auction_txs (
	tx BLOB PRIMARY KEY,
	auction_id INTEGER,
	priced INTEGER NOT NULL,
	checked_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS auction_txs_by_auction ON auction_txs (auction_id);

-- The orders traded in the detail range as CoW's order book holds them (see OrderDetail). found
-- is 0 for an order the book lacks, such as a solver's just-in-time order, and then the other
-- columns are null. block is the block of its latest trade, for pruning. partner_fees holds the
-- policies of its app data's partner fees, comma-separated; null for none.
CREATE TABLE IF NOT EXISTS orders (
	uid BLOB PRIMARY KEY,
	block INTEGER NOT NULL,
	found INTEGER NOT NULL,
	kind TEXT,
	app_class TEXT,
	partner_fees TEXT,
	quote_solver INTEGER,
	quote_verified INTEGER,
	quote_sell_amount TEXT,
	quote_buy_amount TEXT,
	quote_fee_amount TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS orders_by_block ON orders (block);

-- The protocol fees CoW charged on each trade, one row per fee policy in the order CoW applied
-- them (see ExecutedFee). partner is 1 for a partner fee from the order's app data, 0 for CoW's
-- own fee, and null when the policies do not line up with the app data.
CREATE TABLE IF NOT EXISTS trade_fees (
	block INTEGER NOT NULL,
	log_index INTEGER NOT NULL,
	position INTEGER NOT NULL,
	policy TEXT NOT NULL,
	factor REAL NOT NULL,
	max_volume_factor REAL,
	partner INTEGER,
	amount TEXT NOT NULL,
	token INTEGER NOT NULL,
	PRIMARY KEY (block, log_index, position)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tokens (
	address INTEGER PRIMARY KEY,
	symbol TEXT NOT NULL
);

-- CoW's CMS solver registry for this network, as last fetched (the overrides live in code).
CREATE TABLE IF NOT EXISTS cms_solvers (
	address TEXT NOT NULL,
	env TEXT NOT NULL,
	active INTEGER NOT NULL,
	solver_id TEXT NOT NULL,
	name TEXT NOT NULL
);
`;

/**
 * Turns a version 2 database into version 3 in place: the new columns start empty and are filled
 * in by the sync (order uids from the chain, scores, orders and fees from CoW's API). SCHEMA then
 * adds the new tables and indexes.
 */
const UPGRADE_FROM_2 = `
ALTER TABLE trades ADD COLUMN order_uid BLOB;
ALTER TABLE trades ADD COLUMN fees_checked INTEGER;
ALTER TABLE auctions ADD COLUMN scored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE solutions ADD COLUMN score TEXT;
ALTER TABLE solutions ADD COLUMN reference_score TEXT;
ALTER TABLE solutions ADD COLUMN filtered_out INTEGER;
`;

/**
 * Turns a version 3 database, which every earlier indexer wrote for Base, into version 4: the
 * native token's USD prices get a network-neutral name. SCHEMA then adds the anchors table, and
 * the constructor anchors the chain range.
 */
const UPGRADE_FROM_3 = `
ALTER TABLE eth_usd RENAME TO native_usd;
`;

/** Binds a `0x`-prefixed hex hash to a column that stores its bytes. */
const HASH = "unhex(substr(?, 3))";

/** A hash column read back as `0x`-prefixed lowercase hex. */
function hexOf(column: string): string {
	return `'0x' || lower(hex(${column}))`;
}

/** The ids of the relays in `addresses`; bind RELAYS to it, in order. */
const RELAY_IDS = `SELECT id FROM addresses WHERE address IN (${RELAYS.map(() => "?").join(", ")})`;

/** The indexer's SQLite database: raw chain and auction facts plus sync progress. */
export class Store {
	readonly db: DatabaseSync;
	readonly #statements = new Map<string, StatementSync>();

	constructor(path: string) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path, { timeout: 10_000 });
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
		const version = this.#get<{ user_version: number }>("PRAGMA user_version")!.user_version;
		if (version > SCHEMA_VERSION) {
			throw new Error(
				`${path} has schema version ${version}; this indexer reads version ${SCHEMA_VERSION}`
			);
		}
		const written =
			this.#get("SELECT 1 FROM sqlite_schema WHERE name = 'settlements'") !== undefined;
		if (written && version < 2) {
			throw new Error(
				`${path} was written by an older indexer (schema version ${version}): delete it to ` +
					"index from scratch, or seed a current copy"
			);
		}
		if (written) {
			// From version 4 a database records its network's chain id; every earlier one is Base's.
			const chainId = version < 4 ? BASE.chainId : Number(this.#meta("chain_id"));
			if (chainId !== NETWORK.chainId) {
				const holds =
					Object.values(NETWORKS).find((network) => network.chainId === chainId)?.name ??
					`chain ${chainId}`;
				throw new Error(
					`${path} is a ${holds} database; this indexer covers ${NETWORK.name} ` +
						`(NETWORK=${NETWORK.id}): give each network its own database`
				);
			}
		}
		const upgrade = written && version < SCHEMA_VERSION;
		this.#transaction(() => {
			if (written && version === 2) this.db.exec(UPGRADE_FROM_2);
			if (upgrade) this.db.exec(UPGRADE_FROM_3);
			this.db.exec(SCHEMA);
			const chain = this.chainRange();
			if (upgrade && chain !== null) {
				for (const block of new Set([chain.from, chain.to])) {
					this.#run(
						"INSERT OR REPLACE INTO anchors (block, time) VALUES (?, ?)",
						block,
						BASE_GENESIS + 2 * block
					);
				}
			}
			this.#setMeta("chain_id", String(NETWORK.chainId));
			this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		});
		if (upgrade) log(`${path}: schema version ${version} upgraded to ${SCHEMA_VERSION}`);
	}

	close(): void {
		this.db.close();
	}

	/** Folds the write-ahead log into the database file, so its size on disk is accurate. */
	checkpoint(): void {
		this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	}

	// Progress

	chainRange(): BlockRange | null {
		return this.#range("chain");
	}

	auctionRange(): BlockRange | null {
		return this.#range("auction");
	}

	setAuctionRange(range: BlockRange): void {
		this.#transaction(() => this.#setRange("auction", range));
	}

	/**
	 * The blocks whose auctions carry their scores and whose trades carry their orders' quotes and
	 * their protocol fees, as far as CoW's API has them. It lies within the auction range.
	 */
	detailRange(): BlockRange | null {
		return this.#range("detail");
	}

	setDetailRange(range: BlockRange): void {
		this.#transaction(() => this.#setRange("detail", range));
	}

	lastRunAt(): number | null {
		const value = this.#meta("last_run_at");
		return value === null ? null : Number(value);
	}

	setLastRunAt(ms: number): void {
		this.#setMeta("last_run_at", String(ms));
	}

	// Chain data

	/**
	 * Replaces everything in the chunk's block range and records the new chain range. A chunk
	 * carries the order terms of every trade its calldata reproduces.
	 */
	commitChunk(chunk: ChainChunk, chainRange: BlockRange): void {
		const { from, to } = chunk.range;
		const receipts = new Map(chunk.txs.map((tx) => [tx.tx, tx]));
		const batches = new Map<string, number>();
		for (const s of chunk.settlements) {
			if (s.trades > 0) batches.set(s.tx, (batches.get(s.tx) ?? 0) + 1);
		}
		this.#transaction(() => {
			for (const table of ["settlements", "trades", "trade_fees", "native_usd", "anchors"]) {
				this.#run(`DELETE FROM ${table} WHERE block BETWEEN ? AND ?`, from, to);
			}
			for (const s of chunk.settlements) {
				const tx = s.trades > 0 ? receipts.get(s.tx) : undefined;
				if (s.trades > 0 && tx === undefined)
					throw new Error(`no receipt for batch ${s.tx}`);
				this.#run(
					`INSERT INTO settlements (block, log_index, tx, solver, trades, swaps, sender,
						recipient, gas_used, fee, tx_batches) VALUES (?, ?, ${HASH}, ?, ?, ?, ?, ?, ?, ?, ?)`,
					s.block,
					s.logIndex,
					s.tx,
					this.#addressId(s.solver),
					s.trades,
					s.swaps,
					tx === undefined ? null : this.#addressId(tx.sender),
					tx === undefined || tx.recipient === null
						? null
						: this.#addressId(tx.recipient),
					tx?.gasUsed ?? null,
					tx === undefined ? null : BigInt(tx.fee),
					tx === undefined ? null : batches.get(s.tx)!
				);
			}
			for (const t of chunk.trades) {
				this.#run(
					`INSERT INTO trades (block, log_index, settlement_log_index, sell_token, buy_token,
						sell_amount, buy_amount, limit_sell_amount, limit_buy_amount, fee_amount, order_uid)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${HASH})`,
					t.block,
					t.logIndex,
					t.settlementLogIndex,
					this.#addressId(t.sellToken),
					this.#addressId(t.buyToken),
					t.sellAmount,
					t.buyAmount,
					t.terms?.limitSellAmount ?? null,
					t.terms?.limitBuyAmount ?? null,
					t.terms?.feeAmount ?? null,
					t.orderUid
				);
			}
			for (const p of chunk.prices) {
				this.#run(
					"INSERT OR REPLACE INTO native_usd (block, answer) VALUES (?, ?)",
					p.block,
					p.answer
				);
			}
			for (const a of chunk.anchors) {
				this.#run(
					"INSERT OR REPLACE INTO anchors (block, time) VALUES (?, ?)",
					a.block,
					a.time
				);
			}
			this.#setRange("chain", chainRange);
		});
	}

	/**
	 * Deletes the chain data below `chainFrom`, and the competition links of the settlements below
	 * `auctionFrom` (null: none) with the orders and fees of their trades, and moves the chain,
	 * auction and detail ranges up to them. A relay settlement keeps its link while it is in the
	 * chain data, since its attribution may need its auction's winner. An auction goes with its
	 * last link, so one that started below `auctionFrom` stays while a later settlement needs its
	 * prices. The native token's USD price keeps the answer in force at `chainFrom`, and the clock
	 * the last anchor before it, so every block from there up keeps its time.
	 */
	prune(chainFrom: number, auctionFrom: number | null): void {
		const chain = this.chainRange();
		const auctions = this.auctionRange();
		// The block ranges [from, to) whose data goes; each run only crosses the latest blocks.
		const chainGone =
			chain !== null && chain.from < chainFrom && chainFrom <= chain.to
				? { from: chain.from, to: chainFrom }
				: null;
		const linksGone =
			auctionFrom !== null &&
			auctions !== null &&
			auctions.from < auctionFrom &&
			auctionFrom <= auctions.to
				? { from: auctions.from, to: auctionFrom }
				: null;
		if (chainGone === null && linksGone === null) return;
		const unlinked = `SELECT tx FROM settlements
				WHERE block >= ? AND block < ? AND solver NOT IN (${RELAY_IDS})
			UNION ALL SELECT tx FROM settlements WHERE block >= ? AND block < ?`;
		const params = [
			linksGone?.from ?? 0,
			linksGone?.to ?? 0,
			...RELAYS,
			chainGone?.from ?? 0,
			chainGone?.to ?? 0,
		];
		this.#transaction(() => {
			const affected = this.#all<{ id: number }>(
				`SELECT DISTINCT auction_id AS id FROM auction_txs
					WHERE auction_id IS NOT NULL AND tx IN (${unlinked})`,
				...params
			);
			this.#run(`DELETE FROM auction_txs WHERE tx IN (${unlinked})`, ...params);
			for (const { id } of affected) {
				if (this.#get("SELECT 1 FROM auction_txs WHERE auction_id = ? LIMIT 1", id))
					continue;
				this.#run("DELETE FROM solutions WHERE auction_id = ?", id);
				this.#run("DELETE FROM auction_prices WHERE auction_id = ?", id);
				this.#run("DELETE FROM auctions WHERE id = ?", id);
			}
			if (linksGone !== null) {
				// An order goes when its latest trade is below the auction range; a trade there
				// loses its fees, and is looked up again if the auction range ever reaches it.
				this.#run("DELETE FROM trade_fees WHERE block < ?", linksGone.to);
				this.#run("DELETE FROM orders WHERE block < ?", linksGone.to);
				this.#run(
					`UPDATE trades SET fees_checked = NULL
						WHERE block >= ? AND block < ? AND fees_checked IS NOT NULL`,
					linksGone.from,
					linksGone.to
				);
				const details = this.detailRange();
				if (details !== null && details.from < linksGone.to) {
					if (details.to < linksGone.to) this.#deleteRange("detail");
					else this.#setRange("detail", { from: linksGone.to, to: details.to });
				}
				this.#setRange("auction", { from: linksGone.to, to: auctions!.to });
			}
			if (chainGone !== null) {
				this.#run("DELETE FROM settlements WHERE block < ?", chainFrom);
				this.#run("DELETE FROM trades WHERE block < ?", chainFrom);
				this.#run(
					"DELETE FROM native_usd WHERE block < (SELECT MAX(block) FROM native_usd WHERE block <= ?)",
					chainFrom
				);
				this.#run(
					"DELETE FROM anchors WHERE block < (SELECT MAX(block) FROM anchors WHERE block < ?)",
					chainFrom
				);
				this.#setRange("chain", { from: chainFrom, to: chain!.to });
			}
		});
	}

	/** The AllowList verdict on an address, or null when it was never checked. */
	allowListVerdict(address: string): boolean | null {
		const row = this.#get<{ isSolver: number }>(
			`SELECT l.is_solver AS isSolver FROM allow_list l JOIN addresses a ON a.id = l.address
				WHERE a.address = ?`,
			address
		);
		return row ? row.isSolver === 1 : null;
	}

	saveAllowListVerdict(address: string, isSolver: boolean): void {
		this.#run(
			"INSERT OR REPLACE INTO allow_list (address, is_solver) VALUES (?, ?)",
			this.#addressId(address),
			Number(isSolver)
		);
	}

	/** Every price point of the native token in USD, sorted by block. */
	nativeUsdPoints(): PricePoint[] {
		return this.#all<PricePoint>("SELECT block, answer FROM native_usd ORDER BY block");
	}

	/** The block of the earliest price point of the native token, or null when there is none. */
	firstNativeUsdBlock(): number | null {
		return this.#get<{ block: number | null }>("SELECT MIN(block) AS block FROM native_usd")!
			.block;
	}

	saveNativeUsdPoint(point: PricePoint): void {
		this.#run(
			"INSERT OR REPLACE INTO native_usd (block, answer) VALUES (?, ?)",
			point.block,
			point.answer
		);
	}

	/** The clock of every anchor, read at once: for the many blocks of a snapshot or of a sync. */
	clock(): Clock {
		return new Clock(
			this.#iterate<Anchor>("SELECT block, time FROM anchors ORDER BY block"),
			NETWORK.blockTime
		);
	}

	/** Unix seconds of one block, from the anchors on either side of it (see Clock). */
	timeOf(block: number): number {
		const around = this.#all<Anchor>(
			`SELECT * FROM (SELECT block, time FROM anchors WHERE block <= ? ORDER BY block DESC LIMIT 1)
			UNION ALL SELECT * FROM (SELECT block, time FROM anchors WHERE block > ? ORDER BY block LIMIT 1)
			ORDER BY block`,
			block,
			block
		);
		return new Clock(around, NETWORK.blockTime).time(block);
	}

	/** Batch transactions in a block range, in block order. */
	batchTxs(range: BlockRange): { tx: string; block: number }[] {
		return this.#all(
			`SELECT ${hexOf("s.tx")} AS tx, MIN(s.block) AS block FROM settlements s
				WHERE s.trades > 0 AND s.block BETWEEN ? AND ? GROUP BY s.tx ORDER BY block, s.tx`,
			range.from,
			range.to
		);
	}

	/** The batches of a block range in block order, read one at a time. */
	batchRows(range: BlockRange): IterableIterator<BatchRow> {
		return this.#iterate(
			`SELECT ${hexOf("s.tx")} AS tx, s.log_index AS logIndex, s.block, so.address AS solver,
				s.trades, s.swaps, se.address AS sender, re.address AS recipient,
				s.gas_used AS gasUsed, CAST(s.fee AS TEXT) AS fee, l.is_solver AS senderIsSolver,
				r.is_solver AS recipientIsSolver, s.tx_batches AS txBatches
			FROM settlements s
				JOIN addresses so ON so.id = s.solver
				JOIN addresses se ON se.id = s.sender
				LEFT JOIN addresses re ON re.id = s.recipient
				LEFT JOIN allow_list l ON l.address = s.sender
				LEFT JOIN allow_list r ON r.address = s.recipient
			WHERE s.trades > 0 AND s.block BETWEEN ? AND ?
			ORDER BY s.block, s.log_index`,
			range.from,
			range.to
		);
	}

	/** Settlements without trades (buffer and withdrawal settlements) in a block range. */
	zeroTradeSettlements(range: BlockRange): number {
		return this.#get<{ n: number }>(
			"SELECT COUNT(*) AS n FROM settlements WHERE trades = 0 AND block BETWEEN ? AND ?",
			range.from,
			range.to
		)!.n;
	}

	/** Trades in a block range with the competition their transaction belongs to. */
	tradeRows(range: BlockRange): IterableIterator<TradeValueRow> {
		return this.#iterate(
			`${TRADE_ROWS} WHERE tr.block BETWEEN ? AND ? ORDER BY tr.block, tr.log_index`,
			range.from,
			range.to
		);
	}

	/** The trades of the settlement at `logIndex` in `block`, in log order. */
	settlementTrades(block: number, logIndex: number): TradeValueRow[] {
		return this.#all(
			`${TRADE_ROWS} WHERE tr.block = ? AND tr.settlement_log_index = ? ORDER BY tr.log_index`,
			block,
			logIndex
		);
	}

	/** Trades in a block range with their order terms and their transaction's recipient. */
	termRows(range: BlockRange): IterableIterator<TermRow> {
		return this.#iterate(
			`SELECT ${hexOf("s.tx")} AS tx, tr.block, tr.log_index AS logIndex,
				re.address AS recipient, st.address AS sellToken, bt.address AS buyToken,
				tr.limit_sell_amount AS limitSellAmount, tr.limit_buy_amount AS limitBuyAmount,
				tr.fee_amount AS feeAmount
			FROM trades tr
				JOIN settlements s ON s.block = tr.block AND s.log_index = tr.settlement_log_index
				LEFT JOIN addresses re ON re.id = s.recipient
				JOIN addresses st ON st.id = tr.sell_token
				JOIN addresses bt ON bt.id = tr.buy_token
			WHERE tr.block BETWEEN ? AND ?
			ORDER BY tr.block, tr.log_index`,
			range.from,
			range.to
		);
	}

	/**
	 * Relay batch transactions never looked up in the API whose sender is not allow-listed and
	 * whose recipient is a relay or not allow-listed.
	 */
	unresolvedRelayTxs(): { tx: string; sender: string; recipient: string | null }[] {
		return this.#all(
			`SELECT DISTINCT ${hexOf("s.tx")} AS tx, se.address AS sender, re.address AS recipient
				FROM settlements s
				JOIN addresses se ON se.id = s.sender
				LEFT JOIN addresses re ON re.id = s.recipient
				LEFT JOIN allow_list l ON l.address = s.sender
				LEFT JOIN allow_list r ON r.address = s.recipient
				LEFT JOIN auction_txs a ON a.tx = s.tx
				WHERE s.solver IN (${RELAY_IDS}) AND s.trades > 0
					AND COALESCE(l.is_solver, 0) = 0
					AND (s.recipient IN (${RELAY_IDS}) OR COALESCE(r.is_solver, 0) = 0)
					AND a.tx IS NULL`,
			...RELAYS,
			...RELAYS
		);
	}

	/**
	 * The senders and recipients of relay batches that have no AllowList verdict, other than the
	 * relays themselves, each with the block of its first relay batch.
	 */
	uncheckedRelayParties(): { address: string; block: number }[] {
		return this.#all(
			`SELECT a.address, MIN(p.block) AS block FROM (
					SELECT sender AS party, block FROM settlements
						WHERE solver IN (${RELAY_IDS}) AND trades > 0
					UNION ALL SELECT recipient, block FROM settlements
						WHERE solver IN (${RELAY_IDS}) AND trades > 0
							AND recipient NOT IN (${RELAY_IDS})
				) p
				JOIN addresses a ON a.id = p.party
				LEFT JOIN allow_list l ON l.address = p.party
				WHERE l.address IS NULL
				GROUP BY p.party ORDER BY block, a.address`,
			...RELAYS,
			...RELAYS,
			...RELAYS
		);
	}

	// Auction data

	competitionLink(tx: string): CompetitionLink | null {
		const row = this.#get<{ auctionId: number | null; priced: number; checkedAt: number }>(
			`SELECT auction_id AS auctionId, priced, checked_at AS checkedAt FROM auction_txs
				WHERE tx = ${HASH}`,
			tx
		);
		return row
			? { auctionId: row.auctionId, priced: row.priced === 1, checkedAt: row.checkedAt }
			: null;
	}

	/** The tokens a transaction traded, or null when its block range is not ingested. */
	tradedTokens(tx: string): string[] | null {
		const rows = this.#all<{ sellToken: string | null; buyToken: string | null }>(
			`SELECT st.address AS sellToken, bt.address AS buyToken FROM settlements s
				LEFT JOIN trades tr ON tr.block = s.block AND tr.settlement_log_index = s.log_index
				LEFT JOIN addresses st ON st.id = tr.sell_token
				LEFT JOIN addresses bt ON bt.id = tr.buy_token
				WHERE s.tx = ${HASH}`,
			tx
		);
		if (rows.length === 0) return null;
		return rows.flatMap(({ sellToken, buyToken }) =>
			sellToken === null || buyToken === null ? [] : [sellToken, buyToken]
		);
	}

	/**
	 * Stores a competition: its auction, all its solutions, the given subset of its prices and
	 * the links of its transactions. A link never loses `priced` for the same auction.
	 */
	saveCompetition(
		competition: Competition,
		prices: [token: string, price: string][],
		links: { tx: string; priced: boolean }[],
		checkedAt: number
	): void {
		const id = competition.auctionId;
		this.#transaction(() => {
			this.#run(
				"INSERT OR REPLACE INTO auctions (id, start_block, scored) VALUES (?, ?, 1)",
				id,
				competition.startBlock
			);
			this.#replaceSolutions(id, competition.solutions);
			for (const [token, price] of prices) {
				this.#run(
					"INSERT OR REPLACE INTO auction_prices (auction_id, token, price) VALUES (?, ?, ?)",
					id,
					this.#addressId(token),
					price
				);
			}
			for (const link of links) {
				this.#run(
					`INSERT INTO auction_txs (tx, auction_id, priced, checked_at) VALUES (${HASH}, ?, ?, ?)
						ON CONFLICT (tx) DO UPDATE SET
							priced = CASE WHEN auction_id = excluded.auction_id
								THEN MAX(priced, excluded.priced) ELSE excluded.priced END,
							auction_id = excluded.auction_id,
							checked_at = excluded.checked_at`,
					link.tx,
					id,
					Number(link.priced),
					checkedAt
				);
			}
		});
	}

	/** Records that the API had no competition for a transaction. */
	saveMissingCompetition(tx: string, checkedAt: number): void {
		this.#run(
			`INSERT OR REPLACE INTO auction_txs (tx, auction_id, priced, checked_at)
				VALUES (${HASH}, NULL, 0, ?)`,
			tx,
			checkedAt
		);
	}

	/** The solver of the winning solution that settled `tx`, from the tx's competition. */
	apiWinner(tx: string): string | null {
		const row = this.#get<{ solver: string }>(
			`SELECT a.address AS solver FROM auction_txs l
				JOIN solutions s ON s.auction_id = l.auction_id
				JOIN addresses a ON a.id = s.solver
				WHERE l.tx = ${HASH} AND s.winner = 1 AND s.tx = l.tx LIMIT 1`,
			tx
		);
		return row?.solver ?? null;
	}

	/**
	 * Solutions of the auctions that started in a block range, read one at a time: by auction, in
	 * the order of their start, then in the API's order, not by ranking. That is the order of the
	 * indexes, so a window's millions of solutions are never sorted.
	 */
	solutionsByStart(range: BlockRange): IterableIterator<SolutionRow> {
		return this.#iterate(
			`${SOLUTION_ROWS} WHERE a.start_block BETWEEN ? AND ?
				ORDER BY a.start_block, a.id, s.position`,
			range.from,
			range.to
		);
	}

	/** Solutions of the latest `limit` auctions that started in a block range, by auction then ranking. */
	latestSolutions(range: BlockRange, limit: number): SolutionRow[] {
		return this.#all(
			`${SOLUTION_ROWS} WHERE a.id IN (SELECT id FROM auctions WHERE start_block BETWEEN ? AND ?
				ORDER BY id DESC LIMIT ?)
				ORDER BY a.id, s.ranking`,
			range.from,
			range.to,
			limit
		);
	}

	// Scores

	/** Auctions that started in a block range whose solutions lack their scores, newest first. */
	unscoredAuctions(range: BlockRange): number[] {
		return this.#all<{ id: number }>(
			`SELECT id FROM auctions WHERE start_block BETWEEN ? AND ? AND scored = 0
				ORDER BY id DESC`,
			range.from,
			range.to
		).map((row) => row.id);
	}

	/**
	 * Gives an auction's solutions their scores from a fresh copy of its competition, or records
	 * that the API no longer has it (null), which leaves them unscored for good. When the copy
	 * lists other solutions than the stored ones, it replaces them; returns whether it did.
	 */
	saveScores(auctionId: number, solutions: Solution[] | null): boolean {
		let replaced = false;
		this.#transaction(() => {
			if (solutions !== null) {
				const stored = this.#all<{
					solver: string;
					ranking: number;
					winner: number;
					tx: string | null;
				}>(
					`SELECT a.address AS solver, s.ranking, s.winner,
						CASE WHEN s.tx IS NULL THEN NULL ELSE ${hexOf("s.tx")} END AS tx
					FROM solutions s JOIN addresses a ON a.id = s.solver
					WHERE s.auction_id = ? ORDER BY s.position`,
					auctionId
				);
				const same =
					stored.length === solutions.length &&
					stored.every(
						(row, i) =>
							row.solver === solutions[i].solver &&
							row.ranking === solutions[i].ranking &&
							row.winner === Number(solutions[i].winner) &&
							row.tx === solutions[i].tx
					);
				if (same) {
					solutions.forEach((s, position) => {
						this.#run(
							`UPDATE solutions SET score = ?, reference_score = ?, filtered_out = ?
								WHERE auction_id = ? AND position = ?`,
							s.score,
							s.referenceScore,
							Number(s.filteredOut),
							auctionId,
							position
						);
					});
				} else {
					this.#replaceSolutions(auctionId, solutions);
					replaced = true;
				}
			}
			this.#run("UPDATE auctions SET scored = 1 WHERE id = ?", auctionId);
		});
		return replaced;
	}

	// Order uids

	/** The blocks of the trades stored without their order uid; null when there are none. */
	uidGap(): BlockRange | null {
		const row = this.#get<{ low: number | null; high: number | null }>(
			"SELECT MIN(block) AS low, MAX(block) AS high FROM trades WHERE order_uid IS NULL"
		)!;
		return row.low === null || row.high === null ? null : { from: row.low, to: row.high };
	}

	/** Whether a block range holds trades stored without their order uid. */
	tradesWithoutUid(range: BlockRange): boolean {
		const row = this.#get(
			"SELECT 1 FROM trades WHERE order_uid IS NULL AND block BETWEEN ? AND ? LIMIT 1",
			range.from,
			range.to
		);
		return row !== undefined;
	}

	/**
	 * Gives each trade of a block range that lacks its order uid the uid of its Trade event, from
	 * `uids` by `block:logIndex`; every such trade must be there. Returns how many it filled.
	 */
	fillOrderUids(range: BlockRange, uids: Map<string, string>): number {
		let filled = 0;
		this.#transaction(() => {
			const rows = this.#all<{ block: number; logIndex: number }>(
				`SELECT block, log_index AS logIndex FROM trades
					WHERE order_uid IS NULL AND block BETWEEN ? AND ?`,
				range.from,
				range.to
			);
			for (const { block, logIndex } of rows) {
				const uid = uids.get(`${block}:${logIndex}`);
				if (uid === undefined)
					throw new Error(`no Trade event at block ${block}, log ${logIndex}`);
				this.#run(
					`UPDATE trades SET order_uid = ${HASH} WHERE block = ? AND log_index = ?`,
					uid,
					block,
					logIndex
				);
				filled++;
			}
		});
		return filled;
	}

	// Orders and fees

	/**
	 * The orders traded in a block range that were never looked up, with the block of their latest
	 * trade in it.
	 */
	unknownOrders(range: BlockRange): { uid: string; block: number }[] {
		return this.#all(
			`SELECT ${hexOf("t.order_uid")} AS uid, MAX(t.block) AS block FROM trades t
				LEFT JOIN orders o ON o.uid = t.order_uid
				WHERE t.block BETWEEN ? AND ? AND t.order_uid IS NOT NULL AND o.uid IS NULL
				GROUP BY t.order_uid`,
			range.from,
			range.to
		);
	}

	/** Stores looked-up orders; a null detail records an order CoW's order book lacks. */
	saveOrders(orders: { uid: string; block: number; detail: OrderDetail | null }[]): void {
		this.#transaction(() => {
			for (const { uid, block, detail } of orders) {
				const quote = detail?.quote ?? null;
				this.#run(
					`INSERT OR REPLACE INTO orders (uid, block, found, kind, app_class, partner_fees,
						quote_solver, quote_verified, quote_sell_amount, quote_buy_amount, quote_fee_amount)
						VALUES (${HASH}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					uid,
					block,
					Number(detail !== null),
					detail?.kind ?? null,
					detail?.appClass ?? null,
					detail && detail.partnerFees.length > 0 ? detail.partnerFees.join(",") : null,
					quote === null ? null : this.#addressId(quote.solver),
					quote === null ? null : Number(quote.verified),
					quote?.sellAmount ?? null,
					quote?.buyAmount ?? null,
					quote?.feeAmount ?? null
				);
			}
		});
	}

	/** The trades of a block range whose fees were never looked up and whose order was, newest first. */
	pendingFeeTrades(range: BlockRange): PendingFeeTrade[] {
		return this.#all<{
			uid: string;
			block: number;
			logIndex: number;
			found: number;
			partnerFees: string | null;
		}>(
			`SELECT ${hexOf("t.order_uid")} AS uid, t.block, t.log_index AS logIndex, o.found,
				o.partner_fees AS partnerFees
			FROM trades t JOIN orders o ON o.uid = t.order_uid
			WHERE t.block BETWEEN ? AND ? AND t.fees_checked IS NULL
			ORDER BY t.block DESC, t.log_index`,
			range.from,
			range.to
		).map((row) => ({
			uid: row.uid,
			block: row.block,
			logIndex: row.logIndex,
			found: row.found === 1,
			partnerFees:
				row.partnerFees === null ? [] : (row.partnerFees.split(",") as FeePolicy[]),
		}));
	}

	/**
	 * Stores the protocol fees of trades of one order: each trade's fees (an empty list for none),
	 * or null when they are unknown. The order's block moves up to its latest trade.
	 */
	saveTradeFees(
		uid: string,
		trades: { block: number; logIndex: number; fees: StoredFee[] | null }[]
	): void {
		this.#transaction(() => {
			for (const { block, logIndex, fees } of trades) {
				this.#run(
					"DELETE FROM trade_fees WHERE block = ? AND log_index = ?",
					block,
					logIndex
				);
				(fees ?? []).forEach((fee, position) => {
					this.#run(
						`INSERT INTO trade_fees (block, log_index, position, policy, factor,
							max_volume_factor, partner, amount, token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						block,
						logIndex,
						position,
						fee.policy,
						fee.factor,
						fee.maxVolumeFactor,
						fee.partner === null ? null : Number(fee.partner),
						fee.amount,
						this.#addressId(fee.token)
					);
				});
				this.#run(
					"UPDATE trades SET fees_checked = ? WHERE block = ? AND log_index = ?",
					fees === null ? 0 : 1,
					block,
					logIndex
				);
				this.#run(
					`UPDATE orders SET block = MAX(block, ?) WHERE uid = ${HASH}`,
					block,
					uid
				);
			}
		});
	}

	/** Trades in a block range with their order's quote and their protocol fees, read one at a time. */
	tradeDetails(range: BlockRange): IterableIterator<TradeDetailRow> {
		return this.#iterate(
			`${TRADE_DETAIL_ROWS} WHERE tr.block BETWEEN ? AND ? ORDER BY tr.block, tr.log_index`,
			range.from,
			range.to
		);
	}

	/** The trades of the settlement at `logIndex` in `block`, as tradeDetails reads them, in log order. */
	settlementDetails(block: number, logIndex: number): TradeDetailRow[] {
		return this.#all(
			`${TRADE_DETAIL_ROWS} WHERE tr.block = ? AND tr.settlement_log_index = ? ORDER BY tr.log_index`,
			block,
			logIndex
		);
	}

	// Tokens and registry

	symbols(): Map<string, string> {
		const rows = this.#all<{ address: string; symbol: string }>(
			"SELECT a.address, t.symbol FROM tokens t JOIN addresses a ON a.id = t.address"
		);
		return new Map(rows.map((row) => [row.address, row.symbol]));
	}

	saveSymbols(symbols: Map<string, string>): void {
		this.#transaction(() => {
			for (const [address, symbol] of symbols) {
				this.#run(
					"INSERT OR REPLACE INTO tokens (address, symbol) VALUES (?, ?)",
					this.#addressId(address),
					symbol
				);
			}
		});
	}

	cmsEntries(): RegistryEntry[] {
		return this.#all<{
			address: string;
			env: "prod" | "barn";
			active: number;
			solverId: string;
			name: string;
		}>("SELECT address, env, active, solver_id AS solverId, name FROM cms_solvers").map(
			(row) => ({ ...row, active: row.active === 1 })
		);
	}

	replaceCmsEntries(entries: RegistryEntry[]): void {
		this.#transaction(() => {
			this.#run("DELETE FROM cms_solvers");
			for (const e of entries) {
				this.#run(
					"INSERT INTO cms_solvers (address, env, active, solver_id, name) VALUES (?, ?, ?, ?, ?)",
					e.address,
					e.env,
					Number(e.active),
					e.solverId,
					e.name
				);
			}
		});
	}

	// Internals

	/** The id of an address in `addresses`, which gains it if it is new. */
	#addressId(address: string): number {
		const row =
			this.#get<{ id: number }>("SELECT id FROM addresses WHERE address = ?", address) ??
			this.#get<{ id: number }>(
				"INSERT INTO addresses (address) VALUES (?) RETURNING id",
				address
			);
		return row!.id;
	}

	/** Replaces an auction's solutions, scores included, in the API's order. */
	#replaceSolutions(auctionId: number, solutions: Solution[]): void {
		this.#run("DELETE FROM solutions WHERE auction_id = ?", auctionId);
		solutions.forEach((s, position) => {
			this.#run(
				`INSERT INTO solutions (auction_id, position, solver, ranking, winner, tx, score,
					reference_score, filtered_out) VALUES (?, ?, ?, ?, ?, ${HASH}, ?, ?, ?)`,
				auctionId,
				position,
				this.#addressId(s.solver),
				s.ranking,
				Number(s.winner),
				s.tx,
				s.score,
				s.referenceScore,
				Number(s.filteredOut)
			);
		});
	}

	#statement(sql: string): StatementSync {
		let statement = this.#statements.get(sql);
		if (!statement) {
			statement = this.db.prepare(sql);
			this.#statements.set(sql, statement);
		}
		return statement;
	}

	#run(sql: string, ...params: SQLInputValue[]): void {
		this.#statement(sql).run(...params);
	}

	#all<T>(sql: string, ...params: SQLInputValue[]): T[] {
		return this.#statement(sql).all(...params) as T[];
	}

	/** Rows read one at a time; the loop over them must not run the same statement again. */
	#iterate<T>(sql: string, ...params: SQLInputValue[]): IterableIterator<T> {
		return this.#statement(sql).iterate(...params) as unknown as IterableIterator<T>;
	}

	#get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
		return this.#statement(sql).get(...params) as T | undefined;
	}

	#transaction(work: () => void): void {
		this.db.exec("BEGIN");
		try {
			work();
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	#meta(key: string): string | null {
		return (
			this.#get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? null
		);
	}

	#setMeta(key: string, value: string): void {
		this.#run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
	}

	#range(name: string): BlockRange | null {
		const from = this.#meta(`${name}_from`);
		const to = this.#meta(`${name}_to`);
		return from === null || to === null ? null : { from: Number(from), to: Number(to) };
	}

	#setRange(name: string, range: BlockRange): void {
		this.#setMeta(`${name}_from`, String(range.from));
		this.#setMeta(`${name}_to`, String(range.to));
	}

	#deleteRange(name: string): void {
		this.#run("DELETE FROM meta WHERE key IN (?, ?)", `${name}_from`, `${name}_to`);
	}
}

/**
 * The id of the token whose native price values the token in `column` (see priceToken): the
 * native token's placeholder is priced as the wrapped native token. Both addresses are the
 * code's own constants.
 */
function priceTokenId(column: string): string {
	return `CASE ${column} WHEN (SELECT id FROM addresses WHERE address = '${NATIVE_TOKEN}')
		THEN (SELECT id FROM addresses WHERE address = '${NETWORK.native.wrapped}') ELSE ${column} END`;
}

/** The native prices of a trade's tokens in its auction (auction_txs `a`), as sp and bp. */
const TRADE_PRICES = `LEFT JOIN auction_prices sp
		ON sp.auction_id = a.auction_id AND sp.token = ${priceTokenId("tr.sell_token")}
	LEFT JOIN auction_prices bp
		ON bp.auction_id = a.auction_id AND bp.token = ${priceTokenId("tr.buy_token")}`;

const TRADE_ROWS = `SELECT ${hexOf("s.tx")} AS tx, so.address AS solver,
	tr.settlement_log_index AS settlementLogIndex, tr.block, st.address AS sellToken,
	bt.address AS buyToken, tr.sell_amount AS sellAmount, tr.buy_amount AS buyAmount,
	tr.limit_sell_amount AS limitSellAmount, tr.limit_buy_amount AS limitBuyAmount,
	tr.fee_amount AS feeAmount, sp.price AS sellPrice, bp.price AS buyPrice
	FROM trades tr
	JOIN settlements s ON s.block = tr.block AND s.log_index = tr.settlement_log_index
	JOIN addresses so ON so.id = s.solver
	JOIN addresses st ON st.id = tr.sell_token
	JOIN addresses bt ON bt.id = tr.buy_token
	LEFT JOIN auction_txs a ON a.tx = s.tx
	${TRADE_PRICES}`;

const SOLUTION_ROWS = `SELECT a.id AS auctionId, a.start_block AS startBlock, ad.address AS solver,
	s.winner, CASE WHEN s.tx IS NULL THEN NULL ELSE ${hexOf("s.tx")} END AS tx,
	s.filtered_out AS filteredOut, s.score
	FROM auctions a JOIN solutions s ON s.auction_id = a.id JOIN addresses ad ON ad.id = s.solver`;

const TRADE_DETAIL_ROWS = `SELECT tr.block, tr.log_index AS logIndex,
	tr.settlement_log_index AS settlementLogIndex, so.address AS solver,
	st.address AS sellToken, bt.address AS buyToken, tr.sell_amount AS sellAmount,
	tr.buy_amount AS buyAmount, sp.price AS sellPrice, bp.price AS buyPrice, o.found,
	qs.address AS quoteSolver,
	o.quote_verified AS quoteVerified, tr.fees_checked AS feesChecked,
	(SELECT GROUP_CONCAT(COALESCE(f.partner, '?') || ' ' || f.amount || ' ' || fa.address, ',')
		FROM trade_fees f JOIN addresses fa ON fa.id = f.token
		WHERE f.block = tr.block AND f.log_index = tr.log_index) AS fees
	FROM trades tr
	JOIN settlements s ON s.block = tr.block AND s.log_index = tr.settlement_log_index
	JOIN addresses so ON so.id = s.solver
	JOIN addresses st ON st.id = tr.sell_token
	JOIN addresses bt ON bt.id = tr.buy_token
	LEFT JOIN auction_txs a ON a.tx = s.tx
	LEFT JOIN orders o ON o.uid = tr.order_uid
	LEFT JOIN addresses qs ON qs.id = o.quote_solver
	${TRADE_PRICES}`;
