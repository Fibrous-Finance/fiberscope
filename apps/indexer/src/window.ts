import { timeOf } from "./config.ts";
import { auctionOutcomes, loadBatches, TradeValuer } from "./facts.ts";
import { fmt, shortAddress } from "./log.ts";
import type { Registry, SolverIdentity } from "./registry.ts";
import type { BlockRange } from "./rules.ts";
import type { Store } from "./store.ts";

interface Row {
	identity: SolverIdentity;
	batches: number;
	trades: number;
	gas: number;
	volume: number;
	entered: number;
	won: number;
}

/**
 * Totals and a per-solver table for a block range, read from the database. Batches, trades,
 * volume and gas count settlements inside the range; entered and won count auctions that
 * started inside it.
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
			entry = { identity, batches: 0, trades: 0, gas: 0, volume: 0, entered: 0, won: 0 };
			rows.set(identity.id, entry);
		}
		return entry;
	};
	const batches = loadBatches(store, registry, range);
	const credited = new Map<string, Row>();
	for (const batch of batches) {
		const entry = row(batch.solver);
		entry.batches++;
		entry.trades += batch.trades;
		entry.gas += batch.gas;
		credited.set(`${batch.tx}:${batch.logIndex}`, entry);
	}

	const valuer = new TradeValuer(store);
	let trades = 0;
	let unpriced = 0;
	let oneSided = 0;
	let volume = 0;
	for (const trade of store.tradeRows(range)) {
		const { usd, pricedSides } = valuer.value(trade);
		trades++;
		if (usd === null) {
			unpriced++;
			continue;
		}
		if (pricedSides === 1) oneSided++;
		volume += usd;
		credited.get(`${trade.tx}:${trade.settlementLogIndex}`)!.volume += usd;
	}

	const auctions = auctionOutcomes(store.solutionsByStart(range), registry);
	let solutions = 0;
	let winners = 0;
	for (const auction of auctions) {
		solutions += auction.solutions;
		winners += auction.winners.length;
		for (const { identity } of auction.entrants.values()) row(identity).entered++;
		for (const winner of auction.winners) rows.get(winner.solver)!.won++;
	}

	const sorted = [...rows.values()].sort(
		(a, b) => b.batches - a.batches || b.entered - a.entered
	);
	const gas = batches.reduce((total, batch) => total + batch.gas, 0);
	const routed = batches.filter((batch) => batch.viaRouter).length;
	const settling = sorted.filter((entry) => entry.batches > 0).length;
	out.push(
		`Batches    ${fmt(batches.length)} (${fmt(routed)} via the flash-loan router; ` +
			`${fmt(store.zeroTradeSettlements(range))} zero-trade settlements excluded)`,
		`Trades     ${fmt(trades)} (${fmt(trades - unpriced - oneSided)} priced on both sides, ` +
			`${fmt(oneSided)} on one side, ${fmt(unpriced)} unpriced)`,
		`Volume     $${fmt(volume)}`,
		`Gas        ${fmt(gas)} (${perTrade(gas, trades)} per trade)`,
		`Solvers    ${fmt(settling)} with batches, ${fmt(sorted.length)} with batches or solutions`,
		`Auctions   ${fmt(auctions.length)} started in the window, ${fmt(solutions)} solutions, ` +
			`${(winners / Math.max(1, auctions.length)).toFixed(2)} winners per auction`,
		""
	);

	const table = [
		["Solver", "Id", "Batches", "Trades", "Volume $", "Gas/trade", "Entered", "Won"],
		...sorted.map((entry) => [
			entry.identity.name ?? shortAddress(entry.identity.id),
			entry.identity.name === null ? "" : entry.identity.id,
			fmt(entry.batches),
			fmt(entry.trades),
			fmt(entry.volume),
			perTrade(entry.gas, entry.trades),
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
