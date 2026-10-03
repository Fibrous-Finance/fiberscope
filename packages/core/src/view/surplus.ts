import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { FEW_TRADES } from "./view.ts";
import type { Row, View } from "./view.ts";

/**
 * "What traders gained, what settling cost": trader surplus and transaction cost over the
 * selected window, per ranked solver and for the whole network. Surplus needs auction prices and
 * order terms, so it covers the window's surplus days; cost covers its chain days. Every ratio
 * divides two totals over the same days, and the network's figures are totals over every
 * solver, so its averages weigh solvers by their trades, as the gas average does.
 */
export interface SurplusCostFigures {
	/** Trader surplus in USD over the surplus days; null when the window has none. */
	surplus: number | null;
	/** The trades `surplus` sums over: priced trades with known order terms; null like it. */
	surplusTrades: number | null;
	/** `surplus` ÷ `surplusTrades`; null without such trades. */
	surplusPerTrade: number | null;
	/** The USD volume of `surplusTrades`, valued as Volume is; null like `surplus`. */
	surplusVolume: number | null;
	/**
	 * `surplus` ÷ the USD volume of the same trades: surplus per dollar traded, a 0–1 ratio
	 * (0.0008 is 8 bps). Unlike surplus per trade it does not grow with the size of the trades a
	 * solver happens to settle. Null without such trades.
	 */
	surplusRate: number | null;
	/**
	 * The part of `surplus` from unusual trades, whose surplus is more than a tenth of their
	 * value: CoW's own split (see `SnapshotSolver.unusualSurplus`). Null like `surplus`.
	 */
	unusualSurplus: number | null;
	/** The unusual trades among `surplusTrades`; null like `surplus`. */
	unusualTrades: number | null;
	/** `unusualSurplus` ÷ `surplus`, a 0–1 ratio; null without surplus. */
	unusualShare: number | null;
	/** `unusualTrades` ÷ `surplusTrades`, a 0–1 ratio; null without such trades. */
	unusualTradeShare: number | null;
	/** `surplus` without the unusual trades' part; null like `surplus`. */
	typicalSurplus: number | null;
	/** `surplusTrades` without the unusual ones; null like `surplus`. */
	typicalTrades: number | null;
	/** `typicalSurplus` ÷ `typicalTrades`; null without typical trades. */
	typicalSurplusPerTrade: number | null;
	/** `typicalSurplus` ÷ the USD volume of the typical trades; null without that volume. */
	typicalSurplusRate: number | null;
	/** Transaction cost in USD over the chain days. */
	cost: number;
	/** `cost` ÷ trades over the chain days; null without trades. */
	costPerTrade: number | null;
	/** `cost` ÷ batches over the chain days; null without batches. */
	costPerBatch: number | null;
	/**
	 * Cost per dollar traded, a 0–1 ratio comparable with `surplusRate`: cost ÷ volume, both over
	 * the auction days. Null without priced volume.
	 */
	costRate: number | null;
}

export interface SurplusCost {
	/** Days of the window behind each figure. */
	coverage: {
		/** Every surplus figure: `surplus` to `typicalSurplusRate`. */
		surplus: number;
		/** `cost`, `costPerTrade` and `costPerBatch`. */
		cost: number;
		/** `costRate`. */
		costRate: number;
	};
	/** Each ranked solver's figures, by solver id. */
	rows: Map<string, SurplusCostFigures>;
	/** The network's figures: totals over every solver. */
	network: SurplusCostFigures;
}

export function surplusAndCost(snapshot: Snapshot, view: View): SurplusCost {
	const surplusDays = Math.min(view.days, snapshot.coverage.surplusDays);
	const { chain: chainDays, auction: auctionDays } = view.coverage;
	const figures = (solvers: readonly SnapshotSolver[]): SurplusCostFigures => {
		let surplus = 0;
		let surplusTrades = 0;
		let surplusVolume = 0;
		let unusualSurplus = 0;
		let unusualTrades = 0;
		let unusualVolume = 0;
		let cost = 0;
		let trades = 0;
		let batches = 0;
		let auctionCost = 0;
		let volume = 0;
		for (const s of solvers) {
			surplus += total(s.surplus, surplusDays);
			surplusTrades += total(s.surplusTrades, surplusDays);
			surplusVolume += total(s.surplusVolume, surplusDays);
			unusualSurplus += total(s.unusualSurplus, surplusDays);
			unusualTrades += total(s.unusualTrades, surplusDays);
			unusualVolume += total(s.unusualVolume, surplusDays);
			cost += total(s.cost, chainDays);
			trades += total(s.trades, chainDays);
			batches += total(s.batches, chainDays);
			auctionCost += total(s.cost, auctionDays);
			volume += total(s.volume, auctionDays);
		}
		const measured = surplusDays > 0;
		// Typical is what the unusual trades leave. Without typical trades it is 0, not the float
		// residue of a subtraction, and the clamp absorbs the residue otherwise.
		const typicalTrades = surplusTrades - unusualTrades;
		const typicalSurplus = typicalTrades > 0 ? Math.max(0, surplus - unusualSurplus) : 0;
		const typicalVolume = typicalTrades > 0 ? surplusVolume - unusualVolume : 0;
		return {
			surplus: measured ? surplus : null,
			surplusTrades: measured ? surplusTrades : null,
			surplusPerTrade: surplusTrades > 0 ? surplus / surplusTrades : null,
			surplusVolume: measured ? surplusVolume : null,
			surplusRate: surplusVolume > 0 ? surplus / surplusVolume : null,
			unusualSurplus: measured ? unusualSurplus : null,
			unusualTrades: measured ? unusualTrades : null,
			unusualShare: surplus > 0 ? unusualSurplus / surplus : null,
			unusualTradeShare: surplusTrades > 0 ? unusualTrades / surplusTrades : null,
			typicalSurplus: measured ? typicalSurplus : null,
			typicalTrades: measured ? typicalTrades : null,
			typicalSurplusPerTrade: typicalTrades > 0 ? typicalSurplus / typicalTrades : null,
			typicalSurplusRate: typicalVolume > 0 ? typicalSurplus / typicalVolume : null,
			cost,
			costPerTrade: trades > 0 ? cost / trades : null,
			costPerBatch: batches > 0 ? cost / batches : null,
			costRate: volume > 0 ? auctionCost / volume : null,
		};
	};
	// The view's rows come from the snapshot's solvers, so each has its series.
	const byId = new Map(snapshot.solvers.map((s) => [s.id, s]));
	return {
		coverage: { surplus: surplusDays, cost: chainDays, costRate: auctionDays },
		rows: new Map(view.rows.map((row) => [row.id, figures([byId.get(row.id)!])])),
		network: figures(snapshot.solvers),
	};
}

/** Basis points in a 0–1 ratio. */
const BPS = 10_000;

/**
 * The ends the trader surplus axis can take, in basis points of volume; it stops at the last one
 * even if a solver goes beyond.
 */
const SURPLUS_AXIS_ENDS: readonly number[] = [100, 150, 200, 300, 400, 500, 600, 800, 1_000];

export interface SurplusAxis {
	/** The axis end as a 0–1 ratio of volume, like `surplusRate`: 0.04 is 400 bps. */
	max: number;
	/** Ticks from 0 to `max`, as ratios: every 50 bps up to 200, every 100 up to 600, then every 200. */
	ticks: number[];
}

/**
 * The smallest axis end that holds the network's typical surplus rate and that of every solver
 * with at least `FEW_TRADES` surplus trades. Smaller solvers, and the all-trades rates that
 * unusual trades lift, can lie beyond it; they sit at its end.
 */
export function surplusAxis(
	rows: readonly Pick<SurplusCostFigures, "surplusTrades" | "typicalSurplusRate">[],
	average: number | null
): SurplusAxis {
	let need = average ?? 0;
	for (const row of rows) {
		if ((row.surplusTrades ?? 0) >= FEW_TRADES && row.typicalSurplusRate !== null) {
			need = Math.max(need, row.typicalSurplusRate);
		}
	}
	const end =
		SURPLUS_AXIS_ENDS.find((bps) => bps / BPS >= need) ??
		SURPLUS_AXIS_ENDS[SURPLUS_AXIS_ENDS.length - 1]!;
	const step = end <= 200 ? 50 : end <= 600 ? 100 : 200;
	const ticks: number[] = [];
	for (let bps = 0; bps <= end; bps += step) ticks.push(bps / BPS);
	return { max: end / BPS, ticks };
}

/** A row of the trader surplus chart: a ranked solver and its figures. */
export interface SurplusRow {
	row: Row;
	figures: SurplusCostFigures;
}

/**
 * The trader surplus chart's rows: every ranked solver with surplus trades in the window, by the
 * volume behind its surplus, largest first. The order says nothing about who gives the most
 * surplus, and the large, stable figures come first. Ties keep the view's order.
 */
export function surplusRows(
	view: Pick<View, "rows">,
	surplus: Pick<SurplusCost, "rows">
): SurplusRow[] {
	const rows: SurplusRow[] = [];
	for (const row of view.rows) {
		const figures = surplus.rows.get(row.id);
		if (figures && (figures.surplusTrades ?? 0) > 0) rows.push({ row, figures });
	}
	return rows.sort((a, b) => (b.figures.surplusVolume ?? 0) - (a.figures.surplusVolume ?? 0));
}

/** The newest `days` values of a daily series, added up; the series may be shorter. */
function total(series: readonly number[], days: number): number {
	let sum = 0;
	for (let d = 0; d < Math.min(days, series.length); d++) sum += series[d] ?? 0;
	return sum;
}
