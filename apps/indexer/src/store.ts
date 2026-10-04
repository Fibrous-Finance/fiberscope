import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue, StatementSync } from "node:sqlite";

import { ROUTER } from "./chain.ts";
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
	/**
	 * The receipt's `to`. Null in rows stored before it was kept; attribution reads it only for
	 * flash-loan router transactions, and those all have it.
	 */
	recipient: string | null;
	gasUsed: number;
	/** What the transaction paid, in wei: gas used × effective gas price, plus the L1 data fee. */
	fee: string;
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
	/** The transaction's fee in wei (see TxRow). */
	fee: string;
	/** The AllowList verdict on the sender, if it was ever checked (flash-loan router senders). */
	senderIsSolver: number | null;
	/** The AllowList verdict on the recipient, if it was ever checked (router recipients). */
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
	auctionId: number | null;
}

export interface SolutionRow {
	auctionId: number;
	startBlock: number;
	solver: string;
	winner: number;
	tx: string | null;
}

/** The schema's `PRAGMA user_version`. */
const SCHEMA_VERSION = 2;

/**
 * Settlements and trades are keyed by block and log index, so a block range is one stretch of
 * each table. Addresses are stored once, in `addresses`, and referred to by id; transaction
 * hashes are stored as their 32 bytes.
 */
const SCHEMA = `
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
	PRIMARY KEY (block, log_index)
) WITHOUT ROWID;

-- AllowList isSolver verdicts, checked once per address (flash-loan router senders, recipients).
CREATE TABLE IF NOT EXISTS allow_list (
	address INTEGER PRIMARY KEY,
	is_solver INTEGER NOT NULL
);

-- Chainlink ETH/USD answers (8 decimals), each valid from its block until the next row.
CREATE TABLE IF NOT EXISTS eth_usd (
	block INTEGER PRIMARY KEY,
	answer INTEGER NOT NULL
);

-- Auctions that ended in a settlement, and every solution submitted to them, in the API's order.
CREATE TABLE IF NOT EXISTS auctions (
	id INTEGER PRIMARY KEY,
	start_block INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_by_start ON auctions (start_block);

-- tx: the settlement of a winning solution; null for the others and for winners that never settled.
CREATE TABLE IF NOT EXISTS solutions (
	auction_id INTEGER NOT NULL,
	position INTEGER NOT NULL,
	solver INTEGER NOT NULL,
	ranking INTEGER NOT NULL,
	winner INTEGER NOT NULL,
	tx BLOB,
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

/** Binds a `0x`-prefixed hex hash to a column that stores its bytes. */
const HASH = "unhex(substr(?, 3))";

/** A hash column read back as `0x`-prefixed lowercase hex. */
function hexOf(column: string): string {
	return `'0x' || lower(hex(${column}))`;
}

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
		if (
			version < SCHEMA_VERSION &&
			this.#get("SELECT 1 FROM sqlite_schema WHERE name = 'settlements'")
		) {
			throw new Error(
				`${path} was written by an older indexer (schema version ${version}): delete it to ` +
					"index from scratch, or seed a current copy"
			);
		}
		this.#transaction(() => {
			this.db.exec(SCHEMA);
			this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		});
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
			for (const table of ["settlements", "trades", "eth_usd"]) {
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
						sell_amount, buy_amount, limit_sell_amount, limit_buy_amount, fee_amount)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					t.block,
					t.logIndex,
					t.settlementLogIndex,
					this.#addressId(t.sellToken),
					this.#addressId(t.buyToken),
					t.sellAmount,
					t.buyAmount,
					t.terms?.limitSellAmount ?? null,
					t.terms?.limitBuyAmount ?? null,
					t.terms?.feeAmount ?? null
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

	/**
	 * Deletes the chain data below `chainFrom`, and the competition links of the settlements below
	 * `auctionFrom` (null: none), and moves both ranges up to them. A flash-loan router settlement
	 * keeps its link while it is in the chain data, since its attribution may need its auction's
	 * winner. An auction goes with its last link, so one that started below `auctionFrom` stays
	 * while a later settlement needs its prices. ETH/USD keeps the answer in force at `chainFrom`.
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
		const router =
			this.#get<{ id: number }>("SELECT id FROM addresses WHERE address = ?", ROUTER)?.id ??
			null;
		const unlinked = `SELECT tx FROM settlements WHERE block >= ? AND block < ? AND solver IS NOT ?
			UNION ALL SELECT tx FROM settlements WHERE block >= ? AND block < ?`;
		const params = [
			linksGone?.from ?? 0,
			linksGone?.to ?? 0,
			router,
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
			if (linksGone !== null)
				this.#setRange("auction", { from: linksGone.to, to: auctions!.to });
			if (chainGone !== null) {
				this.#run("DELETE FROM settlements WHERE block < ?", chainFrom);
				this.#run("DELETE FROM trades WHERE block < ?", chainFrom);
				this.#run(
					"DELETE FROM eth_usd WHERE block < (SELECT MAX(block) FROM eth_usd WHERE block <= ?)",
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

	/** Every ETH/USD price point, sorted by block. */
	ethUsdPoints(): PricePoint[] {
		return this.#all<PricePoint>("SELECT block, answer FROM eth_usd ORDER BY block");
	}

	/** The block of the earliest ETH/USD price point, or null when there is none. */
	firstEthUsdBlock(): number | null {
		return this.#get<{ block: number | null }>("SELECT MIN(block) AS block FROM eth_usd")!
			.block;
	}

	saveEthUsdPoint(point: PricePoint): void {
		this.#run(
			"INSERT OR REPLACE INTO eth_usd (block, answer) VALUES (?, ?)",
			point.block,
			point.answer
		);
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

	/**
	 * Flash-loan router batch transactions never looked up in the API whose sender is not
	 * allow-listed and whose recipient is the router or not allow-listed.
	 */
	unresolvedRouterTxs(
		router: string
	): { tx: string; sender: string; recipient: string | null }[] {
		return this.#all(
			`SELECT DISTINCT ${hexOf("s.tx")} AS tx, se.address AS sender, re.address AS recipient
				FROM settlements s
				JOIN addresses se ON se.id = s.sender
				LEFT JOIN addresses re ON re.id = s.recipient
				LEFT JOIN allow_list l ON l.address = s.sender
				LEFT JOIN allow_list r ON r.address = s.recipient
				LEFT JOIN auction_txs a ON a.tx = s.tx
				WHERE s.solver = (SELECT id FROM addresses WHERE address = ?) AND s.trades > 0
					AND COALESCE(l.is_solver, 0) = 0
					AND (s.recipient = s.solver OR COALESCE(r.is_solver, 0) = 0) AND a.tx IS NULL`,
			router
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
				"INSERT OR REPLACE INTO auctions (id, start_block) VALUES (?, ?)",
				id,
				competition.startBlock
			);
			this.#run("DELETE FROM solutions WHERE auction_id = ?", id);
			competition.solutions.forEach((s, position) => {
				this.#run(
					`INSERT INTO solutions (auction_id, position, solver, ranking, winner, tx)
						VALUES (?, ?, ?, ?, ?, ${HASH})`,
					id,
					position,
					this.#addressId(s.solver),
					s.ranking,
					Number(s.winner),
					s.tx
				);
			});
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

	/** The native prices stored for an auction, by token. */
	auctionPrices(auctionId: number): Map<string, string> {
		const rows = this.#all<{ token: string; price: string }>(
			`SELECT a.address AS token, p.price FROM auction_prices p JOIN addresses a ON a.id = p.token
				WHERE p.auction_id = ?`,
			auctionId
		);
		return new Map(rows.map((row) => [row.token, row.price]));
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
	 * Solutions of the auctions that started in a block range, by auction then ranking, read one
	 * at a time.
	 */
	solutionsByStart(range: BlockRange): IterableIterator<SolutionRow> {
		return this.#iterate(
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
}

const TRADE_ROWS = `SELECT ${hexOf("s.tx")} AS tx, so.address AS solver,
	tr.settlement_log_index AS settlementLogIndex, tr.block, st.address AS sellToken,
	bt.address AS buyToken, tr.sell_amount AS sellAmount, tr.buy_amount AS buyAmount,
	tr.limit_sell_amount AS limitSellAmount, tr.limit_buy_amount AS limitBuyAmount,
	tr.fee_amount AS feeAmount, a.auction_id AS auctionId
	FROM trades tr
	JOIN settlements s ON s.block = tr.block AND s.log_index = tr.settlement_log_index
	JOIN addresses so ON so.id = s.solver
	JOIN addresses st ON st.id = tr.sell_token
	JOIN addresses bt ON bt.id = tr.buy_token
	LEFT JOIN auction_txs a ON a.tx = s.tx`;

const SOLUTION_ROWS = `SELECT a.id AS auctionId, a.start_block AS startBlock, ad.address AS solver,
	s.winner, CASE WHEN s.tx IS NULL THEN NULL ELSE ${hexOf("s.tx")} END AS tx
	FROM auctions a JOIN solutions s ON s.auction_id = a.id JOIN addresses ad ON ad.id = s.solver`;
