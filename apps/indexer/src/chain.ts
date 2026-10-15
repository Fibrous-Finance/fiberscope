import { setTimeout as sleep } from "node:timers/promises";

import { hexBlock, word, wordAddress } from "./abi.ts";
import type { Anchor } from "./clock.ts";
import { NETWORK } from "./config.ts";
import { fmt, log } from "./log.ts";
import { backoff } from "./pacer.ts";
import { RpcError, RpcTimeout } from "./rpc.ts";
import type { Rpc, RpcCall } from "./rpc.ts";
import type { OrderTerms } from "./terms.ts";

export const SETTLEMENT = NETWORK.contracts.settlement;
export const ROUTER = NETWORK.contracts.flashLoanRouter;

/**
 * A relay calls `settle` on behalf of a solver, so the Settlement event names the relay, not the
 * solver: CoW's flash-loan router, or one of the network's Atomic Bundles.
 */
export type Relay = "router" | "bundle";

/** The addresses of the network's relays, the router first. */
export const RELAYS: readonly string[] = [ROUTER, ...NETWORK.contracts.bundles];

/** The kind of relay an address is; null when it is none. */
export function relayOf(address: string): Relay | null {
	if (address === ROUTER) return "router";
	return NETWORK.contracts.bundles.includes(address) ? "bundle" : null;
}

export const TOPIC = {
	settlement: "0x40338ce1a7c49204f0099533b1e9a7ee0a3d261f84974ab7af36105b8c4e9db4",
	trade: "0xa07a543ab8a018198e99ca0184c93fe9050a79400a0a723441f84de1d972cc17",
	interaction: "0xed99827efb37016f2275f98c4bcf71c7551c75d59e9b450f79fa32e60be672c2",
	answerUpdated: "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f",
};

export const SELECTOR = {
	isSolver: "0x02cc250d",
	aggregator: "0x245a7bfc",
	latestRoundData: "0xfeaf968c",
	symbol: "0x95d89b41",
};

/**
 * Interactions that are not DEX swaps: ERC-20 `approve` and `withdraw` (unwrap) of the wrapped
 * native token, the WETH9 interface that WBNB shares.
 */
const NOT_SWAPS: Record<string, true> = { "095ea7b3": true, "2e1a7d4d": true };

export interface Log {
	address: string;
	topics: string[];
	data: string;
	blockNumber: string;
	/** The block's timestamp, which some nodes add, ours for Base and BNB Chain among them. */
	blockTimestamp?: string;
	transactionHash: string;
	logIndex: string;
}

/** One `Settlement` event: one call to `settle`. */
export interface SettlementRow {
	tx: string;
	logIndex: number;
	block: number;
	/** The address that called `settle` (topic 1). */
	solver: string;
	/** Trade events this settlement emitted. */
	trades: number;
	/** Interaction events, excluding approvals and unwraps. */
	swaps: number;
}

export interface TradeRow {
	tx: string;
	logIndex: number;
	block: number;
	/** Log index of the `Settlement` event this trade belongs to. */
	settlementLogIndex: number;
	sellToken: string;
	buyToken: string;
	/** Sold, fee included. */
	sellAmount: string;
	buyAmount: string;
	/** The traded order's uid (56 bytes), `0x`-prefixed lowercase hex. */
	orderUid: string;
	/**
	 * The signed order's terms, read from the settle() calldata; absent when no settle() call in
	 * the calldata reproduces the trade.
	 */
	terms?: OrderTerms;
}

/**
 * The order uid in a `Trade` event's data: its dynamic `bytes` member, an offset (word 5) to the
 * length and then the bytes.
 */
export function orderUidOf(data: string): string {
	const at = Number(BigInt(`0x${word(data, 5)}`)) / 32;
	const length = Number(BigInt(`0x${word(data, at)}`));
	const start = 2 + (at + 1) * 64;
	const uid = data.slice(start, start + length * 2);
	if (uid.length !== length * 2) throw new Error(`Trade event data has no order uid: ${data}`);
	return `0x${uid}`.toLowerCase();
}

/**
 * Groups GPv2Settlement logs into settlements. `settle` emits its Trade and Interaction events
 * before its closing Settlement event, so each event belongs to the next Settlement in its tx.
 */
export function parseSettlementLogs(logs: Log[]): {
	settlements: SettlementRow[];
	trades: TradeRow[];
} {
	const byTx = new Map<string, Log[]>();
	for (const entry of logs) {
		const tx = entry.transactionHash.toLowerCase();
		const list = byTx.get(tx);
		if (list) list.push(entry);
		else byTx.set(tx, [entry]);
	}
	const settlements: SettlementRow[] = [];
	const trades: TradeRow[] = [];
	for (const [tx, entries] of byTx) {
		entries.sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
		let open: TradeRow[] = [];
		let swaps = 0;
		for (const entry of entries) {
			const logIndex = Number(entry.logIndex);
			const block = Number(entry.blockNumber);
			const topic = entry.topics[0];
			if (topic === TOPIC.trade) {
				open.push({
					tx,
					logIndex,
					block,
					settlementLogIndex: -1,
					sellToken: wordAddress(word(entry.data, 0)),
					buyToken: wordAddress(word(entry.data, 1)),
					sellAmount: BigInt(`0x${word(entry.data, 2)}`).toString(),
					buyAmount: BigInt(`0x${word(entry.data, 3)}`).toString(),
					orderUid: orderUidOf(entry.data),
				});
			} else if (topic === TOPIC.interaction) {
				if (!NOT_SWAPS[word(entry.data, 1).slice(0, 8)]) swaps++;
			} else if (topic === TOPIC.settlement) {
				for (const trade of open) trade.settlementLogIndex = logIndex;
				settlements.push({
					tx,
					logIndex,
					block,
					solver: wordAddress(entry.topics[1]),
					trades: open.length,
					swaps,
				});
				trades.push(...open);
				open = [];
				swaps = 0;
			}
		}
		if (open.length > 0) throw new Error(`tx ${tx} has Trade events after its last Settlement`);
	}
	return { settlements, trades };
}

export function ethCall(to: string, data: string, block: number | "latest"): RpcCall {
	return {
		method: "eth_call",
		params: [{ to, data }, typeof block === "number" ? hexBlock(block) : block],
	};
}

/** Times an eth_getLogs request may time out before it is halved instead of sent again. */
const LOG_TIMEOUTS = 2;
/**
 * The narrowest width that a refusal stating no limit teaches (see getLogs): the width that works
 * after halving may owe as much to the range's logs as to the endpoint's limit. An endpoint that
 * allows fewer blocks costs each later range one refusal.
 */
const LEARNED_FLOOR = 100;
/** Refusals about the width of a range, such as "Block range limit exceeded". */
const WIDTH = /\brange\b|\bblocks?\b/i;
/**
 * Refusals that count the logs a request would return rather than its blocks, such as NodeReal's
 * "logs count exceeds the limit 50000" and Infura's "query returned more than 10000 results. Try
 * with this block range […]": a narrower range suits those logs, not every range.
 */
const COUNTED = /logs? count|results/i;
/**
 * How refusals state the widest eth_getLogs range an endpoint serves: thirdweb's "Maximum allowed
 * number of requested blocks is 1000", BSC's and geth's "exceed maximum block range 5000", reth's
 * "query exceeds max block range 1000", dRPC's "ranges over 10000 blocks are not supported" and
 * QuickNode's "limited to a 10,000 range".
 */
const STATED_RANGE = [
	/(\d[\d,]*)(k?)[ -]?blocks?\b/gi,
	/\bblocks?(?: range(?: is| of)?| is| of):? (\d[\d,]*)(k?)\b/gi,
	/\blimited to an? (\d[\d,]*)(k?)\b/gi,
];

/**
 * The widest eth_getLogs range, in blocks, that a refusal says the endpoint serves; null when it
 * says none. The smallest number it states, so "5000 blocks requested, 1000 blocks allowed" reads
 * as 1,000.
 */
export function statedLogRange(message: string): number | null {
	const stated = STATED_RANGE.flatMap((pattern) => [...message.matchAll(pattern)])
		.map(
			([, digits, thousands]) => Number(digits.replaceAll(",", "")) * (thousands ? 1_000 : 1)
		)
		.filter((blocks) => blocks > 0);
	return stated.length === 0 ? null : Math.min(...stated);
}

/**
 * Fetches logs for a block range, in requests no wider than the endpoint serves (Rpc.logRange),
 * which its refusals teach for the rest of the process. A refusal that states a limit narrower
 * than the request sets it. One about the range's width that states no limit halves the request,
 * and the width that then works sets it, LEARNED_FLOOR blocks at least. Any other refusal halves
 * the request for this range only: one that states a limit the request was within, or counts
 * logs, is about the logs of a busy range, and one about anything else, such as "Resource not
 * found", tells nothing of ranges. A request that times out LOG_TIMEOUTS times is halved for
 * this range only as well.
 */
export async function getLogs(
	rpc: Rpc,
	from: number,
	to: number,
	address: string[],
	topics: string[][]
): Promise<Log[]> {
	let logs: Log[] = [];
	let width = Math.min(to - from + 1, rpc.logRange ?? Infinity);
	// Whether the next width that works sets the limit, after a refusal of the width without one.
	let learning = false;
	for (let start = from; start <= to;) {
		const end = Math.min(to, start + width - 1);
		const span = end - start + 1;
		const filter = { fromBlock: hexBlock(start), toBlock: hexBlock(end), address, topics };
		try {
			const options = span > 1 ? { timeouts: LOG_TIMEOUTS } : {};
			logs = logs.concat(await rpc.call<Log[]>("eth_getLogs", [filter], options));
		} catch (error) {
			if (span === 1 || !(error instanceof RpcError || error instanceof RpcTimeout)) {
				throw error;
			}
			const stated = error instanceof RpcError ? statedLogRange(error.message) : null;
			if (stated !== null && stated < span) {
				// Another getLogs of the same RPC may have learned a narrower width meanwhile.
				rpc.logRange = Math.min(rpc.logRange ?? stated, stated);
				width = rpc.logRange;
				learning = false;
				log(
					`eth_getLogs ${start}..${end} refused (${error.message}); asking for ` +
						`${fmt(width)} blocks at a time from now on`
				);
			} else {
				width = Math.ceil(span / 2);
				learning =
					error instanceof RpcError &&
					stated === null &&
					WIDTH.test(error.message) &&
					!COUNTED.test(error.message);
				const why =
					error instanceof RpcError
						? `refused (${error.message})`
						: `timed out ${LOG_TIMEOUTS} times`;
				log(`eth_getLogs ${start}..${end} ${why}; halving the range`);
			}
			continue;
		}
		if (learning) {
			learning = false;
			const learned = Math.max(width, LEARNED_FLOOR);
			if (learned < (rpc.logRange ?? Infinity)) {
				rpc.logRange = learned;
				log(`eth_getLogs: asking for ${fmt(learned)} blocks at a time from now on`);
			}
		}
		start = end + 1;
	}
	return logs;
}

/** Block times from the blocks' headers. */
export async function headerAnchors(rpc: Rpc, blocks: number[]): Promise<Anchor[]> {
	const outcomes = await rpc.batch(
		blocks.map((block) => ({
			method: "eth_getBlockByNumber",
			params: [hexBlock(block), false],
		}))
	);
	return outcomes.map((outcome, i) => {
		if (!outcome.ok) throw outcome.error;
		const header = outcome.result as { timestamp: string } | null;
		if (header === null) throw new Error(`the RPC node has no block ${blocks[i]}`);
		return { block: blocks[i], time: Number(header.timestamp) };
	});
}

export interface Receipt {
	blockNumber: string;
	from: string;
	/** Null only for contract creations, which never settle. */
	to: string | null;
	gasUsed: string;
	effectiveGasPrice: string;
	/** The L1 data fee in wei, on Base (OP stack); absent on some deposit transactions. */
	l1Fee?: string;
}

/** Fetches receipts, waiting briefly for any the node does not have yet. */
export async function getReceipts(rpc: Rpc, txs: string[]): Promise<Map<string, Receipt>> {
	return byHash<Receipt>(rpc, "eth_getTransactionReceipt", "receipt", txs);
}

/** Fetches the input (calldata) of transactions, waiting briefly for any the node lacks. */
export async function getInputs(rpc: Rpc, txs: string[]): Promise<Map<string, string>> {
	const found = await byHash<{ input: string }>(rpc, "eth_getTransactionByHash", "input", txs);
	return new Map([...found].map(([tx, { input }]) => [tx, input]));
}

/** Times byHash asks for the results the node lacks before it gives up. */
const HASH_ATTEMPTS = 5;

/** Fetches one result per transaction hash; the node may lag behind the logs for a moment. */
async function byHash<T>(
	rpc: Rpc,
	method: string,
	noun: string,
	txs: string[]
): Promise<Map<string, T>> {
	const found = new Map<string, T>();
	let pending = txs;
	for (let attempt = 0; pending.length > 0; attempt++) {
		if (attempt === HASH_ATTEMPTS)
			throw new Error(`no ${noun} for ${pending.length} txs, e.g. ${pending[0]}`);
		if (attempt > 0) {
			const delay = backoff(attempt);
			log(
				`rpc: no ${noun} yet for ${pending.length} txs, e.g. ${pending[0]}; asking again in ` +
					`${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1} of ${HASH_ATTEMPTS})`
			);
			await sleep(delay);
		}
		const outcomes = await rpc.batch(pending.map((tx) => ({ method, params: [tx] })));
		const missing: string[] = [];
		outcomes.forEach((outcome, i) => {
			if (!outcome.ok) throw outcome.error;
			if (outcome.result) found.set(pending[i], outcome.result as T);
			else missing.push(pending[i]);
		});
		pending = missing;
	}
	return found;
}
