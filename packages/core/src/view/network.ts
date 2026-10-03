import type { Snapshot } from "../snapshot.ts";
import { DAY_MS, HISTORY_DAYS } from "./view.ts";
import type { View } from "./view.ts";

/**
 * "Is it changing": the active measure added up over every solver, day by day, and each ranked
 * solver's share of it. The days are the snapshot's rolling buckets, the ones every window is
 * made of, so the newest `window` days are exactly the selected period.
 */
export interface NetworkActivity {
	/** End time of each day drawn, oldest first: `HISTORY_DAYS` of the period. */
	days: number[];
	/** The measure summed over every solver, per day; null on days its data does not reach. */
	totals: (number | null)[];
	/** Index of the first day with data; the days before it have none. -1 when none has. */
	first: number;
	/** Each ranked solver's daily share of `totals`, by solver id; null where `totals` is. */
	shares: Map<string, (number | null)[]>;
	/** The newest `window` days fall inside the selected period. */
	window: number;
	/** Days of the period with data for the measure; `perDay` averages over them. */
	covered: number;
	/** The period's total per covered day. */
	perDay: number;
	/** `perDay` against the period before, in percent; null when there is none to compare. */
	change: number | null;
}

export function networkActivity(snapshot: Snapshot, view: View): NetworkActivity {
	const { measure } = view;
	const length = HISTORY_DAYS[view.period];
	// Volume needs auction data, which reaches less far back than the settlement history.
	const reach =
		measure === "volume" ? snapshot.coverage.auctionDays : snapshot.coverage.chainDays;
	const covered = measure === "volume" ? view.coverage.auction : view.coverage.chain;
	const series = new Map(snapshot.solvers.map((s) => [s.id, s[measure]]));

	// Newest first, like the snapshot: network[d] is bucket d, d days before the end. It reaches
	// as far as the chart and the period before the selected one, where the data does.
	const depth = Math.min(reach, Math.max(length, 2 * view.days));
	const network = Array.from({ length: depth }, (_, d) => {
		let total = 0;
		for (const values of series.values()) total += values[d] ?? 0;
		return total;
	});
	const sum = (from: number, to: number) => {
		let total = 0;
		for (let d = from; d < Math.min(to, depth); d++) total += network[d];
		return total;
	};

	// Oldest first: position k holds bucket length − 1 − k.
	const buckets = Array.from({ length }, (_, k) => length - 1 - k);
	const totals = buckets.map((d) => (d < reach ? network[d] : null));
	const shares = new Map(
		view.rows.map((row) => {
			const values = series.get(row.id) ?? [];
			const daily = buckets.map((d, k) => {
				const total = totals[k];
				if (total === null) return null;
				return total > 0 ? (values[d] ?? 0) / total : 0;
			});
			return [row.id, daily];
		})
	);

	const current = sum(0, covered);
	const previous = view.hasEarlierWindow ? sum(view.days, 2 * view.days) : 0;
	return {
		days: buckets.map((d) => view.end.time - d * DAY_MS),
		totals,
		first: totals.findIndex((total) => total !== null),
		shares,
		window: Math.min(view.days, length),
		covered,
		perDay: covered > 0 ? current / covered : 0,
		change: previous > 0 ? ((current - previous) / previous) * 100 : null,
	};
}

/** The network chart's bars as SVG paths, in a `0 0 {days} 100` viewBox. */
export interface NetworkBars {
	/** Days before the selected period. */
	earlier: string;
	/** Days inside the selected period. */
	window: string;
	/** The hovered day. */
	hovered: string;
}

/**
 * One bar per day with data, centred in its day and 70% as wide; the highest day reaches 96% of
 * the height. Days without data get no bar.
 */
export function networkBars(
	{ totals, window }: Pick<NetworkActivity, "totals" | "window">,
	hovered: number | null
): NetworkBars {
	const max = Math.max(1, ...totals.filter((total) => total !== null));
	const bars: NetworkBars = { earlier: "", window: "", hovered: "" };
	totals.forEach((total, k) => {
		if (total === null) return;
		const left = (k + 0.15).toFixed(2);
		const top = (100 - (total / max) * 96).toFixed(2);
		const bar = `M${left} ${top}H${(k + 0.85).toFixed(2)}V100H${left}Z`;
		const group =
			k === hovered ? "hovered" : k >= totals.length - window ? "window" : "earlier";
		bars[group] += bar;
	});
	return bars;
}
