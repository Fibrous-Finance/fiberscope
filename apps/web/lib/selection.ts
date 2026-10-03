import { MEASURES, PERIODS } from "@fiberscope/core";
import type { Measure, Period } from "@fiberscope/core";

/** What a shared link restores: `?period=7d&measure=volume&solver=<id>`. Defaults are omitted. */
export interface Selection {
	period: Period;
	measure: Measure;
	/** The solver whose detail is open in the table. */
	solver: string | null;
}

export const DEFAULT_SELECTION: Selection = { period: "24h", measure: "batches", solver: null };

type SearchParams = Record<string, string | string[] | undefined>;

export function parseSelection(params: SearchParams): Selection {
	const one = (key: string) => {
		const value = params[key];
		return Array.isArray(value) ? value[0] : value;
	};
	const period = one("period");
	const measure = one("measure");
	return {
		period: PERIODS.find((p) => p === period) ?? DEFAULT_SELECTION.period,
		measure: MEASURES.find((m) => m === measure) ?? DEFAULT_SELECTION.measure,
		solver: one("solver") || null,
	};
}

/** The query string for a selection, empty when everything is at its default. */
export function selectionQuery(selection: Selection): string {
	const query = new URLSearchParams();
	if (selection.period !== DEFAULT_SELECTION.period) query.set("period", selection.period);
	if (selection.measure !== DEFAULT_SELECTION.measure) query.set("measure", selection.measure);
	if (selection.solver) query.set("solver", selection.solver);
	const text = query.toString();
	return text ? `?${text}` : "";
}
