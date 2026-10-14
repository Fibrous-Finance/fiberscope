import type { Snapshot, SnapshotSolver } from "../snapshot.ts";
import { solverRef } from "./view.ts";
import type { SolverRef, View } from "./view.ts";

/**
 * Auction details over the selected window: what CoW's API adds to each auction and each trade,
 * the solutions and their filter outcomes, the quotes orders were placed with, and the fees
 * charged on trades. They cover the window's detail days, which never exceed its auction days;
 * every figure sums over those days, ratios included.
 */
export interface DetailFigures {
	/** Solutions submitted, filtered-out ones included. */
	solutions: number;
	/** Of those, the ones CIP-67's fairness filter removed. */
	filteredOut: number;
	/** `filteredOut` ÷ `solutions`; null without solutions. */
	filteredShare: number | null;
	/** Auctions with a single winning solution lost with a solution that passed the filter. */
	losses: number;
	/** Of those, the ones lost by 1% or less. */
	closeLosses: number;
	/** `closeLosses` ÷ `losses`; null without losses. */
	closeLossShare: number | null;
	/** Trades placed with a quote: a solver's own; for the network, any solver's. */
	quotes: number;
	/** `quotes` ÷ the network's quotes; null when no trade had a quote. */
	quoteShare: number | null;
	/** The quotes CoW verified by simulating them ÷ `quotes`; null without quotes. */
	verifiedShare: number | null;
	/** The quotes whose solver settled the trade itself ÷ `quotes`; null without quotes. */
	settledShare: number | null;
	/** USD of CoW's protocol fees on the trades settled. */
	protocolFees: number;
	/** USD of partner fees on the trades settled. */
	partnerFees: number;
	/** Trades settled. */
	trades: number;
	/** USD volume of those trades (see `Row.volume`). */
	volume: number;
	/** `protocolFees` ÷ `volume`, a 0–1 ratio; null without volume. */
	protocolFeeRate: number | null;
	/** `partnerFees` ÷ `volume`, a 0–1 ratio; null without volume. */
	partnerFeeRate: number | null;
}

export interface Quoter extends SolverRef {
	figures: DetailFigures;
}

export interface AuctionDetails {
	/** Days of the window with auction details; 0 when it has none. */
	coverage: number;
	/** Every solver's figures, by solver id. */
	solvers: Map<string, DetailFigures>;
	/** The network's figures: totals over every solver. */
	network: DetailFigures;
	/** Solvers that gave at least one quote, most quotes first. */
	quoters: Quoter[];
}

/** Sums of the daily series over the covered days. */
interface Totals {
	solutions: number;
	filteredOut: number;
	losses: number;
	closeLosses: number;
	quotes: number;
	quotesVerified: number;
	quotesSettled: number;
	protocolFees: number;
	partnerFees: number;
	trades: number;
	volume: number;
}

export function auctionDetails(snapshot: Snapshot, view: View): AuctionDetails {
	const days = Math.min(view.days, snapshot.coverage.detailDays);
	const sums = (solvers: readonly SnapshotSolver[]): Totals => {
		const sum = (series: (s: SnapshotSolver) => number[]) =>
			solvers.reduce((a, s) => a + total(series(s), days), 0);
		return {
			solutions: sum((s) => s.solutions),
			filteredOut: sum((s) => s.filteredOut),
			losses: sum((s) => s.losses),
			closeLosses: sum((s) => s.closeLosses),
			quotes: sum((s) => s.quotes),
			quotesVerified: sum((s) => s.quotesVerified),
			quotesSettled: sum((s) => s.quotesSettled),
			protocolFees: sum((s) => s.protocolFees),
			partnerFees: sum((s) => s.partnerFees),
			trades: sum((s) => s.trades),
			volume: sum((s) => s.volume),
		};
	};
	const network = sums(snapshot.solvers);
	const figures = (t: Totals): DetailFigures => ({
		solutions: t.solutions,
		filteredOut: t.filteredOut,
		filteredShare: ratio(t.filteredOut, t.solutions),
		losses: t.losses,
		closeLosses: t.closeLosses,
		closeLossShare: ratio(t.closeLosses, t.losses),
		quotes: t.quotes,
		quoteShare: ratio(t.quotes, network.quotes),
		verifiedShare: ratio(t.quotesVerified, t.quotes),
		settledShare: ratio(t.quotesSettled, t.quotes),
		protocolFees: t.protocolFees,
		partnerFees: t.partnerFees,
		trades: t.trades,
		volume: t.volume,
		protocolFeeRate: ratio(t.protocolFees, t.volume),
		partnerFeeRate: ratio(t.partnerFees, t.volume),
	});
	const solvers = new Map(snapshot.solvers.map((s) => [s.id, figures(sums([s]))]));
	const quoters = snapshot.solvers
		.map((s) => ({ ...solverRef(s), figures: solvers.get(s.id)! }))
		.filter((q) => q.figures.quotes > 0)
		.sort((a, b) => b.figures.quotes - a.figures.quotes || a.label.localeCompare(b.label));
	return { coverage: days, solvers, network: figures(network), quoters };
}

/** Sum of a newest-first daily series over its first `days` days. */
function total(series: readonly number[], days: number): number {
	let sum = 0;
	for (let d = 0; d < Math.min(days, series.length); d++) sum += series[d] ?? 0;
	return sum;
}

function ratio(part: number, whole: number): number | null {
	return whole > 0 ? part / whole : null;
}

/** Ends of the quotes axis, in percent of quoted trades. */
const QUOTES_AXIS_ENDS = [10, 20, 30, 40, 50, 60, 80, 100];

export interface QuotesAxis {
	/** The axis end as a 0–1 share of quoted trades. */
	max: number;
	/** Ticks from 0 to `max`, as shares: every 10% up to 60%, then every 20%. */
	ticks: number[];
}

/** The smallest axis end that holds the leading quoter's share of quoted trades. */
export function quotesAxis(leader: number): QuotesAxis {
	const end =
		QUOTES_AXIS_ENDS.find((percent) => percent / 100 >= leader) ??
		QUOTES_AXIS_ENDS[QUOTES_AXIS_ENDS.length - 1]!;
	const step = end <= 60 ? 10 : 20;
	const ticks: number[] = [];
	for (let percent = 0; percent <= end; percent += step) ticks.push(percent / 100);
	return { max: end / 100, ticks };
}
