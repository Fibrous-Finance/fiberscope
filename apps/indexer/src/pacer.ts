import { setTimeout as sleep } from "node:timers/promises";

/** Exponential backoff with jitter: about 0.5 s on the first retry, doubling up to `capMs`. */
export function backoff(attempt: number, capMs = 30_000): number {
	const ceiling = Math.min(capMs, 500 * 2 ** attempt);
	return ceiling / 2 + (Math.random() * ceiling) / 2;
}

/** A `Retry-After` header (seconds or an HTTP date) in milliseconds; null when absent. */
export function retryAfterMs(header: string | null): number | null {
	if (header === null) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(header);
	return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** A short reason for a failed request, including the network cause fetch hides. */
export function describeError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause = (error.cause as { code?: string } | undefined)?.code;
	return cause ? `${error.message} (${cause})` : error.message;
}

/**
 * Spaces out work to at most `max` units per second. A rate-limit response slows it down and
 * pauses it; it then speeds back up by a quarter every ten quiet seconds.
 */
export class Pacer {
	readonly max: number;
	#rate: number;
	#next = 0;
	#changedAt = 0;

	constructor(maxPerSecond: number) {
		this.max = maxPerSecond;
		this.#rate = maxPerSecond;
	}

	/** Waits for the turn to spend `units`. */
	async take(units = 1): Promise<void> {
		const now = performance.now();
		if (this.#rate < this.max && now - this.#changedAt > 10_000) {
			this.#rate = Math.min(this.max, this.#rate * 1.25);
			this.#changedAt = now;
		}
		const start = Math.max(now, this.#next);
		this.#next = start + (units * 1000) / this.#rate;
		if (start > now) await sleep(start - now);
	}

	/** Reacts to a rate-limit response: slows down and pauses everything for `pauseMs`. */
	throttle(pauseMs: number): void {
		const now = performance.now();
		this.#rate = Math.max(this.max / 10, this.#rate * 0.7);
		this.#changedAt = now;
		this.#next = Math.max(this.#next, now + pauseMs);
	}
}
