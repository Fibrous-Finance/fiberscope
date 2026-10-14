import { ROUTER } from "./chain.ts";
import { NETWORK } from "./config.ts";
import { auctionOutcomes, creditedBatches, tradeFees, TradeValuer } from "./facts.ts";
import { fmt, shortAddress } from "./log.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import type { BlockRange } from "./rules.ts";
import type { Store } from "./store.ts";

interface Row {
	identity: SolverIdentity;
	batches: number;
	trades: number;
	gas: number;
	cost: number;
	volume: number;
	surplus: number;
	/** Trades with a surplus. */
	surplusTrades: number;
	/** Surplus of the unusual trades among them (see TradeSurplus). */
	unusualSurplus: number;
	entered: number;
	won: number;
	/** Its solutions in scored auctions, and those of them CIP-67's filter removed. */
	scoredSolutions: number;
	filteredOut: number;
	/** Trades whose order was placed with its quote. */
	quotes: number;
	/** Its settled trades whose order had a quote, and those of them it had quoted itself. */
	quotedTrades: number;
	ownQuotes: number;
	/** USD of the protocol fees on its settled trades: CoW's own, and partners'. */
	protocolFees: number;
	partnerFees: number;
}

/**
 * Totals and a per-solver table for a block range, read from the database. Batches, trades,
 * volume, surplus, gas, cost, quotes and fees count settlements inside the range; entered, won
 * and filtered-out solutions count auctions that started inside it.
 */
export function windowReport(store: Store, registry: Registry, range: BlockRange): string {
	const out = [
		windowLine(store, range),
		...coverageWarnings(store, range, ["chain", "auction", "detail"]),
	];

	const rows = new Map<string, Row>();
	const row = (identity: SolverIdentity): Row => {
		let entry = rows.get(identity.id);
		if (!entry) {
			entry = {
				identity,
				batches: 0,
				trades: 0,
				gas: 0,
				cost: 0,
				volume: 0,
				surplus: 0,
				surplusTrades: 0,
				unusualSurplus: 0,
				entered: 0,
				won: 0,
				scoredSolutions: 0,
				filteredOut: 0,
				quotes: 0,
				quotedTrades: 0,
				ownQuotes: 0,
				protocolFees: 0,
				partnerFees: 0,
			};
			rows.set(identity.id, entry);
		}
		return entry;
	};
	let batches = 0;
	let routed = 0;
	let uncosted = 0;
	let gas = 0;
	let swaps = 0;
	let cost = 0;
	// Trades follow their batch's credit: a router batch's by its block and log index, any other
	// to the solver that settled it.
	const routedRows = new Map<string, Row>();
	for (const batch of creditedBatches(store, registry, range)) {
		const entry = row(batch.solver);
		entry.batches++;
		entry.trades += batch.trades;
		entry.gas += batch.gas;
		entry.cost += batch.cost ?? 0;
		batches++;
		gas += batch.gas;
		swaps += batch.swaps;
		cost += batch.cost ?? 0;
		if (batch.cost === null) uncosted++;
		if (batch.viaRouter) {
			routed++;
			routedRows.set(`${batch.block}:${batch.logIndex}`, entry);
		}
	}

	const valuer = new TradeValuer(store);
	// The row a trade's batch is credited to.
	const creditOf = (trade: { solver: string; block: number; settlementLogIndex: number }) =>
		trade.solver === ROUTER
			? routedRows.get(`${trade.block}:${trade.settlementLogIndex}`)!
			: rows.get(registry.identify(trade.solver).id)!;
	let trades = 0;
	let unpriced = 0;
	let oneSided = 0;
	let volume = 0;
	let surplus = 0;
	let surplusTrades = 0;
	let surplusVolume = 0;
	let unusualSurplus = 0;
	let unusualTrades = 0;
	for (const trade of store.tradeRows(range)) {
		const value = valuer.value(trade);
		trades++;
		if (value.usd === null) {
			unpriced++;
			continue;
		}
		if (value.pricedSides === 1) oneSided++;
		volume += value.usd;
		const entry = creditOf(trade);
		entry.volume += value.usd;
		if (value.surplus === null) continue;
		surplus += value.surplus.usd;
		surplusTrades++;
		surplusVolume += value.usd;
		entry.surplus += value.surplus.usd;
		entry.surplusTrades++;
		if (!value.surplus.unusual) continue;
		unusualSurplus += value.surplus.usd;
		unusualTrades++;
		entry.unusualSurplus += value.surplus.usd;
	}

	const orders = { booked: 0, notBooked: 0, unknown: 0, quoted: 0, verified: 0, ownQuotes: 0 };
	const fees = { checked: 0, unknown: 0, pending: 0, protocol: 0, partner: 0 };
	let unclearFees = 0;
	let unpricedFees = 0;
	for (const trade of store.tradeDetails(range)) {
		const entry = creditOf(trade);
		if (trade.found === null) orders.unknown++;
		else if (trade.found === 0) orders.notBooked++;
		else orders.booked++;
		if (trade.quoteSolver !== null) {
			const quoter = row(registry.identify(trade.quoteSolver));
			quoter.quotes++;
			orders.quoted++;
			if (trade.quoteVerified === 1) orders.verified++;
			entry.quotedTrades++;
			if (quoter === entry) {
				entry.ownQuotes++;
				orders.ownQuotes++;
			}
		}
		if (trade.feesChecked === null) fees.pending++;
		else if (trade.feesChecked === 0) fees.unknown++;
		else fees.checked++;
		for (const fee of tradeFees(trade, valuer)) {
			if (fee.usd === null) unpricedFees++;
			else if (fee.partner === null) unclearFees += fee.usd;
			else if (fee.partner) {
				fees.partner += fee.usd;
				entry.partnerFees += fee.usd;
			} else {
				fees.protocol += fee.usd;
				entry.protocolFees += fee.usd;
			}
		}
	}

	let auctions = 0;
	let scored = 0;
	let solutions = 0;
	let scoredSolutions = 0;
	let filteredOut = 0;
	let winners = 0;
	for (const auction of auctionOutcomes(store.solutionsByStart(range), registry)) {
		auctions++;
		solutions += auction.solutions;
		winners += auction.winners.length;
		if (auction.scored) {
			scored++;
			scoredSolutions += auction.solutions;
		}
		for (const entrant of auction.entrants.values()) {
			const entry = row(entrant.identity);
			entry.entered++;
			if (!auction.scored) continue;
			entry.scoredSolutions += entrant.solutions;
			entry.filteredOut += entrant.filteredOut;
			filteredOut += entrant.filteredOut;
		}
		for (const winner of auction.winners) rows.get(winner.solver)!.won++;
	}

	const sorted = [...rows.values()].sort(
		(a, b) => b.batches - a.batches || b.entered - a.entered
	);
	const settling = sorted.filter((entry) => entry.batches > 0).length;
	const bps = surplusVolume > 0 ? ((surplus / surplusVolume) * 10_000).toFixed(2) : "—";
	out.push(
		`Batches    ${fmt(batches)} (${fmt(routed)} via the flash-loan router; ` +
			`${fmt(store.zeroTradeSettlements(range))} zero-trade settlements excluded)`,
		`Trades     ${fmt(trades)} (${fmt(trades - unpriced - oneSided)} priced on both sides, ` +
			`${fmt(oneSided)} on one side, ${fmt(unpriced)} unpriced)`,
		`DEX swaps  ${fmt(swaps)} (${trades === 0 ? "—" : (swaps / trades).toFixed(2)} per trade)`,
		`Volume     $${fmt(volume)}`,
		`Surplus    $${fmt(surplus)} over ${fmt(surplusTrades)} priced trades with order terms ` +
			`(${usdPer(surplus, surplusTrades)} per trade, ${bps} bps of their volume); ` +
			`${share(unusualSurplus, surplus)} from ${fmt(unusualTrades)} unusual trades ` +
			`(surplus over a tenth of their value)`,
		`Gas        ${fmt(gas)} (${perTrade(gas, trades)} per trade)`,
		`Cost       $${fmt(cost)} (${usdPer(cost, trades, 4)} per trade` +
			`${uncosted > 0 ? `; ${fmt(uncosted)} batches without the ${NETWORK.native.symbol}/USD rate` : ""})`,
		`Solvers    ${fmt(settling)} with batches, ${fmt(sorted.length)} with batches or solutions`,
		`Auctions   ${fmt(auctions)} started in the window, ${fmt(solutions)} solutions, ` +
			`${(winners / Math.max(1, auctions)).toFixed(2)} winners per auction`,
		`Scores     ${fmt(scored)} of those auctions scored; ${share(filteredOut, scoredSolutions, 1)} ` +
			`of their ${fmt(scoredSolutions)} solutions filtered out`,
		`Orders     ${fmt(orders.booked)} trades of orders in CoW's order book, ` +
			`${fmt(orders.notBooked)} of orders outside it, ${fmt(orders.unknown)} not looked up; ` +
			`${fmt(orders.quoted)} placed with a quote (${fmt(orders.verified)} verified), ` +
			`${share(orders.ownQuotes, orders.quoted)} settled by the quote's solver`,
		`Fees       protocol $${fmt(fees.protocol, 2)}, partner $${fmt(fees.partner, 2)} over ` +
			`${fmt(fees.checked)} trades with fee data; ${fmt(fees.unknown)} trades without, ` +
			`${fmt(fees.pending)} not looked up` +
			`${unclearFees > 0 ? `; $${fmt(unclearFees, 2)} not split into protocol and partner` : ""}` +
			`${unpricedFees > 0 ? `; ${fmt(unpricedFees)} fees unpriced` : ""}`,
		""
	);

	const table = [
		[
			"Solver",
			"Id",
			"Batches",
			"Trades",
			"Volume $",
			"Surplus $",
			"Surplus/trade",
			"Unusual",
			"Gas/trade",
			"Cost/trade",
			"Entered",
			"Won",
			"Filtered",
			"Quotes",
			"Own quote",
			"Protocol fee $",
			"Partner fee $",
		],
		...sorted.map((entry) => [
			entry.identity.name ?? shortAddress(entry.identity.id),
			entry.identity.name === null ? "" : entry.identity.id,
			fmt(entry.batches),
			fmt(entry.trades),
			fmt(entry.volume),
			fmt(entry.surplus),
			usdPer(entry.surplus, entry.surplusTrades),
			share(entry.unusualSurplus, entry.surplus),
			perTrade(entry.gas, entry.trades),
			usdPer(entry.cost, entry.trades, 4),
			fmt(entry.entered),
			fmt(entry.won),
			share(entry.filteredOut, entry.scoredSolutions, 1),
			fmt(entry.quotes),
			share(entry.ownQuotes, entry.quotedTrades),
			fmt(entry.protocolFees, 2),
			fmt(entry.partnerFees, 2),
		]),
	];

	const widths = table[0].map((_, column) =>
		Math.max(...table.map((cells) => cells[column].length))
	);
	for (const cells of table) {
		const line = cells.map((cell, column) =>
			column < 2 ? cell.padEnd(widths[column]) : cell.padStart(widths[column])
		);
		out.push(line.join("  ").trimEnd());
	}
	return `${out.join("\n")}\n`;
}

/** A report's first line: the block range and its times. */
export function windowLine(store: Store, range: BlockRange): string {
	const iso = (block: number) =>
		new Date(store.timeOf(block) * 1000).toISOString().replace(".000", "");
	return `Window     blocks ${range.from}..${range.to}, ${iso(range.from)} → ${iso(range.to)}`;
}

/** A warning for each kind of data that does not cover the whole range. */
export function coverageWarnings(
	store: Store,
	range: BlockRange,
	kinds: ("chain" | "auction" | "detail")[]
): string[] {
	const warnings: string[] = [];
	for (const kind of kinds) {
		const covered = {
			chain: store.chainRange(),
			auction: store.auctionRange(),
			detail: store.detailRange(),
		}[kind];
		if (covered === null || covered.from > range.from || covered.to < range.to) {
			const has = covered ? `${covered.from}..${covered.to}` : "nothing";
			warnings.push(`WARNING    ${kind} data covers ${has}, not the whole window`);
		}
	}
	return warnings;
}

/** Gas per trade as Σgas ÷ Σtrades, in thousands. */
function perTrade(gas: number, trades: number): string {
	return trades === 0 ? "—" : `${fmt(gas / trades / 1000)}K`;
}

/** A USD total per item. */
function usdPer(usd: number, count: number, digits = 2): string {
	return count === 0 ? "—" : `$${(usd / count).toFixed(digits)}`;
}

/** A part of a total as a percentage. */
function share(part: number, total: number, digits = 0): string {
	return total > 0 ? `${((part / total) * 100).toFixed(digits)}%` : "—";
}
