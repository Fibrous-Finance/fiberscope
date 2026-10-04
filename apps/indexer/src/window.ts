import { ROUTER } from "./chain.ts";
import { timeOf } from "./config.ts";
import { auctionOutcomes, creditedBatches, TradeValuer } from "./facts.ts";
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
}

/**
 * Totals and a per-solver table for a block range, read from the database. Batches, trades,
 * volume, surplus, gas and cost count settlements inside the range; entered and won count
 * auctions that started inside it.
 */
export function windowReport(store: Store, registry: Registry, range: BlockRange): string {
	const iso = (block: number) => new Date(timeOf(block) * 1000).toISOString().replace(".000", "");
	const out = [
		`Window     blocks ${range.from}..${range.to}, ${iso(range.from)} → ${iso(range.to)}`,
	];
	for (const [label, covered] of [
		["chain", store.chainRange()],
		["auction", store.auctionRange()],
	] as const) {
		if (covered === null || covered.from > range.from || covered.to < range.to) {
			const has = covered ? `${covered.from}..${covered.to}` : "nothing";
			out.push(`WARNING    ${label} data covers ${has}, not the whole window`);
		}
	}

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
			};
			rows.set(identity.id, entry);
		}
		return entry;
	};
	let batches = 0;
	let routed = 0;
	let uncosted = 0;
	let gas = 0;
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
		cost += batch.cost ?? 0;
		if (batch.cost === null) uncosted++;
		if (batch.viaRouter) {
			routed++;
			routedRows.set(`${batch.block}:${batch.logIndex}`, entry);
		}
	}

	const valuer = new TradeValuer(store);
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
		const entry =
			trade.solver === ROUTER
				? routedRows.get(`${trade.block}:${trade.settlementLogIndex}`)!
				: rows.get(registry.identify(trade.solver).id)!;
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

	let auctions = 0;
	let solutions = 0;
	let winners = 0;
	for (const auction of auctionOutcomes(store.solutionsByStart(range), registry)) {
		auctions++;
		solutions += auction.solutions;
		winners += auction.winners.length;
		for (const { identity } of auction.entrants.values()) row(identity).entered++;
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
		`Volume     $${fmt(volume)}`,
		`Surplus    $${fmt(surplus)} over ${fmt(surplusTrades)} priced trades with order terms ` +
			`(${usdPer(surplus, surplusTrades)} per trade, ${bps} bps of their volume); ` +
			`${share(unusualSurplus, surplus)} from ${fmt(unusualTrades)} unusual trades ` +
			`(surplus over a tenth of their value)`,
		`Gas        ${fmt(gas)} (${perTrade(gas, trades)} per trade)`,
		`Cost       $${fmt(cost)} (${usdPer(cost, trades, 4)} per trade` +
			`${uncosted > 0 ? `; ${fmt(uncosted)} batches without an ETH/USD rate` : ""})`,
		`Solvers    ${fmt(settling)} with batches, ${fmt(sorted.length)} with batches or solutions`,
		`Auctions   ${fmt(auctions)} started in the window, ${fmt(solutions)} solutions, ` +
			`${(winners / Math.max(1, auctions)).toFixed(2)} winners per auction`,
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

/** Gas per trade as Σgas ÷ Σtrades, in thousands. */
function perTrade(gas: number, trades: number): string {
	return trades === 0 ? "—" : `${fmt(gas / trades / 1000)}K`;
}

/** A USD total per item. */
function usdPer(usd: number, count: number, digits = 2): string {
	return count === 0 ? "—" : `$${(usd / count).toFixed(digits)}`;
}

/** A part of a total as a whole percentage. */
function share(part: number, total: number): string {
	return total > 0 ? `${((part / total) * 100).toFixed(0)}%` : "—";
}
