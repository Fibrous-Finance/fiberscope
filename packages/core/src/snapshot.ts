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
	/**
	 * The commit (full hash) of the indexer code that wrote this file; absent when its build did
	 * not record one. The page links it in the footer.
	 */
	commit?: string;
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
	 *   terms, read from its settlement's calldata, so it is never more than `auctionDays`. The
	 *   indexer reads the calldata as it stores each settlement, so it covers the same days.
	 * - `detailDays`: what CoW's API tells about each auction's solutions and each trade's order:
	 *   every solution's score and whether CIP-67's fairness filter removed it, the quote each
	 *   order was placed with, and the protocol fees charged on each trade. The indexer looks it
	 *   up after the auction data, so it is never more than `auctionDays`.
	 */
	coverage: { chainDays: number; auctionDays: number; surplusDays: number; detailDays: number };
	/** Auction totals per bucket; length `coverage.auctionDays`. */
	auctions: {
		/** Auctions that produced at least one settlement. */
		count: number[];
		/** Solutions submitted in those auctions, all solvers together. */
		solutions: number[];
	};
	/**
	 * Every solver with a batch in `chainDays`, an entered auction in `auctionDays` or a quote in
	 * `detailDays`.
	 */
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
	 * DEX swaps in those settlements: their interactions other than ERC-20 approvals and unwraps
	 * of the wrapped native token (WETH, WBNB). Length `coverage.chainDays`.
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
	/**
	 * Solutions it submitted to the auctions that started in each bucket, filtered-out ones
	 * included. Length `coverage.detailDays`.
	 */
	solutions: number[];
	/**
	 * Of those, the ones CIP-67's fairness filter removed; a filtered-out solution cannot win.
	 * Length `coverage.detailDays`.
	 */
	filteredOut: number[];
	/**
	 * Auctions it lost that had a single winning solution: auctions in which another solver's
	 * solution won and at least one of its own solutions passed the filter. In an auction with
	 * several winning solutions, which winner a losing solution competed with is unknown, so it
	 * counts in neither this nor `closeLosses`. Length `coverage.detailDays`.
	 */
	losses: number[];
	/**
	 * Of those, the ones it lost by 1% or less: its best solution that passed the filter scored
	 * at least 99% of the winning score. Length `coverage.detailDays`.
	 */
	closeLosses: number[];
	/**
	 * Trades settled in each bucket, by any solver, whose order was placed with this solver's
	 * quote. Length `coverage.detailDays`.
	 */
	quotes: number[];
	/** Of those, the ones whose quote CoW verified by simulating it. Length `coverage.detailDays`. */
	quotesVerified: number[];
	/** Of those `quotes`, the trades this solver settled itself. Length `coverage.detailDays`. */
	quotesSettled: number[];
	/**
	 * USD of CoW's protocol fees on the trades it settled. Each fee is valued at its trade's own
	 * exchange rate: its share of the trade's amount in the fee's token, times the trade's value
	 * (as in `volume`). To a hundredth of a cent. Length `coverage.detailDays`.
	 */
	protocolFees: number[];
	/**
	 * USD of the partner fees on the trades it settled: the fees an order's app data asks for on
	 * behalf of the app or wallet that placed it, valued like `protocolFees`. A fee CoW's API
	 * does not mark as either kind counts in neither. Length `coverage.detailDays`.
	 */
	partnerFees: number[];
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
	/**
	 * Every solution, in CoW's ranking: the winning ones first, then the others by score, then
	 * the ones CIP-67's fairness filter removed.
	 */
	solutions: AuctionSolution[];
}

export interface AuctionSolution {
	/** Id of the solver that submitted it (`SnapshotSolver.id`). */
	solver: string;
	/**
	 * Its score (CIP-20), converted from the native token to USD at the ETH/USD rate of the
	 * auction's start block, to 6 significant figures. Null when CoW's API gave none.
	 */
	score: number | null;
	/** Present when CIP-67's fairness filter removed it. */
	filteredOut?: true;
	/** Present when it won; an auction can have several winning solutions. */
	winner?: true;
}

export interface SettlementSummary {
	tx: string;
	block: number;
	/** Block timestamp (Unix ms). */
	time: number;
	trades: number;
	/** DEX swaps: interactions other than ERC-20 approvals and unwraps of the wrapped native token. */
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
	/**
	 * The solver whose quote the order of the first trade (as in `pair`) was placed with; null
	 * when it was placed without a solver's quote. Absent when the order was not looked up in
	 * CoW's order book, as outside `coverage.detailDays`.
	 */
	quotedBy?: string | null;
}

/** A settlement of the network-wide list: its summary and the credited solver. */
export interface CreditedSettlement extends SettlementSummary {
	/** Id of the solver credited with the settlement (`SnapshotSolver.id`). */
	solver: string;
	/**
	 * USD of CoW's protocol fees on its trades (see `SnapshotSolver.protocolFees`); null when the
	 * fees of one of its trades are unknown or cannot be valued or split into the two kinds.
	 */
	protocolFee: number | null;
	/** USD of the partner fees on its trades (see `SnapshotSolver.partnerFees`); null likewise. */
	partnerFee: number | null;
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
