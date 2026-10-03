import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import type { View } from "./view.ts";

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

/** The newest `days` values of a daily series, added up; the series may be shorter. */
function total(series: readonly number[], days: number): number {
	let sum = 0;
	for (let d = 0; d < Math.min(days, series.length); d++) sum += series[d] ?? 0;
	return sum;
}
