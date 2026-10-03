import { setTimeout as sleep } from "node:timers/promises";

import { hexBlock, word, wordAddress } from "./abi.ts";
import { NETWORK } from "./config.ts";
import { log } from "./log.ts";
import { backoff } from "./pacer.ts";
import { RpcError } from "./rpc.ts";
import type { Rpc, RpcCall } from "./rpc.ts";
import type { OrderTerms } from "./terms.ts";

export const SETTLEMENT = NETWORK.contracts.settlement;
export const ROUTER = NETWORK.contracts.flashLoanRouter;

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

/** Interactions that are not DEX swaps: ERC-20 `approve` and WETH `withdraw` (unwrap). */
const NOT_SWAPS: Record<string, true> = { "095ea7b3": true, "2e1a7d4d": true };

export interface Log {
	address: string;
	topics: string[];
	data: string;
	blockNumber: string;
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
	/** Interaction events, excluding approvals and WETH unwraps. */
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
	/**
	 * The signed order's terms, read from the settle() calldata; absent when no settle() call in
	 * the calldata reproduces the trade.
	 */
	terms?: OrderTerms;
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

/** Fetches logs for a block range, halving the range when the node refuses it. */
export async function getLogs(
	rpc: Rpc,
	from: number,
	to: number,
	address: string[],
	topics: string[][]
): Promise<Log[]> {
	try {
		const filter = { fromBlock: hexBlock(from), toBlock: hexBlock(to), address, topics };
		return await rpc.call<Log[]>("eth_getLogs", [filter]);
	} catch (error) {
		if (!(error instanceof RpcError) || from === to) throw error;
		const mid = Math.floor((from + to) / 2);
		log(`eth_getLogs ${from}..${to} refused (${error.message}); splitting the range`);
		const low = await getLogs(rpc, from, mid, address, topics);
		return low.concat(await getLogs(rpc, mid + 1, to, address, topics));
	}
}

export interface Receipt {
	transactionHash: string;
	blockNumber: string;
	from: string;
	/** Null only for contract creations, which never settle. */
	to: string | null;
	status: string;
	gasUsed: string;
	effectiveGasPrice: string;
	/** OP-stack L1 data fee in wei; absent on some deposit transactions. */
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
		if (attempt === 5)
			throw new Error(`no ${noun} for ${pending.length} txs, e.g. ${pending[0]}`);
		if (attempt > 0) await sleep(backoff(attempt));
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
