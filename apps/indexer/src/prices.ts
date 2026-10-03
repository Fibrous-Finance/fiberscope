import { int256, word, wordAddress } from "./abi.ts";
import { ethCall, SELECTOR, TOPIC } from "./chain.ts";
import type { Log } from "./chain.ts";
import { NETWORK } from "./config.ts";
import type { Rpc } from "./rpc.ts";
import type { BlockRange } from "./rules.ts";

const FEED = NETWORK.contracts.ethUsdFeed;

/** A Chainlink ETH/USD answer (8 decimals) that holds from `block` until the next point. */
export interface PricePoint {
	block: number;
	answer: number;
}

/** A block range served by one Chainlink aggregator behind the ETH/USD proxy. */
export interface FeedSegment {
	from: number;
	to: number;
	aggregator: string;
	/** The proxy's answer at `from`, so the segment starts with a known price. */
	seed: number;
}

/**
 * Splits a block range by the aggregator the proxy pointed at, finding each switch by bisection.
 * The aggregator is read at both ends; a switch away and back within one range is not expected.
 */
export async function feedSegments(rpc: Rpc, from: number, to: number): Promise<FeedSegment[]> {
	const [first, last, round] = await rpc.batch([
		ethCall(FEED, SELECTOR.aggregator, from),
		ethCall(FEED, SELECTOR.aggregator, to),
		ethCall(FEED, SELECTOR.latestRoundData, from),
	]);
	if (!first.ok) throw first.error;
	if (!last.ok) throw last.error;
	if (!round.ok) throw round.error;
	const aggregator = wordAddress(first.result as string);
	const seed = Number(int256(word(round.result as string, 1)));
	if (wordAddress(last.result as string) === aggregator) return [{ from, to, aggregator, seed }];
	let same = from;
	let switched = to;
	while (switched - same > 1) {
		const mid = Math.floor((same + switched) / 2);
		const at = await rpc.call<string>(
			"eth_call",
			ethCall(FEED, SELECTOR.aggregator, mid).params
		);
		if (wordAddress(at) === aggregator) same = mid;
		else switched = mid;
	}
	return [{ from, to: same, aggregator, seed }, ...(await feedSegments(rpc, switched, to))];
}

/** The ETH/USD answer the proxy gave at a block (8 decimals). */
export async function answerAt(rpc: Rpc, block: number): Promise<number> {
	const round = await rpc.call<string>(
		"eth_call",
		ethCall(FEED, SELECTOR.latestRoundData, block).params
	);
	return Number(int256(word(round, 1)));
}

/**
 * Price points inside a block range: the seeds of the segments that start in it, then every
 * AnswerUpdated the aggregator of its segment emitted. Logs from other aggregators are ignored.
 */
export function pricePoints(segments: FeedSegment[], logs: Log[], range: BlockRange): PricePoint[] {
	const points = segments
		.filter((segment) => range.from <= segment.from && segment.from <= range.to)
		.map((segment) => ({ block: segment.from, answer: segment.seed }));
	const answers = logs
		.filter((entry) => entry.topics[0] === TOPIC.answerUpdated)
		.sort(
			(a, b) =>
				Number(a.blockNumber) - Number(b.blockNumber) ||
				Number(a.logIndex) - Number(b.logIndex)
		);
	for (const entry of answers) {
		const block = Number(entry.blockNumber);
		const segment = segments.find((s) => s.from <= block && block <= s.to);
		if (segment?.aggregator !== entry.address.toLowerCase()) continue;
		points.push({ block, answer: Number(int256(entry.topics[1])) });
	}
	return points;
}

/** ETH/USD at a block: the latest answer at or before it. `points` is sorted by block. */
export function ethUsdAt(points: PricePoint[], block: number): number | null {
	let low = 0;
	let high = points.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (points[mid].block <= block) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found < 0 ? null : points[found].answer / 1e8;
}
