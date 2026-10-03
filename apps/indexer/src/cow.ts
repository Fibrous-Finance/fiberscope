import { setTimeout as sleep } from "node:timers/promises";

import { backoff, describeError, Pacer, retryAfterMs } from "./pacer.ts";

interface Solution {
	/** Submission address, lowercase. */
	solver: string;
	score: string;
	ranking: number;
	winner: boolean;
	filteredOut: boolean;
	/** The settlement this solution produced; winners only, null when it never settled. */
	tx: string | null;
}

export interface Competition {
	auctionId: number;
	startBlock: number;
	deadlineBlock: number;
	/** Settlement transactions of this auction, lowercase. */
	txHashes: string[];
	/** Native prices by lowercase token address, in wei per token atom scaled by 1e18. */
	prices: Map<string, string>;
	solutions: Solution[];
}

const ATTEMPTS = 10;
const TIMEOUT_MS = 60_000;

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
		const json = await this.#get(`/api/v2/solver_competition/by_tx_hash/${tx}`);
		return json === null ? null : parseCompetition(json);
	}

	async #get(path: string): Promise<unknown> {
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
					signal: AbortSignal.timeout(TIMEOUT_MS),
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
			if (status !== 429 && status < 500) throw new Error(`GET ${path}: HTTP ${status}`);
			problem = `HTTP ${status}`;
		}
		throw new Error(`GET ${path} failed ${ATTEMPTS} times: ${problem}`);
	}
}

interface RawCompetition {
	auctionId: number;
	auctionStartBlock: number;
	auctionDeadlineBlock: number;
	transactionHashes?: string[];
	auction?: { prices?: Record<string, string> };
	solutions?: {
		solverAddress: string;
		score: string;
		ranking: number;
		isWinner: boolean;
		filteredOut?: boolean;
		txHash?: string | null;
	}[];
}

/** Keeps what the indexer uses from a competition; `auction.orders` (most of the bytes) is dropped. */
function parseCompetition(json: unknown): Competition {
	const raw = json as RawCompetition;
	if (!Number.isInteger(raw.auctionId) || !Number.isInteger(raw.auctionStartBlock)) {
		throw new Error(`unexpected competition: ${JSON.stringify(json).slice(0, 200)}`);
	}
	return {
		auctionId: raw.auctionId,
		startBlock: raw.auctionStartBlock,
		deadlineBlock: raw.auctionDeadlineBlock,
		txHashes: (raw.transactionHashes ?? []).map((tx) => tx.toLowerCase()),
		prices: new Map(
			Object.entries(raw.auction?.prices ?? {}).map(([token, price]) => [
				token.toLowerCase(),
				price,
			])
		),
		solutions: (raw.solutions ?? []).map((solution) => ({
			solver: solution.solverAddress.toLowerCase(),
			score: solution.score,
			ranking: solution.ranking,
			winner: solution.isWinner,
			filteredOut: solution.filteredOut === true,
			tx: solution.txHash ? solution.txHash.toLowerCase() : null,
		})),
	};
}
