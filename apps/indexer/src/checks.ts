import { word } from "./abi.ts";
import {
	getInputs,
	getLogs,
	orderUidOf,
	parseSettlementLogs,
	relayOf,
	SETTLEMENT,
	TOPIC,
} from "./chain.ts";
import type { Log, Relay } from "./chain.ts";
import type { CowApi } from "./cow.ts";
import { creditedBatches } from "./facts.ts";
import { fmt } from "./log.ts";
import type { Registry } from "./registry.ts";
import type { Rpc } from "./rpc.ts";
import type { BlockRange, CreditSource } from "./rules.ts";
import type { Store, TermRow } from "./store.ts";
import { readSignedTrades } from "./terms.ts";
import { coverageWarnings, windowLine } from "./window.ts";

/**
 * The checks behind the Validation section of docs/methodology.md, for a block range: anyone with
 * a database can rerun them.
 */

/** Disagreements printed in full; any beyond are counted. */
const LISTED = 20;

/** Relay batches of one kind: how their address was chosen, and how many match CoW's winner. */
interface RelayTally {
	batches: number;
	bySource: Record<CreditSource, number>;
	withWinner: number;
	matched: number;
}

/**
 * Attribution against CoW's competition data, from the database alone: every batch should be
 * credited to the solver address of the winning solution that settled its transaction. Relay
 * batches, the flash-loan router's and the Atomic Bundles', are broken down by how their address
 * was chosen; one credited to CoW's winner matches it by construction, so the check is
 * independent of the competition data only for the others.
 */
export function attributionReport(store: Store, registry: Registry, range: BlockRange): string {
	const out = [windowLine(store, range), ...coverageWarnings(store, range, ["chain", "auction"])];
	let batches = 0;
	let withWinner = 0;
	let matched = 0;
	let unchecked = 0;
	let noCompetition = 0;
	let noWinner = 0;
	const relayed: Record<Relay, RelayTally> = {
		router: {
			batches: 0,
			bySource: { event: 0, recipient: 0, sender: 0, winner: 0, unverified: 0 },
			withWinner: 0,
			matched: 0,
		},
		bundle: {
			batches: 0,
			bySource: { event: 0, recipient: 0, sender: 0, winner: 0, unverified: 0 },
			withWinner: 0,
			matched: 0,
		},
	};
	const mismatches: string[] = [];
	for (const batch of creditedBatches(store, registry, range)) {
		batches++;
		const relay = batch.relay === null ? null : relayed[batch.relay];
		if (relay !== null) {
			relay.batches++;
			relay.bySource[batch.credit]++;
		}
		const winner = store.apiWinner(batch.tx);
		if (winner === null) {
			const link = store.competitionLink(batch.tx);
			if (link === null) unchecked++;
			else if (link.auctionId === null) noCompetition++;
			else noWinner++;
			continue;
		}
		withWinner++;
		if (relay !== null) relay.withWinner++;
		if (batch.address === winner) {
			matched++;
			if (relay !== null) relay.matched++;
		} else {
			mismatches.push(
				`  ${batch.tx} log ${batch.logIndex}: credited ${batch.address} (${batch.credit}), ` +
					`winner ${winner}`
			);
		}
	}
	out.push(
		`Batches    ${fmt(batches)}; ${fmt(withWinner)} with a winning solution for their transaction ` +
			`in CoW's competition data (without one: ${fmt(unchecked)} never looked up, ` +
			`${fmt(noCompetition)} without a competition, ${fmt(noWinner)} in a competition with no ` +
			`winning solution for that transaction)`,
		`Credited   ${fmt(matched)} of ${fmt(withWinner)} to that solution's solver address`,
		relayLine("Router", "the flash-loan router", relayed.router),
		relayLine("Bundles", "Atomic Bundles", relayed.bundle),
		...listed("Mismatches", mismatches),
		""
	);
	return out.join("\n");
}

/** A kind of relay's line in the attribution report. */
function relayLine(label: string, via: string, tally: RelayTally): string {
	const head = `${label.padEnd(10)} ${fmt(tally.batches)} via ${via}`;
	if (tally.batches === 0) return head;
	const { recipient, sender, winner, unverified } = tally.bySource;
	return (
		`${head}: ${fmt(recipient)} credited to the transaction's recipient, ` +
		`${fmt(sender)} to its sender, ${fmt(winner)} to CoW's winner, ` +
		`${fmt(unverified)} to the unverified sender; ${fmt(tally.matched)} of ` +
		`${fmt(tally.withWinner)} match the winner`
	);
}

/** How a settlement's calldata reached the settlement contract, by the transaction's recipient. */
type Route =
	"direct call" | "flash-loan router" | "Atomic Bundle" | "solver contract" | "recipient unknown";

/**
 * Order terms against the trades and CoW's order book. From the database: the share of trades
 * whose terms were read from settle() calldata, by route. Then for a sample spread evenly over
 * the range, the same number from each route: the transaction is read again from the RPC and
 * decoded again, the decoded fee is compared with the Trade event's `feeAmount`, and the signed
 * order with the one CoW's order book holds under the Trade event's order uid.
 */
export async function termsReport(
	store: Store,
	rpc: Rpc,
	cow: CowApi,
	range: BlockRange,
	sampleSize: number
): Promise<string> {
	const out = [windowLine(store, range), ...coverageWarnings(store, range, ["chain"])];
	const routes = new Map<Route, { trades: number; read: TermRow[] }>();
	let trades = 0;
	let read = 0;
	for (const row of store.termRows(range)) {
		const relay = row.recipient === null ? null : relayOf(row.recipient);
		const route: Route =
			row.recipient === null
				? "recipient unknown"
				: row.recipient === SETTLEMENT
					? "direct call"
					: relay === "router"
						? "flash-loan router"
						: relay === "bundle"
							? "Atomic Bundle"
							: "solver contract";
		let entry = routes.get(route);
		if (!entry) {
			entry = { trades: 0, read: [] };
			routes.set(route, entry);
		}
		trades++;
		entry.trades++;
		if (row.limitSellAmount === null) continue;
		read++;
		entry.read.push(row);
	}
	out.push(
		`Trades     ${fmt(trades)}; ${fmt(read)} with order terms read from settle() calldata`,
		...[...routes].map(
			([route, entry]) =>
				`  ${route.padEnd(18)} ${fmt(entry.read.length)} of ${fmt(entry.trades)}`
		)
	);

	const routesRead = [...routes.values()].filter((entry) => entry.read.length > 0);
	const perRoute = Math.ceil(sampleSize / Math.max(1, routesRead.length));
	const sample: TermRow[] = [];
	for (const { read: rows } of routesRead) {
		const count = Math.min(perRoute, rows.length);
		for (let i = 0; i < count; i++)
			sample.push(rows[Math.floor(((i + 0.5) * rows.length) / count)]);
	}
	const txs = [...new Set(sample.map((row) => row.tx))];
	const inputs = await getInputs(rpc, txs);
	const logs = new Map<string, Log[]>();
	for (const block of new Set(sample.map((row) => row.block))) {
		const entries = await getLogs(
			rpc,
			block,
			block,
			[SETTLEMENT],
			[[TOPIC.settlement, TOPIC.trade, TOPIC.interaction]]
		);
		for (const entry of entries) {
			const tx = entry.transactionHash.toLowerCase();
			const list = logs.get(tx);
			if (list) list.push(entry);
			else logs.set(tx, [entry]);
		}
	}

	let decodedAsStored = 0;
	let feeAsEvent = 0;
	let inBook = 0;
	let bookAgrees = 0;
	const disagreements: string[] = [];
	for (const row of sample) {
		const txLogs = logs.get(row.tx) ?? [];
		const event = txLogs.find(
			(entry) => Number(entry.logIndex) === row.logIndex && entry.topics[0] === TOPIC.trade
		);
		const at = `  ${row.tx} log ${row.logIndex}`;
		if (event === undefined) {
			disagreements.push(`${at}: no Trade event at this log index`);
			continue;
		}
		const decoded = readSignedTrades(
			inputs.get(row.tx)!,
			parseSettlementLogs(txLogs).trades
		).get(row.logIndex);
		if (decoded === undefined) {
			disagreements.push(`${at}: no settle() call in the calldata reproduces it`);
			continue;
		}
		const { terms, signed } = decoded;
		if (
			terms.limitSellAmount === row.limitSellAmount &&
			terms.limitBuyAmount === row.limitBuyAmount &&
			terms.feeAmount === row.feeAmount
		) {
			decodedAsStored++;
		} else {
			disagreements.push(`${at}: decoded ${JSON.stringify(terms)}, stored differently`);
		}
		const eventFee = BigInt(`0x${word(event.data, 4)}`).toString();
		if (terms.feeAmount === eventFee) feeAsEvent++;
		else disagreements.push(`${at}: decoded fee ${terms.feeAmount}, Trade event ${eventFee}`);

		const uid = orderUidOf(event.data);
		const order = await cow.order(uid);
		if (order === null) continue;
		inBook++;
		const differences = Object.entries({
			sellToken: [order.sellToken, row.sellToken],
			buyToken: [order.buyToken, row.buyToken],
			sellAmount: [order.sellAmount, signed.sellAmount.toString()],
			buyAmount: [order.buyAmount, signed.buyAmount.toString()],
			kind: [order.kind, (signed.flags & 1n) === 0n ? "sell" : "buy"],
			partiallyFillable: [order.partiallyFillable, (signed.flags & 2n) !== 0n],
			feeAmount: [order.feeAmount, signed.feeAmount.toString()],
		}).filter(([, [book, decodedValue]]) => book !== decodedValue);
		if (differences.length === 0) bookAgrees++;
		else {
			disagreements.push(
				`${at} (order ${uid}): ` +
					differences
						.map(
							([field, [book, decodedValue]]) =>
								`${field} ${decodedValue}, order book ${book}`
						)
						.join("; ")
			);
		}
	}
	out.push(
		`Sample     ${fmt(sample.length)} trades with terms, up to ${fmt(perRoute)} per route, ` +
			`read again from the RPC and CoW's order book`,
		`  ${fmt(decodedAsStored)} of ${fmt(sample.length)} decoded again as stored`,
		`  ${fmt(feeAsEvent)} of ${fmt(sample.length)} with the fee of their Trade event`,
		`  ${fmt(bookAgrees)} of ${fmt(inBook)} found in CoW's order book agree with it: tokens, ` +
			`limits, kind, partial fill and signed fee (${fmt(sample.length - inBook)} not found)`,
		...listed("Disagree", disagreements),
		""
	);
	return out.join("\n");
}

/** A heading with the first LISTED lines under it, or "none". */
function listed(label: string, lines: string[]): string[] {
	if (lines.length === 0) return [`${label.padEnd(10)} none`];
	const more = lines.length - LISTED;
	return [
		`${label.padEnd(10)} ${fmt(lines.length)}`,
		...lines.slice(0, LISTED),
		...(more > 0 ? [`  … ${fmt(more)} more`] : []),
	];
}
