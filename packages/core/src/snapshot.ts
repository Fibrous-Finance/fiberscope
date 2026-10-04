import type { NetworkId } from "./networks.ts";

/**
 * Everything the web app shows for one network, as written by the indexer.
 *
 * Time is cut into rolling days that end at `end.time`: bucket 0 is the 24 hours up to
 * `end.time`, bucket d is (end.time − (d + 1) days, end.time − d days]. Every window on the page
 * is a sum of buckets: the 7-day window is buckets 0–6 and the window before it is buckets 7–13.
 * Series are newest first and zero-filled, so index d is always bucket d.
 */
export interface Snapshot {
	/** Shape version; bumped on breaking changes. */
	schema: 1;
	network: NetworkId;
	/** When this file was written (Unix ms). */
	builtAt: number;
	/** The last indexed block and its timestamp (Unix ms). Every window ends here. */
	end: { block: number; time: number };
	/**
	 * When the indexer last caught up with the chain head (Unix ms); a run then backfills history.
	 * The page measures freshness from `end.time`, and times its next fetch from this: the next
	 * run catches up `refreshMinutes` later.
	 */
	lastRunAt: number;
	/** Minutes between scheduled indexer runs. */
	refreshMinutes: number;
	/**
	 * How many buckets hold complete data.
	 * - `chainDays`: batches, trades, swaps, gas and cost (settlement events and receipts), and the
	 *   settlement history behind `latestSettlements` and `registry`.
	 * - `auctionDays`: volume, entered, won and the auction totals. Volume is priced with each
	 *   auction's native prices, so it needs the auction data too.
	 * - `surplusDays`: surplus. It is priced like volume and needs each trade's signed order
	 *   terms, read from its settlement's calldata, so it covers the auction days whose calldata
	 *   has been read: never more than `auctionDays`, and as many once that reading is done.
	 */
	coverage: { chainDays: number; auctionDays: number; surplusDays: number };
	/** Auction totals per bucket; length `coverage.auctionDays`. */
	auctions: {
		/** Auctions that produced at least one settlement. */
		count: number[];
		/** Solutions submitted in those auctions, all solvers together. */
		solutions: number[];
	};
	/** Every solver with a batch in `chainDays` or an entered auction in `auctionDays`. */
	solvers: SnapshotSolver[];
	/** The latest auctions (at most 48), oldest first. */
	latestAuctions: AuctionSummary[];
	/** The most recent settlements of all solvers together (at most 50), newest first. */
	latestSettlements: CreditedSettlement[];
	/**
	 * Every solver in CoW's registry for the network, inactive ones and ones without a settlement
	 * included. The most recent settlement first; then the solvers without one, active first,
	 * by name.
	 */
	registry: RegisteredSolver[];
}

export interface SnapshotSolver {
	/** Stable id: CoW's registry id for the solver, or the lowercase address when it has none. */
	id: string;
	/** Display name; null when no registry names the solver (the UI shows the address). */
	name: string | null;
	/** Submission addresses, prod before barn. */
	addresses: SolverAddress[];
	/** Settlements with at least one trade. Length `coverage.chainDays`. */
	batches: number[];
	/** Trades (filled orders) in those settlements. Length `coverage.chainDays`. */
	trades: number[];
	/**
	 * DEX swaps in those settlements: their interactions other than ERC-20 approvals and WETH
	 * unwraps. Length `coverage.chainDays`.
	 */
	swaps: number[];
	/** Gas units used by those settlements. Length `coverage.chainDays`. */
	gas: number[];
	/** USD value of those trades (see Methodology). Length `coverage.auctionDays`. */
	volume: number[];
	/**
	 * Trader surplus in USD, as Dune's CoW Protocol trades model defines `surplus_usd`: each
	 * trade's USD value (as in `volume`) times how far its executed price beat the limit price
	 * the trader signed, (bought × limitSell − sold × limitBuy) ÷ (bought × limitSell). Bought
	 * and sold are the executed amounts, sold without the order's fee; limitSell and limitBuy
	 * are the signed sell and buy amounts, read from the settle() calldata. The same expression
	 * holds for sell and buy orders, whole or partial fills. Summed over the trades that have
	 * it: priced trades whose order terms the calldata gave. To a hundredth of a cent. Length
	 * `coverage.surplusDays`.
	 */
	surplus: number[];
	/** The trades `surplus` sums over. Length `coverage.surplusDays`. */
	surplusTrades: number[];
	/**
	 * USD value (as in `volume`) of the trades `surplus` sums over. Length
	 * `coverage.surplusDays`.
	 */
	surplusVolume: number[];
	/**
	 * The part of `surplus` from unusual trades: those whose surplus is more than a tenth of
	 * their value, that is whose ratio (bought × limitSell − sold × limitBuy) ÷ (bought ×
	 * limitSell) exceeds 0.1, decided exactly on the amounts. The split is CoW's own: its Dune
	 * query "V3: Total User Surplus" (dune.com/queries/1368423) calls a trade's surplus unusual
	 * when surplus_usd > 0.1 × usd_value, reasonable otherwise. Such surplus comes from limits
	 * set far from the market, so it says more about the order than about how it was settled.
	 * Typical surplus is `surplus` minus this. Length `coverage.surplusDays`.
	 */
	unusualSurplus: number[];
	/** The unusual trades among `surplusTrades`. Length `coverage.surplusDays`. */
	unusualTrades: number[];
	/** USD value (as in `volume`) of those unusual trades. Length `coverage.surplusDays`. */
	unusualVolume: number[];
	/**
	 * Transaction cost in USD: each batch's transaction fee, gas used × effective gas price plus
	 * the L1 data fee, converted at the Chainlink ETH/USD rate of its block and split evenly
	 * between the batches the transaction holds, as gas is. To a hundredth of a cent: a batch
	 * often costs less than a cent. Length `coverage.chainDays`.
	 */
	cost: number[];
	/** Auctions in which the solver submitted at least one solution. Length `coverage.auctionDays`. */
	entered: number[];
	/** Auctions the solver won, alone or with other winners. Length `coverage.auctionDays`. */
	won: number[];
	/** The most recent settlements (at most 6), newest first. */
	latestSettlements: SettlementSummary[];
}

export interface SolverAddress {
	env: "prod" | "barn";
	/** Lowercase hex address. */
	address: string;
}

export interface AuctionSummary {
	id: number;
	/** Timestamp of the auction's start block (Unix ms). */
	time: number;
	/** Ids of the solvers that submitted at least one solution. */
	entered: string[];
	/** Winning solvers and the settlement each produced (null when it never settled). */
	winners: { solver: string; tx: string | null }[];
}

export interface SettlementSummary {
	tx: string;
	block: number;
	/** Block timestamp (Unix ms). */
	time: number;
	trades: number;
	/** DEX swaps: interactions other than ERC-20 approvals and WETH unwraps. */
	swaps: number;
	/** Token symbols of the first trade. */
	pair: { sell: string; buy: string };
	/** USD; null when the auction's prices are unavailable. */
	volume: number | null;
	/**
	 * Trader surplus in USD (see `SnapshotSolver.surplus`) of the trades that have it; null when
	 * none has.
	 */
	surplus: number | null;
	/** Gas units used. */
	gas: number;
	/** Transaction cost in USD (see `SnapshotSolver.cost`); null without an ETH/USD rate. */
	cost: number | null;
}

/** A settlement of the network-wide list: its summary and the credited solver. */
export interface CreditedSettlement extends SettlementSummary {
	/** Id of the solver credited with the settlement (`SnapshotSolver.id`). */
	solver: string;
}

/** A solver as CoW's registry lists it, with its history in `coverage.chainDays`. */
export interface RegisteredSolver {
	/** The registry's id for the solver, as in `SnapshotSolver.id`. */
	id: string;
	name: string;
	/** At least one of its addresses is active. */
	active: boolean;
	/**
	 * Every registered address: prod before barn, and within each, active before inactive. An
	 * address registered in both environments is listed for each.
	 */
	addresses: RegisteredAddress[];
	/** Its most recent settlement; null when it has none in `coverage.chainDays`. */
	lastSettlement: Pick<SettlementSummary, "tx" | "block" | "time"> | null;
	/** Settlements with at least one trade in `coverage.chainDays`. */
	batches: number;
}

export interface RegisteredAddress extends SolverAddress {
	/** Whether the registry lists the address as active; inactive addresses are retired. */
	active: boolean;
}
