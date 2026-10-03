"use client";

import { createContext, use } from "react";

import type { Measure, Period, Snapshot, Sort, View } from "@fiberscope/core";

/**
 * Page state shared by every section. Hover lives in its own context because it changes on every
 * pointer move; components that do not highlight anything should not re-render with it.
 */

/** How fresh the data is. "empty" is not a data state: it depends on the period (`View.total`). */
export type DataState = "live" | "delayed" | "loading" | "error";

export interface Status {
	/**
	 * live: the newest block in the data is at most 30 minutes old; delayed: older than that;
	 * loading: Retry now is fetching; error: the data could not be loaded.
	 */
	state: DataState;
	/** The clock the status was read at (Unix ms); it ticks every 30 seconds. */
	now: number;
	/** When the newest block in the data was mined (Unix ms); null when nothing loaded. */
	dataTime: number | null;
	endBlock: number | null;
	/** Minutes between data updates. */
	refreshMinutes: number;
	/** When the failed request was made (error state); null otherwise. */
	failedAt: number | null;
	/** When the page fetches again on its own: every minute while delayed or in error. */
	nextTryAt: number;
	/** `state` is "delayed": period wording reads "in the {period} to {asOf}". */
	delayed: boolean;
	/**
	 * `dataTime` as "09:49 UTC", or "3 Oct, 09:49 UTC" on another UTC day, with no-break spaces;
	 * null when nothing loaded.
	 */
	asOf: string | null;
	/** Fetch the data now, showing the loading state until it arrives. */
	retry: () => void;
}

export interface Layout {
	/** Page narrower than 760px: the compact layout. */
	compact: boolean;
	/** Width of the content column in px (the mosaic fills it). */
	contentWidth: number;
	/** Becomes true shortly after the page mounts; drives the mosaic's fade-in. */
	intro: boolean;
}

export interface Dashboard {
	snapshot: Snapshot | null;
	/** The view for the selected period and measure; null when no data loaded. */
	view: View | null;
	period: Period;
	measure: Measure;
	setPeriod: (period: Period) => void;
	setMeasure: (measure: Measure) => void;
	/** The table order; changing the period or measure resets it to the measure, descending. */
	sort: Sort;
	setSort: (sort: Sort) => void;
	/** The solver whose detail is open in the table. */
	open: string | null;
	setOpen: (id: string | null) => void;
	status: Status;
	layout: Layout;
}

export interface Hover {
	/** The highlighted solver id, or `OTHERS` for every solver ranked 7th or lower. */
	hovered: string | null;
	setHovered: (id: string | null) => void;
}

/** Hover id for the legend's "N others" item. */
export const OTHERS = "__others";

export const DashboardContext = createContext<Dashboard | null>(null);
export const HoverContext = createContext<Hover | null>(null);

export function useDashboard(): Dashboard {
	const value = use(DashboardContext);
	if (!value) throw new Error("useDashboard needs the Dashboard provider");
	return value;
}

/** The view, for sections that only render when data loaded. */
export function useView(): View {
	const { view } = useDashboard();
	if (!view) throw new Error("useView rendered without data");
	return view;
}

export function useHover(): Hover {
	const value = use(HoverContext);
	if (!value) throw new Error("useHover needs the Dashboard provider");
	return value;
}
