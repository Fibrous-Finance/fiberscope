import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";

import type { SettlementRow, TradeRow } from "./chain.ts";
import type { Competition } from "./cow.ts";
import type { PricePoint } from "./prices.ts";
import type { RegistryEntry } from "./registry.ts";
import type { BlockRange } from "./rules.ts";

/** Receipt facts of a transaction that holds at least one batch. */
export interface TxRow {
	tx: string;
	block: number;
	sender: string;
	/** The receipt's `to`; null in rows stored before it was kept, until the repair fills it. */
	recipient: string | null;
	gasUsed: number;
	/** `effectiveGasPrice` in wei. */
	gasPrice: string;
	/** OP-stack L1 data fee in wei. */
	l1Fee: string;
}

/** Everything one block range of chain data adds to the database. */
export interface ChainChunk {
	range: BlockRange;
	settlements: SettlementRow[];
	trades: TradeRow[];
	txs: TxRow[];
	prices: PricePoint[];
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
	/** Interaction events other than approvals and WETH unwraps. */
	swaps: number;
	sender: string;
	recipient: string | null;
	gasUsed: number;
	/** The AllowList verdict on the sender, if it was ever checked (flash-loan router senders). */
	senderIsSolver: number | null;
	/** The AllowList verdict on the recipient, if it was ever checked (router recipients). */
	recipientIsSolver: number | null;
	/** Batches in the same transaction; they share its gas. */
	txBatches: number;
}

export interface TradeValueRow {
	tx: string;
	logIndex: number;
	settlementLogIndex: number;
	block: number;
	sellToken: string;
	buyToken: string;
	sellAmount: string;
	buyAmount: string;
	auctionId: number | null;
}

export interface SolutionRow {
	auctionId: number;
	startBlock: number;
	solver: string;
	ranking: number;
	winner: number;
	filteredOut: number;
	tx: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
) WITHOUT ROWID;

-- One row per Settlement event; a batch is a settlement with at least one trade.
CREATE TABLE IF NOT EXISTS settlements (
	tx TEXT NOT NULL,
	log_index INTEGER NOT NULL,
	block INTEGER NOT NULL,
	solver TEXT NOT NULL,
	trades INTEGER NOT NULL,
	swaps INTEGER NOT NULL,
	PRIMARY KEY (tx, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS settlements_block ON settlements (block);

CREATE TABLE IF NOT EXISTS txs (
	tx TEXT PRIMARY KEY,
	block INTEGER NOT NULL,
	sender TEXT NOT NULL,
	to_address TEXT,
	gas_used INTEGER NOT NULL,
	gas_price TEXT NOT NULL,
	l1_fee TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS txs_block ON txs (block);

-- AllowList isSolver verdicts, checked once per address (flash-loan router senders, recipients).
CREATE TABLE IF NOT EXISTS allow_list (
	address TEXT PRIMARY KEY,
	is_solver INTEGER NOT NULL,
	checked_block INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS trades (
	tx TEXT NOT NULL,
	log_index INTEGER NOT NULL,
	block INTEGER NOT NULL,
	settlement_log_index INTEGER NOT NULL,
	sell_token TEXT NOT NULL,
	buy_token TEXT NOT NULL,
	sell_amount TEXT NOT NULL,
	buy_amount TEXT NOT NULL,
	PRIMARY KEY (tx, log_index)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS trades_block ON trades (block);

-- Chainlink ETH/USD answers (8 decimals), each valid from its block until the next row.
CREATE TABLE IF NOT EXISTS eth_usd (
	block INTEGER PRIMARY KEY,
	answer INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auctions (
	id INTEGER PRIMARY KEY,
	start_block INTEGER NOT NULL,
	deadline_block INTEGER NOT NULL,
	fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_start ON auctions (start_block);

CREATE TABLE IF NOT EXISTS solutions (
	auction_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	solver TEXT NOT NULL,
	score TEXT NOT NULL,
	ranking INTEGER NOT NULL,
	winner INTEGER NOT NULL,
	filtered_out INTEGER NOT NULL,
	tx TEXT,
	PRIMARY KEY (auction_id, position)
) WITHOUT ROWID;

-- The native prices an auction gave the tokens its settlements traded (not its whole price list).
CREATE TABLE IF NOT EXISTS auction_prices (
	auction_id INTEGER NOT NULL,
	token TEXT NOT NULL,
	price TEXT NOT NULL,
	PRIMARY KEY (auction_id, token)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS auction_txs (
	tx TEXT PRIMARY KEY,
	auction_id INTEGER,
	priced INTEGER NOT NULL,
	checked_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tokens (
	address TEXT PRIMARY KEY,
	symbol TEXT NOT NULL
) WITHOUT ROWID;

-- CoW's CMS solver registry for this network, as last fetched (the overrides live in code).
CREATE TABLE IF NOT EXISTS cms_solvers (
	address TEXT NOT NULL,
	env TEXT NOT NULL,
	active INTEGER NOT NULL,
	solver_id TEXT NOT NULL,
	name TEXT NOT NULL
);
`;

/** The indexer's SQLite database: raw chain and auction facts plus sync progress. */
export class Store {
	readonly db: DatabaseSync;
	readonly #statements = new Map<string, StatementSync>();

	constructor(path: string) {
		if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
		this.db = new DatabaseSync(path, { timeout: 10_000 });
		this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
		this.db.exec(SCHEMA);
		this.#migrate();
	}

	/** Brings a database created by an older version up to the current schema. */
	#migrate(): void {
		const columns = this.#all<{ name: string }>("SELECT name FROM pragma_table_info('txs')");
		if (!columns.some((column) => column.name === "to_address")) {
			this.db.exec("ALTER TABLE txs ADD COLUMN to_address TEXT");
		}
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

	lastRunAt(): number | null {
		const value = this.#meta("last_run_at");
		return value === null ? null : Number(value);
	}

	setLastRunAt(ms: number): void {
		this.#setMeta("last_run_at", String(ms));
	}

	// Chain data

	/** Replaces everything in the chunk's block range and records the new chain range. */
	commitChunk(chunk: ChainChunk, chainRange: BlockRange): void {
		const { from, to } = chunk.range;
		this.#transaction(() => {
			for (const table of ["settlements", "trades", "txs", "eth_usd"]) {
				this.#run(`DELETE FROM ${table} WHERE block BETWEEN ? AND ?`, from, to);
			}
			for (const s of chunk.settlements) {
				this.#run(
					"INSERT INTO settlements (tx, log_index, block, solver, trades, swaps) VALUES (?, ?, ?, ?, ?, ?)",
					s.tx,
					s.logIndex,
					s.block,
					s.solver,
					s.trades,
					s.swaps
				);
			}
			for (const t of chunk.trades) {
				this.#run(
					`INSERT INTO trades (tx, log_index, block, settlement_log_index, sell_token, buy_token,
						sell_amount, buy_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					t.tx,
					t.logIndex,
					t.block,
					t.settlementLogIndex,
					t.sellToken,
					t.buyToken,
					t.sellAmount,
					t.buyAmount
				);
			}
			for (const t of chunk.txs) {
				this.#run(
					`INSERT INTO txs (tx, block, sender, to_address, gas_used, gas_price, l1_fee)
						VALUES (?, ?, ?, ?, ?, ?, ?)`,
					t.tx,
					t.block,
					t.sender,
					t.recipient,
					t.gasUsed,
					t.gasPrice,
					t.l1Fee
				);
			}
			for (const p of chunk.prices) {
				this.#run(
					"INSERT OR REPLACE INTO eth_usd (block, answer) VALUES (?, ?)",
					p.block,
					p.answer
				);
			}
			this.#setRange("chain", chainRange);
		});
	}

	/** The AllowList verdict on an address, or null when it was never checked. */
	allowListVerdict(address: string): boolean | null {
		const row = this.#get<{ isSolver: number }>(
			"SELECT is_solver AS isSolver FROM allow_list WHERE address = ?",
			address
		);
		return row ? row.isSolver === 1 : null;
	}

	saveAllowListVerdict(address: string, isSolver: boolean, block: number): void {
		this.#run(
			"INSERT OR REPLACE INTO allow_list (address, is_solver, checked_block) VALUES (?, ?, ?)",
			address,
			Number(isSolver),
			block
		);
	}

	/** Flash-loan router batch transactions stored without their recipient, in block order. */
	routerTxsWithoutRecipient(router: string): { tx: string; block: number }[] {
		return this.#all(
			`SELECT t.tx, t.block FROM txs t WHERE t.to_address IS NULL AND EXISTS
				(SELECT 1 FROM settlements s WHERE s.tx = t.tx AND s.solver = ? AND s.trades > 0)
				ORDER BY t.block, t.tx`,
			router
		);
	}

	saveRecipients(rows: { tx: string; recipient: string }[]): void {
		this.#transaction(() => {
			for (const row of rows) {
				this.#run("UPDATE txs SET to_address = ? WHERE tx = ?", row.recipient, row.tx);
			}
		});
	}

	/** Every ETH/USD price point, sorted by block. */
	ethUsdPoints(): PricePoint[] {
		return this.#all<PricePoint>("SELECT block, answer FROM eth_usd ORDER BY block");
	}

	/** Batch transactions in a block range, in block order. */
	batchTxs(range: BlockRange): { tx: string; block: number }[] {
		return this.#all(
			`SELECT tx, MIN(block) AS block FROM settlements WHERE trades > 0 AND block BETWEEN ? AND ?
				GROUP BY tx ORDER BY block, tx`,
			range.from,
			range.to
		);
	}

	batchRows(range: BlockRange): BatchRow[] {
		return this.#all(
			`SELECT s.tx, s.log_index AS logIndex, s.block, s.solver, s.trades, s.swaps, t.sender,
				t.to_address AS recipient, t.gas_used AS gasUsed, l.is_solver AS senderIsSolver,
				r.is_solver AS recipientIsSolver,
				(SELECT COUNT(*) FROM settlements x WHERE x.tx = s.tx AND x.trades > 0) AS txBatches
			FROM settlements s JOIN txs t ON t.tx = s.tx LEFT JOIN allow_list l ON l.address = t.sender
				LEFT JOIN allow_list r ON r.address = t.to_address
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
	tradeRows(range: BlockRange): TradeValueRow[] {
		return this.#all(
			`${TRADE_ROWS} WHERE tr.block BETWEEN ? AND ? ORDER BY tr.block, tr.log_index`,
			range.from,
			range.to
		);
	}

	/** The trades of one settlement, in log order. */
	settlementTrades(tx: string, settlementLogIndex: number): TradeValueRow[] {
		return this.#all(
			`${TRADE_ROWS} WHERE tr.tx = ? AND tr.settlement_log_index = ? ORDER BY tr.log_index`,
			tx,
			settlementLogIndex
		);
	}

	/**
	 * Flash-loan router batch transactions never looked up in the API whose sender is not
	 * allow-listed and whose recipient is the router or not allow-listed.
	 */
	unresolvedRouterTxs(
		router: string
	): { tx: string; sender: string; recipient: string | null }[] {
		return this.#all(
			`SELECT DISTINCT s.tx, t.sender, t.to_address AS recipient
				FROM settlements s JOIN txs t ON t.tx = s.tx
				LEFT JOIN allow_list l ON l.address = t.sender
				LEFT JOIN allow_list r ON r.address = t.to_address
				LEFT JOIN auction_txs a ON a.tx = s.tx
				WHERE s.solver = ? AND s.trades > 0 AND COALESCE(l.is_solver, 0) = 0
					AND (t.to_address = s.solver OR COALESCE(r.is_solver, 0) = 0) AND a.tx IS NULL`,
			router
		);
	}

	// Auction data

	competitionLink(tx: string): CompetitionLink | null {
		const row = this.#get<{ auctionId: number | null; priced: number; checkedAt: number }>(
			"SELECT auction_id AS auctionId, priced, checked_at AS checkedAt FROM auction_txs WHERE tx = ?",
			tx
		);
		return row
			? { auctionId: row.auctionId, priced: row.priced === 1, checkedAt: row.checkedAt }
			: null;
	}

	/** The tokens a transaction traded, or null when its block range is not ingested. */
	tradedTokens(tx: string): string[] | null {
		if (!this.#get("SELECT 1 FROM settlements WHERE tx = ? LIMIT 1", tx)) return null;
		const rows = this.#all<{ sellToken: string; buyToken: string }>(
			"SELECT sell_token AS sellToken, buy_token AS buyToken FROM trades WHERE tx = ?",
			tx
		);
		return rows.flatMap((row) => [row.sellToken, row.buyToken]);
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
				"INSERT OR REPLACE INTO auctions (id, start_block, deadline_block, fetched_at) VALUES (?, ?, ?, ?)",
				id,
				competition.startBlock,
				competition.deadlineBlock,
				checkedAt
			);
			this.#run("DELETE FROM solutions WHERE auction_id = ?", id);
			competition.solutions.forEach((s, position) => {
				this.#run(
					`INSERT INTO solutions (auction_id, position, solver, score, ranking, winner, filtered_out, tx)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					id,
					position,
					s.solver,
					s.score,
					s.ranking,
					Number(s.winner),
					Number(s.filteredOut),
					s.tx
				);
			});
			for (const [token, price] of prices) {
				this.#run(
					"INSERT OR REPLACE INTO auction_prices (auction_id, token, price) VALUES (?, ?, ?)",
					id,
					token,
					price
				);
			}
			for (const link of links) {
				this.#run(
					`INSERT INTO auction_txs (tx, auction_id, priced, checked_at) VALUES (?, ?, ?, ?)
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
			"INSERT OR REPLACE INTO auction_txs (tx, auction_id, priced, checked_at) VALUES (?, NULL, 0, ?)",
			tx,
			checkedAt
		);
	}

	/** The native prices stored for an auction, by token. */
	auctionPrices(auctionId: number): Map<string, string> {
		const rows = this.#all<{ token: string; price: string }>(
			"SELECT token, price FROM auction_prices WHERE auction_id = ?",
			auctionId
		);
		return new Map(rows.map((row) => [row.token, row.price]));
	}

	/** The solver of the winning solution that settled `tx`, from the tx's competition. */
	apiWinner(tx: string): string | null {
		const row = this.#get<{ solver: string }>(
			`SELECT s.solver FROM auction_txs a JOIN solutions s ON s.auction_id = a.auction_id
				WHERE a.tx = ? AND s.winner = 1 AND s.tx = ? LIMIT 1`,
			tx,
			tx
		);
		return row?.solver ?? null;
	}

	/** Solutions of the auctions that started in a block range, by auction then ranking. */
	solutionsByStart(range: BlockRange): SolutionRow[] {
		return this.#all(
			`${SOLUTION_ROWS} WHERE a.start_block BETWEEN ? AND ? ORDER BY a.id, s.ranking`,
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

	// Tokens and registry

	symbols(): Map<string, string> {
		const rows = this.#all<{ address: string; symbol: string }>(
			"SELECT address, symbol FROM tokens"
		);
		return new Map(rows.map((row) => [row.address, row.symbol]));
	}

	saveSymbols(symbols: Map<string, string>): void {
		this.#transaction(() => {
			for (const [address, symbol] of symbols) {
				this.#run(
					"INSERT OR REPLACE INTO tokens (address, symbol) VALUES (?, ?)",
					address,
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
}

const TRADE_ROWS = `SELECT tr.tx, tr.log_index AS logIndex, tr.settlement_log_index AS settlementLogIndex,
	tr.block, tr.sell_token AS sellToken, tr.buy_token AS buyToken, tr.sell_amount AS sellAmount,
	tr.buy_amount AS buyAmount, a.auction_id AS auctionId
	FROM trades tr LEFT JOIN auction_txs a ON a.tx = tr.tx`;

const SOLUTION_ROWS = `SELECT a.id AS auctionId, a.start_block AS startBlock, s.solver, s.ranking,
	s.winner, s.filtered_out AS filteredOut, s.tx
	FROM auctions a JOIN solutions s ON s.auction_id = a.id`;
