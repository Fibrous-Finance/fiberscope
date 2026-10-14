/** A block and its timestamp in Unix seconds, as its header gives it. */
export interface Anchor {
	block: number;
	time: number;
}

/**
 * Block times from anchors: blocks whose timestamps the indexer has read. A block's time is
 * interpolated linearly between the anchors around it, so it is exact on an anchor, and between
 * anchors wherever blocks came at a steady pace: on Base, one every 2 seconds exactly. BNB Chain's
 * blocks come about every 0.45 seconds, but not exactly, and the pace changed several times, so
 * no formula gives their times. Beyond the anchors, times are extrapolated with the network's
 * average block time. Times are whole seconds, as in block headers.
 */
export class Clock {
	readonly #blocks: number[] = [];
	readonly #times: number[] = [];
	readonly #blockTime: number;

	/** `anchors` in block order; `blockTime` is the network's average seconds between blocks. */
	constructor(anchors: Iterable<Anchor>, blockTime: number) {
		for (const { block, time } of anchors) {
			this.#blocks.push(block);
			this.#times.push(time);
		}
		this.#blockTime = blockTime;
	}

	/** The anchor with the lowest block; null when there is none. */
	get oldest(): Anchor | null {
		return this.#blocks.length === 0 ? null : { block: this.#blocks[0], time: this.#times[0] };
	}

	/** Unix seconds of a block. */
	time(block: number): number {
		const blocks = this.#blocks;
		const times = this.#times;
		const last = blocks.length - 1;
		if (last < 0) throw new Error("the clock has no anchors");
		// The last anchor at or before the block; -1 when the block comes before them all.
		let at = -1;
		let low = 0;
		let high = last;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (blocks[mid] <= block) {
				at = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}
		if (at < 0) return Math.round(times[0] - (blocks[0] - block) * this.#blockTime);
		if (at === last) return Math.round(times[last] + (block - blocks[last]) * this.#blockTime);
		const elapsed = (block - blocks[at]) * (times[at + 1] - times[at]);
		return Math.round(times[at] + elapsed / (blocks[at + 1] - blocks[at]));
	}

	/** The first block whose time is later than `time`. */
	firstBlockAfter(time: number): number {
		const blocks = this.#blocks;
		const times = this.#times;
		if (blocks.length === 0) throw new Error("the clock has no anchors");
		// The first anchor later than `time`: the block lies after the anchor before it.
		let next = 0;
		let high = blocks.length;
		while (next < high) {
			const mid = (next + high) >> 1;
			if (times[mid] > time) high = mid;
			else next = mid + 1;
		}
		// An estimate from the line through the anchors around it, which the steps below make exact.
		let block: number;
		if (next === 0) {
			block = blocks[0] - Math.floor((times[0] - time) / this.#blockTime);
		} else if (next === blocks.length) {
			block = blocks[next - 1] + Math.ceil((time - times[next - 1]) / this.#blockTime);
		} else {
			const pace = (blocks[next] - blocks[next - 1]) / (times[next] - times[next - 1]);
			block = blocks[next - 1] + Math.ceil((time - times[next - 1]) * pace);
		}
		while (this.time(block) <= time) block++;
		while (this.time(block - 1) > time) block--;
		return block;
	}
}
