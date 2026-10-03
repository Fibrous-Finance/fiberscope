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
	/** When the indexer last completed a run (Unix ms). The page measures freshness from `end.time`. */
	lastRunAt: number;
	/** Minutes between scheduled indexer runs. */
	refreshMinutes: number;
	/**
	 * How many buckets hold complete data.
	 * - `chainDays`: batches, trades, swaps and gas (settlement events and receipts), and the
	 *   settlement history behind `latestSettlements` and `registry`.
	 * - `auctionDays`: volume, entered, won and the auction totals. Volume is priced with each
	 *   auction's native prices, so it needs the auction data too.
	 */
	coverage: { chainDays: number; auctionDays: number };
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
	/** Gas units used. */
	gas: number;
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
	 * Every registered address, prod before barn, active first. An address registered in both
	 * environments is listed for each.
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
