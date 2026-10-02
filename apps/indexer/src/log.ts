/** Writes one progress line to stderr, prefixed with the UTC time. */
export function log(message: string): void {
	process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${message}\n`);
}

/** Returns a logger that prints at most once per `intervalMs`, for long loops. */
export function throttledLog(intervalMs = 10_000): (message: () => string) => void {
	let last = 0;
	return (message) => {
		const now = Date.now();
		if (now - last < intervalMs) return;
		last = now;
		log(message());
	};
}

export function fmt(value: number, digits = 0): string {
	return value.toLocaleString("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	});
}

/** An address shortened for display, as in 0x588e…5e30. */
export function shortAddress(address: string): string {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** A duration as "1h 05m", "4m 10s" or "12s". */
export function duration(seconds: number): string {
	if (!Number.isFinite(seconds)) return "?";
	const s = Math.max(0, Math.round(seconds));
	if (s >= 3600)
		return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
	if (s >= 60) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
	return `${s}s`;
}
