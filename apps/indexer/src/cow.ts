import { setTimeout as sleep } from "node:timers/promises";

import { isInteger, isOptionalString, isRecord, isStringArray, isStringRecord } from "./guards.ts";
import { backoff, describeError, Pacer, retryAfterMs } from "./pacer.ts";

export interface Solution {
	/** Submission address, lowercase. */
	solver: string;
	ranking: number;
	winner: boolean;
	/** The settlement this solution produced; winners only, null when it never settled. */
	tx: string | null;
	/** Its score (CIP-20), in wei of the native token; null when the API gives none. */
	score: string | null;
	/**
	 * A winner's reference score (CIP-67): the best score of the auction without its solver. Null
	 * for the other solutions.
	 */
	referenceScore: string | null;
	/** Whether CIP-67's fairness filter removed it from the auction. */
	filteredOut: boolean;
}

export interface Competition {
	auctionId: number;
	startBlock: number;
	/** Settlement transactions of this auction, lowercase. */
	txHashes: string[];
	/** Native prices by lowercase token address, in wei per token atom scaled by 1e18. */
	prices: Map<string, string>;
	/** In the API's order. */
	solutions: Solution[];
}

/** A signed order as CoW's order book holds it; addresses lowercase. */
export interface BookOrder {
	sellToken: string;
	buyToken: string;
	sellAmount: string;
	buyAmount: string;
	/** The signed fee, in sell-token atoms. */
	feeAmount: string;
	kind: "sell" | "buy";
	partiallyFillable: boolean;
}

/** How a protocol fee is computed: on surplus, on improvement over the quote, or on volume. */
export type FeePolicy = "surplus" | "priceImprovement" | "volume";

/** The quote an order was placed with. */
export interface OrderQuote {
	/** The submission address of the solver that gave the quote, lowercase. */
	solver: string;
	/** Whether CoW verified the quote by simulating it. */
	verified: boolean;
	sellAmount: string;
	buyAmount: string;
	/** The network fee the quote estimated, in sell-token atoms. */
	feeAmount: string;
}

/** What the indexer keeps of an order in CoW's order book. */
export interface OrderDetail {
	kind: "sell" | "buy";
	/** Its app data's `orderClass` (market, limit, liquidity, twap…); null when absent. */
	appClass: string | null;
	/**
	 * The policies of the partner fees its app data asks for, in order; CoW applies them after its
	 * own fees (see partnerFeePolicies).
	 */
	partnerFees: FeePolicy[];
	/** Null when the order was placed without a quote. */
	quote: OrderQuote | null;
}

/** A protocol fee CoW charged on a trade, under one fee policy. */
export interface ExecutedFee {
	policy: FeePolicy;
	factor: number;
	/** The policy's cap as a share of volume; null for a volume fee. */
	maxVolumeFactor: number | null;
	/** Token atoms. */
	amount: string;
	/** Lowercase. */
	token: string;
}

/** One trade of an order, with the protocol fees charged on it in the order CoW applied them. */
export interface OrderTrade {
	block: number;
	logIndex: number;
	fees: ExecutedFee[];
}

const ATTEMPTS = 10;
const TIMEOUT_MS = 60_000;
/** Trades per page of `/api/v2/trades`, the API's maximum. */
const TRADES_PAGE = 1_000;

/** A polite client for CoW's solver-competition API: paced, and backing off when told to. */
export class CowApi {
	readonly root: string;
	readonly stats = { retries: 0, bytes: 0 };
	#pacer: Pacer;

	/** `root` is the network's API root, such as https://api.cow.fi/base. */
	constructor(root: string, maxRequestsPerSecond: number) {
		this.root = root;
		this.#pacer = new Pacer(maxRequestsPerSecond);
	}

	/** The competition a settlement transaction belongs to; null when the API has none. */
	async competitionByTx(tx: string): Promise<Competition | null> {
		const json = await this.#request(`/api/v2/solver_competition/by_tx_hash/${tx}`);
		return json === null ? null : parseCompetition(json);
	}

	/** An auction's competition; null when the API has none. */
	async competition(auctionId: number): Promise<Competition | null> {
		const json = await this.#request(`/api/v2/solver_competition/${auctionId}`);
		return json === null ? null : parseCompetition(json);
	}

	/** An order from CoW's order book, by its uid; null when the API has none. */
	async order(uid: string): Promise<BookOrder | null> {
		const json = await this.#request(`/api/v1/orders/${uid}`);
		if (json === null) return null;
		if (!isRecord(json)) throw unexpected(`order ${uid}`, json);
		const { sellToken, buyToken, sellAmount, buyAmount, feeAmount, kind, partiallyFillable } =
			json;
		if (
			typeof sellToken !== "string" ||
			typeof buyToken !== "string" ||
			typeof sellAmount !== "string" ||
			typeof buyAmount !== "string" ||
			typeof feeAmount !== "string" ||
			(kind !== "sell" && kind !== "buy") ||
			typeof partiallyFillable !== "boolean"
		) {
			throw unexpected(`order ${uid}`, json);
		}
		return {
			sellToken: sellToken.toLowerCase(),
			buyToken: buyToken.toLowerCase(),
			sellAmount,
			buyAmount,
			feeAmount,
			kind,
			partiallyFillable,
		};
	}

	/**
	 * Up to 128 orders from CoW's order book in one request, by lowercase uid. An order the book
	 * lacks, such as a solver's just-in-time order, is absent from the result.
	 */
	async orders(uids: string[]): Promise<Map<string, OrderDetail>> {
		const json = await this.#request("/api/v1/orders/by_uids", uids);
		if (!Array.isArray(json)) throw unexpected("orders response", json);
		const orders = new Map<string, OrderDetail>();
		for (const entry of json) {
			if (!isRecord(entry)) throw unexpected("orders entry", entry);
			// An order the API could not convert comes back as an error; it counts as absent.
			if (entry.order === undefined) continue;
			const { order } = entry;
			if (!isRecord(order) || typeof order.uid !== "string") throw unexpected("order", entry);
			orders.set(order.uid.toLowerCase(), parseOrderDetail(order));
		}
		return orders;
	}

	/** Every trade of an order with its protocol fees; empty when the API has none. */
	async trades(uid: string): Promise<OrderTrade[]> {
		const trades: OrderTrade[] = [];
		for (let offset = 0; ; offset += TRADES_PAGE) {
			const json = await this.#request(
				`/api/v2/trades?orderUid=${uid}&offset=${offset}&limit=${TRADES_PAGE}`
			);
			if (json === null) return trades;
			if (!Array.isArray(json)) throw unexpected(`trades of ${uid}`, json);
			trades.push(...json.map(parseOrderTrade));
			if (json.length < TRADES_PAGE) return trades;
		}
	}

	/** GETs `path`, or POSTs `body` to it as JSON; null for a 404. */
	async #request(path: string, body?: unknown): Promise<unknown> {
		const method = body === undefined ? "GET" : "POST";
		let problem = "";
		for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
			if (attempt > 0) {
				this.stats.retries++;
				await sleep(backoff(attempt, 60_000));
			}
			await this.#pacer.take();
			let status: number;
			try {
				const response = await fetch(this.root + path, {
					method,
					signal: AbortSignal.timeout(TIMEOUT_MS),
					...(body === undefined
						? {}
						: {
								headers: { "content-type": "application/json" },
								body: JSON.stringify(body),
							}),
				});
				status = response.status;
				if (response.ok) {
					const text = await response.text();
					this.stats.bytes += text.length;
					return JSON.parse(text);
				}
				await response.body?.cancel();
				if (status === 429) {
					this.#pacer.throttle(
						retryAfterMs(response.headers.get("retry-after")) ?? 5_000
					);
				}
			} catch (error) {
				problem = describeError(error);
				continue;
			}
			if (status === 404) return null;
			if (status !== 429 && status < 500)
				throw new Error(`${method} ${path}: HTTP ${status}`);
			problem = `HTTP ${status}`;
		}
		throw new Error(`${method} ${path} failed ${ATTEMPTS} times: ${problem}`);
	}
}

/** Keeps what the indexer uses from a competition; `auction.orders` (most of the bytes) is dropped. */
export function parseCompetition(json: unknown): Competition {
	if (!isRecord(json)) throw unexpected("competition", json);
	const { auctionId, auctionStartBlock, transactionHashes = [], auction, solutions = [] } = json;
	const prices = isRecord(auction) && auction.prices !== undefined ? auction.prices : {};
	if (
		!isInteger(auctionId) ||
		!isInteger(auctionStartBlock) ||
		!isStringArray(transactionHashes) ||
		!isStringRecord(prices) ||
		!Array.isArray(solutions)
	) {
		throw unexpected("competition", json);
	}
	return {
		auctionId,
		startBlock: auctionStartBlock,
		txHashes: transactionHashes.map((tx) => tx.toLowerCase()),
		prices: new Map(
			Object.entries(prices).map(([token, price]) => [token.toLowerCase(), price])
		),
		solutions: solutions.map(parseSolution),
	};
}

function parseSolution(json: unknown): Solution {
	if (!isRecord(json)) throw unexpected("solution", json);
	const { solverAddress, ranking, isWinner, txHash, score, referenceScore, filteredOut } = json;
	if (
		typeof solverAddress !== "string" ||
		typeof ranking !== "number" ||
		typeof isWinner !== "boolean" ||
		!isOptionalString(txHash) ||
		!isOptionalString(score) ||
		!isOptionalString(referenceScore) ||
		(filteredOut !== undefined && typeof filteredOut !== "boolean")
	) {
		throw unexpected("solution", json);
	}
	return {
		solver: solverAddress.toLowerCase(),
		ranking,
		winner: isWinner,
		tx: txHash ? txHash.toLowerCase() : null,
		score: score ?? null,
		referenceScore: referenceScore ?? null,
		filteredOut: filteredOut === true,
	};
}

/** The parts of an order of `/api/v1/orders` the indexer keeps (see OrderDetail). */
export function parseOrderDetail(json: unknown): OrderDetail {
	if (!isRecord(json)) throw unexpected("order", json);
	const { kind, fullAppData, quote } = json;
	if ((kind !== "sell" && kind !== "buy") || !isOptionalString(fullAppData)) {
		throw unexpected("order", json);
	}
	return { kind, ...readAppData(fullAppData ?? null), quote: parseQuote(quote, json) };
}

function parseQuote(quote: unknown, order: unknown): OrderQuote | null {
	if (quote === undefined || quote === null) return null;
	if (!isRecord(quote)) throw unexpected("order", order);
	const { solver, verified, sellAmount, buyAmount, feeAmount } = quote;
	if (
		typeof solver !== "string" ||
		typeof verified !== "boolean" ||
		typeof sellAmount !== "string" ||
		typeof buyAmount !== "string" ||
		typeof feeAmount !== "string"
	) {
		throw unexpected("order", order);
	}
	return { solver: solver.toLowerCase(), verified, sellAmount, buyAmount, feeAmount };
}

/** What the indexer reads of a full app data document; nothing when it is absent or not JSON. */
function readAppData(text: string | null): { appClass: string | null; partnerFees: FeePolicy[] } {
	let document: unknown = null;
	try {
		if (text !== null) document = JSON.parse(text);
	} catch {
		// Malformed app data carries nothing CoW would act on.
	}
	const metadata = isRecord(document) ? document.metadata : undefined;
	if (!isRecord(metadata)) return { appClass: null, partnerFees: [] };
	const { orderClass, partnerFee } = metadata;
	const appClass = isRecord(orderClass) ? orderClass.orderClass : undefined;
	return {
		appClass: typeof appClass === "string" ? appClass : null,
		partnerFees: partnerFeePolicies(partnerFee),
	};
}

/**
 * The policies of the partner fees in an app data's `metadata.partnerFee`, read the way CoW's
 * services read them: one fee object or an array of them, each with a recipient and either
 * `volumeBps` (or the older `bps`), `surplusBps` with `maxVolumeBps`, or `priceImprovementBps`
 * with `maxVolumeBps`. Any malformed entry makes CoW drop the app data's partner fees, so it
 * yields none.
 */
export function partnerFeePolicies(partnerFee: unknown): FeePolicy[] {
	if (partnerFee === undefined || partnerFee === null) return [];
	const entries: unknown[] = Array.isArray(partnerFee) ? partnerFee : [partnerFee];
	const policies: FeePolicy[] = [];
	for (const entry of entries) {
		const policy = partnerFeePolicy(entry);
		if (policy === null) return [];
		policies.push(policy);
	}
	return policies;
}

function partnerFeePolicy(entry: unknown): FeePolicy | null {
	if (!isRecord(entry)) return null;
	const { recipient } = entry;
	if (typeof recipient !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) return null;
	const present = new Set<string>();
	for (const key of ["surplusBps", "priceImprovementBps", "maxVolumeBps", "volumeBps", "bps"]) {
		const value = entry[key];
		if (value === undefined || value === null) continue;
		if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
		present.add(key);
	}
	const exactly = (...keys: string[]) =>
		present.size === keys.length && keys.every((key) => present.has(key));
	if (exactly("surplusBps", "maxVolumeBps")) return "surplus";
	if (exactly("priceImprovementBps", "maxVolumeBps")) return "priceImprovement";
	if (exactly("volumeBps") || exactly("bps")) return "volume";
	return null;
}

/** A trade of `/api/v2/trades` with its executed protocol fees. */
export function parseOrderTrade(json: unknown): OrderTrade {
	if (!isRecord(json)) throw unexpected("trade", json);
	const { blockNumber, logIndex, executedProtocolFees = [] } = json;
	if (!isInteger(blockNumber) || !isInteger(logIndex) || !Array.isArray(executedProtocolFees)) {
		throw unexpected("trade", json);
	}
	return { block: blockNumber, logIndex, fees: executedProtocolFees.map(parseExecutedFee) };
}

function parseExecutedFee(json: unknown): ExecutedFee {
	if (!isRecord(json) || !isRecord(json.policy)) throw unexpected("protocol fee", json);
	const { amount, token } = json;
	const policies = Object.entries(json.policy);
	if (policies.length !== 1 || typeof amount !== "string" || typeof token !== "string") {
		throw unexpected("protocol fee", json);
	}
	const [[policy, terms]] = policies;
	const factor = isRecord(terms) ? terms.factor : undefined;
	const cap = isRecord(terms) ? terms.maxVolumeFactor : undefined;
	if (
		!isFeePolicy(policy) ||
		typeof factor !== "number" ||
		(policy !== "volume" && typeof cap !== "number")
	) {
		throw unexpected("protocol fee", json);
	}
	return {
		policy,
		factor,
		maxVolumeFactor: policy !== "volume" && typeof cap === "number" ? cap : null,
		amount,
		token: token.toLowerCase(),
	};
}

function isFeePolicy(value: string): value is FeePolicy {
	return value === "surplus" || value === "priceImprovement" || value === "volume";
}

function unexpected(what: string, json: unknown): Error {
	return new Error(`unexpected ${what}: ${JSON.stringify(json).slice(0, 200)}`);
}
