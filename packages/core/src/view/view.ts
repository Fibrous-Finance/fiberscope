import { shortAddress } from "../format.ts";
import type {
	AuctionSummary,
	SettlementSummary,
	Snapshot,
	SnapshotSolver,
	SolverAddress,
} from "../snapshot.ts";

/**
 * Everything the page shows for one period and measure, derived from a snapshot. Pure and
 * locale-free: values are numbers (shares and rates are 0–1 ratios) and the UI formats them.
 */

export type Period = "24h" | "7d" | "30d" | "90d" | "180d";
export type Measure = "batches" | "trades" | "volume";

export const PERIODS: readonly Period[] = ["24h", "7d", "30d", "90d", "180d"];
export const MEASURES: readonly Measure[] = ["batches", "trades", "volume"];

/** Days in each window. */
export const PERIOD_DAYS: Record<Period, number> = {
	"24h": 1,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"180d": 180,
};
/**
 * Days of daily history drawn for each window: the network chart, the small multiples, the solver
 * detail chart and (a slice of it) the table's sparkline.
 */
export const HISTORY_DAYS: Record<Period, number> = {
	"24h": 30,
	"7d": 30,
	"30d": 60,
	"90d": 90,
	"180d": 180,
};
/** The table's sparkline covers at least this many days, where the data reaches that far. */
const SPARK_MIN_DAYS = 14;
/**
 * "Lowest gas / trade" prefers solvers with at least this many batches per covered day of the
 * window; when none has that many, it takes the lowest of all. Methodology states both.
 */
export const MIN_BATCHES_PER_DAY = 100;
/** A gain smaller than this (percentage points) is not worth a sentence. */
const MIN_GAIN_POINTS = 0.1;
/** Solvers with fewer trades are drawn as hollow dots in the gas chart. */
export const FEW_TRADES = 30;
export const DAY_MS = 86_400_000;

export interface SolverRef {
	id: string;
	/** The registry name, or the shortened prod address for unnamed solvers. */
	label: string;
	/** No registry names this solver; the label is an address. */
	unnamed: boolean;
}

export interface Row extends SolverRef {
	/** Rank by the active measure, from 1. */
	rank: number;
	addresses: SolverAddress[];
	batches: number;
	trades: number;
	/** Gas units used by the solver's batches. */
	gas: number;
	gasPerTrade: number | null;
	/** DEX swaps in the solver's batches. */
	swaps: number;
	swapsPerTrade: number | null;
	/** Volume ÷ batches over the auction-covered days. */
	batchValue: number | null;
	tradesPerBatch: number | null;
	/** USD over the auction-covered days; null when the window has no auction data. */
	volume: number | null;
	/** Volume ÷ trades over the same auction-covered days. */
	averageTrade: number | null;
	entered: number | null;
	won: number | null;
	/**
	 * Share of the window's auctions the solver entered. This and the two rates below are null when
	 * it entered none: every batch comes from a won auction, so a solver with batches but no entries
	 * means its auction data is missing (days before the auction history, or settlements CoW's API
	 * has no competition for), and "0%" would claim more than is known.
	 */
	participation: number | null;
	/** Auctions won ÷ auctions entered. */
	winRate: number | null;
	/** Auctions won ÷ all auctions in the window. */
	wonShare: number | null;
	shares: Record<Measure, number | null>;
	/** Share of the active measure. */
	share: number;
	ranks: Record<Measure, number | null>;
	/** Places gained since the earlier window (negative: lost); null when there is no rank to compare. */
	rankChange: number | null;
	/** Nothing in the earlier window. Only set when an earlier window exists. */
	isNew: boolean;
	/** Change in share since the earlier window, in percentage points. */
	shareChange: number | null;
	/** Daily share of the active measure, oldest first, aligned with `View.history`. */
	daily: number[];
	latestSettlements: SettlementSummary[];
}

export type Fraction =
	| {
			key:
				| "all"
				| "moreThanHalf"
				| "half"
				| "nearlyHalf"
				| "twoInFive"
				| "aThird"
				| "overAQuarter"
				| "aQuarter"
				| "oneInFive";
	  }
	| { key: "oneIn"; n: number };

export interface LeaderRun {
	solver: SolverRef;
	/** Consecutive rolling days, ending with the latest, on which the solver alone led the daily measure. */
	days: number;
	/** The day the run started (end time of its first rolling day). */
	since: number;
	/**
	 * The day before the run has no data: the run reaches back to the start of the data (or to a
	 * day without any), so it may be longer.
	 */
	atLeast: boolean;
	/**
	 * The solver that alone led the day before the run started; null when no one did. With
	 * `atLeast` false, that day was a tie for the most: the run started "alone".
	 */
	previous: SolverRef | null;
}

export interface Entrant extends SolverRef {
	entered: number;
	won: number;
	participation: number;
	winRate: number;
	wonShare: number;
}

export interface TapeCell {
	state: "won" | "entered" | "absent";
	/** The settlement to open: the solver's own when it won, otherwise the first winner's. */
	tx: string | null;
}

export interface TapeAuction {
	id: number;
	time: number;
	entered: number;
	winners: SolverRef[];
	/** The first winner's settlement. */
	tx: string | null;
}

export interface TapeRow extends SolverRef {
	cells: TapeCell[];
}

export interface View {
	period: Period;
	measure: Measure;
	/** Days in the window. */
	days: number;
	end: { block: number; time: number };
	/** Start of the window (Unix ms). */
	start: number;
	coverage: {
		/** Days of the window with chain data: batches, trades, swaps, gas. */
		chain: number;
		/** Days of the window with auction data: volume, entered, won. */
		auction: number;
	};
	/** An earlier window of the same length exists for the active measure. */
	hasEarlierWindow: boolean;
	totals: {
		batches: number;
		trades: number;
		volume: number | null;
		solvers: number;
		auctions: number | null;
		solutions: number | null;
	};
	/**
	 * Total of the active measure; 0 means nothing in the window counts toward it (no batches, or for
	 * volume, no priced auction data).
	 */
	total: number;
	/** Solvers with a batch in the window, ranked by the active measure. */
	rows: Row[];
	headline: Fraction | null;
	/** The volume leader, when it differs from the leader of the active measure. */
	volumeLeader: Row | null;
	/** Bucket end times behind `Row.daily`, oldest first. */
	history: number[];
	sparkDays: number;
	leaderRun: LeaderRun | null;
	biggestGain: { solver: Row; points: number; isLeader: boolean } | null;
	gas: {
		/** Trade-weighted average across all solvers. */
		average: number | null;
		max: number | null;
		lowest: Row | null;
		minBatches: number;
	};
	swaps: {
		/** Trade-weighted average across all solvers: Σswaps ÷ Σtrades. */
		average: number | null;
	};
	competition: {
		auctions: number;
		solutionsPerAuction: number;
		/** Average number of solvers entering each auction. */
		entrantsPerAuction: number;
		/** Solvers that entered at least one auction, by share of all auctions won. */
		entrants: Entrant[];
		/** Rows that entered none of the window's auctions. */
		withoutAuctions: Row[];
	} | null;
	tape: { auctions: TapeAuction[]; rows: TapeRow[] };
}

export function solverRef(solver: SnapshotSolver): SolverRef {
	const prod = solver.addresses.find((a) => a.env === "prod") ?? solver.addresses[0];
	return {
		id: solver.id,
		label: solver.name ?? shortAddress(prod?.address ?? solver.id),
		unnamed: solver.name === null,
	};
}

/** The headline's "{fraction} of all {network} {measure} went to one solver"; "all" only at 100%. */
export function fractionOf(share: number): Fraction {
	if (share >= 1) return { key: "all" };
	if (share >= 0.55) return { key: "moreThanHalf" };
	if (share >= 0.5) return { key: "half" };
	if (share >= 0.44) return { key: "nearlyHalf" };
	if (share >= 0.36) return { key: "twoInFive" };
	if (share >= 0.3) return { key: "aThird" };
	if (share >= 0.27) return { key: "overAQuarter" };
	if (share >= 0.23) return { key: "aQuarter" };
	if (share >= 0.18) return { key: "oneInFive" };
	return { key: "oneIn", n: Math.round(1 / share) };
}

/** Sum of `series[from..to)`; series may be shorter than `to`. */
function sum(series: readonly number[], from: number, to: number): number {
	let total = 0;
	for (let i = from; i < Math.min(to, series.length); i++) total += series[i] ?? 0;
	return total;
}

/**
 * The measure's total over a period's window, as `View.total` counts it: 0 when nothing in the
 * window counts toward it (no batches; for volume, no priced trade on the days with auction data).
 */
export function windowTotal(snapshot: Snapshot, period: Period, measure: Measure): number {
	const { chainDays, auctionDays } = snapshot.coverage;
	const days = Math.min(PERIOD_DAYS[period], measure === "volume" ? auctionDays : chainDays);
	return snapshot.solvers.reduce((total, s) => total + sum(s[measure], 0, days), 0);
}

/** 1-based ranks by `value`, descending; ties keep the given order. Zero values get no rank. */
function rankBy<T>(items: readonly T[], value: (item: T) => number): Map<T, number> {
	const ranked = items.filter((item) => value(item) > 0).sort((a, b) => value(b) - value(a));
	return new Map(ranked.map((item, i) => [item, i + 1]));
}

/** The settlement a tape cell opens for `solverId`: its own when it won, else the first winner's. */
export function tapeCell(auction: AuctionSummary, solverId: string): TapeCell {
	const own = auction.winners.find((w) => w.solver === solverId);
	if (own) return { state: "won", tx: own.tx };
	return {
		state: auction.entered.includes(solverId) ? "entered" : "absent",
		tx: auction.winners[0]?.tx ?? null,
	};
}

export function buildView(snapshot: Snapshot, period: Period, measure: Measure): View {
	const days = PERIOD_DAYS[period];
	const { chainDays, auctionDays } = snapshot.coverage;
	const chain = Math.min(days, chainDays);
	const auction = Math.min(days, auctionDays);
	const measureCoverage = measure === "volume" ? auctionDays : chainDays;
	const hasEarlierWindow = measureCoverage >= 2 * days;
	const auctions = auction > 0 ? sum(snapshot.auctions.count, 0, auction) : null;
	const solutions = auction > 0 ? sum(snapshot.auctions.solutions, 0, auction) : null;
	const hasAuctions = auctions !== null && auctions > 0;

	// Daily values of the active measure for every solver, so bucket d of solver i is series[i][d].
	const series = snapshot.solvers.map((s) => s[measure]);

	const solvers = snapshot.solvers.map((s, i) => {
		const ref = solverRef(s);
		const batches = sum(s.batches, 0, chain);
		const trades = sum(s.trades, 0, chain);
		const volume = auction > 0 ? sum(s.volume, 0, auction) : null;
		const entered = hasAuctions ? sum(s.entered, 0, auction) : null;
		const won = hasAuctions ? sum(s.won, 0, auction) : null;
		const tradesWithPrices = sum(s.trades, 0, auction);
		const batchesWithPrices = sum(s.batches, 0, auction);
		return {
			ref,
			source: s,
			index: i,
			batches,
			trades,
			gas: sum(s.gas, 0, chain),
			swaps: sum(s.swaps, 0, chain),
			volume,
			averageTrade:
				volume !== null && tradesWithPrices > 0 ? volume / tradesWithPrices : null,
			batchValue:
				volume !== null && batchesWithPrices > 0 ? volume / batchesWithPrices : null,
			entered,
			won,
			value: sum(series[i] ?? [], 0, measure === "volume" ? auction : chain),
			previous: hasEarlierWindow ? sum(series[i] ?? [], days, 2 * days) : 0,
		};
	});
	type Solver = (typeof solvers)[number];

	const totalBatches = solvers.reduce((a, s) => a + s.batches, 0);
	const totalTrades = solvers.reduce((a, s) => a + s.trades, 0);
	const totalVolume = auction > 0 ? solvers.reduce((a, s) => a + (s.volume ?? 0), 0) : null;
	const total = solvers.reduce((a, s) => a + s.value, 0);
	const previousTotal = solvers.reduce((a, s) => a + s.previous, 0);
	const totalOf: Record<Measure, number | null> = {
		batches: totalBatches,
		trades: totalTrades,
		volume: totalVolume,
	};

	const active = solvers
		.filter((s) => s.batches > 0)
		.sort(
			(a, b) =>
				b.value - a.value || b.batches - a.batches || a.ref.label.localeCompare(b.ref.label)
		);
	const measureValue = (s: Solver, m: Measure) => (m === "volume" ? (s.volume ?? 0) : s[m]);
	const ranksByMeasure = Object.fromEntries(
		MEASURES.map((m) => [m, rankBy(active, (s) => measureValue(s, m))])
	) as Record<Measure, Map<Solver, number>>;
	const previousRanks = rankBy(solvers, (s) => s.previous);

	// Daily shares of the active measure over the history span.
	const span = Math.min(HISTORY_DAYS[period], measureCoverage);
	const dayTotals = Array.from({ length: span }, (_, d) =>
		series.reduce((a, s) => a + (s[d] ?? 0), 0)
	);
	const history = Array.from(
		{ length: span },
		(_, k) => snapshot.end.time - (span - 1 - k) * DAY_MS
	);

	const rows: Row[] = active.map((s, i) => {
		const share = total > 0 ? s.value / total : 0;
		const previousRank = previousRanks.get(s) ?? null;
		const shareOf = (m: Measure) => {
			const t = totalOf[m];
			return t === null || (m === "volume" && s.volume === null)
				? null
				: t > 0
					? measureValue(s, m) / t
					: 0;
		};
		return {
			...s.ref,
			rank: i + 1,
			addresses: s.source.addresses,
			batches: s.batches,
			trades: s.trades,
			gas: s.gas,
			gasPerTrade: s.trades > 0 ? s.gas / s.trades : null,
			swaps: s.swaps,
			swapsPerTrade: s.trades > 0 ? s.swaps / s.trades : null,
			batchValue: s.batchValue,
			tradesPerBatch: s.batches > 0 ? s.trades / s.batches : null,
			volume: s.volume,
			averageTrade: s.averageTrade,
			entered: s.entered,
			won: s.won,
			participation: s.entered && auctions ? s.entered / auctions : null,
			winRate: s.entered && s.won !== null ? s.won / s.entered : null,
			wonShare: s.entered && s.won !== null && auctions ? s.won / auctions : null,
			shares: {
				batches: shareOf("batches"),
				trades: shareOf("trades"),
				volume: shareOf("volume"),
			},
			share,
			ranks: {
				batches: ranksByMeasure.batches.get(s) ?? null,
				trades: ranksByMeasure.trades.get(s) ?? null,
				volume: auction > 0 ? (ranksByMeasure.volume.get(s) ?? null) : null,
			},
			rankChange: hasEarlierWindow && previousRank !== null ? previousRank - (i + 1) : null,
			isNew: hasEarlierWindow && previousRank === null,
			shareChange: hasEarlierWindow
				? (share - (previousTotal > 0 ? s.previous / previousTotal : 0)) * 100
				: null,
			daily: Array.from({ length: span }, (_, k) => {
				const d = span - 1 - k;
				const dayTotal = dayTotals[d] ?? 0;
				return dayTotal > 0 ? (series[s.index]?.[d] ?? 0) / dayTotal : 0;
			}),
			latestSettlements: s.source.latestSettlements,
		};
	});

	const leader = rows[0] ?? null;
	const byVolume =
		measure !== "volume" && auction > 0
			? rows.reduce<Row | null>(
					(best, r) => (best === null || (r.volume ?? 0) > (best.volume ?? 0) ? r : best),
					null
				)
			: null;

	// The current run of the daily leader, over every covered day. A day on which two solvers
	// tie for the most has no leader: neither "topped" it. A day without data has none either.
	const NO_DATA = -1;
	const TIE = -2;
	const leaderOf = (d: number) => {
		let best = NO_DATA;
		let bestValue = 0;
		let tied = false;
		series.forEach((s, i) => {
			const value = s[d] ?? 0;
			if (value > bestValue) {
				bestValue = value;
				best = i;
				tied = false;
			} else if (value > 0 && value === bestValue) {
				tied = true;
			}
		});
		return tied ? TIE : best;
	};
	let leaderRun: LeaderRun | null = null;
	const today = measureCoverage > 0 ? leaderOf(0) : NO_DATA;
	if (today >= 0) {
		let run = 1;
		while (run < measureCoverage && leaderOf(run) === today) run++;
		const before = run < measureCoverage ? leaderOf(run) : NO_DATA;
		leaderRun = {
			solver: solvers[today]!.ref,
			days: run,
			since: snapshot.end.time - (run - 1) * DAY_MS,
			atLeast: before === NO_DATA,
			previous: before >= 0 ? solvers[before]!.ref : null,
		};
	}

	let biggestGain: View["biggestGain"] = null;
	if (hasEarlierWindow) {
		const up = rows.reduce<Row | null>(
			(best, r) =>
				best === null || (r.shareChange ?? 0) > (best.shareChange ?? 0) ? r : best,
			null
		);
		if (up && (up.shareChange ?? 0) >= MIN_GAIN_POINTS) {
			biggestGain = {
				solver: up,
				points: up.shareChange ?? 0,
				isLeader: up.id === leaderRun?.solver.id,
			};
		}
	}

	const withGas = rows.filter((r) => r.gasPerTrade !== null);
	const gasTrades = withGas.reduce((a, r) => a + r.trades, 0);
	const minBatches = MIN_BATCHES_PER_DAY * chain;
	const byGas = [...withGas].sort((a, b) => (a.gasPerTrade ?? 0) - (b.gasPerTrade ?? 0));

	let competition: View["competition"] = null;
	if (hasAuctions && auctions !== null) {
		const entrants: Entrant[] = solvers
			.filter((s) => (s.entered ?? 0) > 0)
			.map((s) => ({
				...s.ref,
				entered: s.entered ?? 0,
				won: s.won ?? 0,
				participation: (s.entered ?? 0) / auctions,
				winRate: (s.won ?? 0) / (s.entered ?? 1),
				wonShare: (s.won ?? 0) / auctions,
			}))
			.sort((a, b) => b.wonShare - a.wonShare || b.participation - a.participation);
		competition = {
			auctions,
			solutionsPerAuction: (solutions ?? 0) / auctions,
			entrantsPerAuction: entrants.reduce((a, e) => a + e.entered, 0) / auctions,
			entrants,
			withoutAuctions: rows.filter((r) => !r.entered),
		};
	}

	// The tape: latest auctions as columns, one row per solver that entered any of them.
	const refById = new Map(solvers.map((s) => [s.ref.id, s.ref]));
	const refOf = (id: string) => refById.get(id) ?? { id, label: shortAddress(id), unnamed: true };
	const latest = snapshot.latestAuctions;
	const tapeEntries = new Map<string, number>();
	for (const a of latest) {
		for (const id of new Set([...a.entered, ...a.winners.map((w) => w.solver)])) {
			tapeEntries.set(id, (tapeEntries.get(id) ?? 0) + 1);
		}
	}
	const dayAuctions = snapshot.auctions.count[0] ?? 0;
	const participationToday = new Map(
		solvers.map((s) => [
			s.ref.id,
			dayAuctions > 0 ? (s.source.entered[0] ?? 0) / dayAuctions : 0,
		])
	);
	const tapeRows: TapeRow[] = [...tapeEntries.keys()]
		.sort(
			(a, b) =>
				(participationToday.get(b) ?? 0) - (participationToday.get(a) ?? 0) ||
				(tapeEntries.get(b) ?? 0) - (tapeEntries.get(a) ?? 0) ||
				refOf(a).label.localeCompare(refOf(b).label)
		)
		.map((id) => ({ ...refOf(id), cells: latest.map((a) => tapeCell(a, id)) }));

	return {
		period,
		measure,
		days,
		end: snapshot.end,
		start: snapshot.end.time - days * DAY_MS,
		coverage: { chain, auction },
		hasEarlierWindow,
		totals: {
			batches: totalBatches,
			trades: totalTrades,
			volume: totalVolume,
			solvers: rows.length,
			auctions,
			solutions,
		},
		total,
		rows,
		headline: leader && total > 0 ? fractionOf(leader.share) : null,
		volumeLeader: byVolume && leader && byVolume.id !== leader.id ? byVolume : null,
		history,
		sparkDays: Math.min(Math.max(SPARK_MIN_DAYS, days), span),
		leaderRun,
		biggestGain,
		gas: {
			average: gasTrades > 0 ? withGas.reduce((a, r) => a + r.gas, 0) / gasTrades : null,
			max: byGas.length > 0 ? (byGas[byGas.length - 1]!.gasPerTrade ?? null) : null,
			lowest: byGas.find((r) => r.batches >= minBatches) ?? byGas[0] ?? null,
			minBatches,
		},
		swaps: {
			average: gasTrades > 0 ? withGas.reduce((a, r) => a + r.swaps, 0) / gasTrades : null,
		},
		competition,
		tape: {
			auctions: latest.map((a) => ({
				id: a.id,
				time: a.time,
				entered: a.entered.length,
				winners: a.winners.map((w) => refOf(w.solver)),
				tx: a.winners[0]?.tx ?? null,
			})),
			rows: tapeRows,
		},
	};
}

export type SortKey =
	"share" | "batches" | "trades" | "volume" | "gas" | "participation" | "winRate";
export interface Sort {
	key: SortKey;
	/** -1 descending, 1 ascending. */
	direction: 1 | -1;
}

/** Gas sorts lowest first on the first click; everything else highest first. */
export const FIRST_DIRECTION: Record<SortKey, 1 | -1> = {
	share: -1,
	batches: -1,
	trades: -1,
	volume: -1,
	gas: 1,
	participation: -1,
	winRate: -1,
};

/** The table order; rows without a value always sort last. */
export function sortRows(rows: readonly Row[], sort: Sort): Row[] {
	const valueOf = (r: Row): number | null => {
		switch (sort.key) {
			case "share":
				return r.share;
			case "gas":
				return r.gasPerTrade;
			default:
				return r[sort.key];
		}
	};
	return [...rows].sort((a, b) => {
		const x = valueOf(a);
		const y = valueOf(b);
		if (x === null) return y === null ? 0 : 1;
		if (y === null) return -1;
		return (x - y) * sort.direction;
	});
}
