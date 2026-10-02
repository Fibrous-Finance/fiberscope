"use client";

import { createContext, use } from "react";

import type { Measure, Period, Snapshot, Sort, View } from "@fiberscope/core";

/**
 * Page state shared by every section. Hover lives in its own context because it changes on every
 * pointer move; components that do not highlight anything should not re-render with it.
 */

/** How fresh the data is. "empty" is not a data state: it depends on the period (`View.total`). */
export type DataState = "live" | "stale" | "loading" | "error";

export interface Status {
	state: DataState;
	/** The last completed indexer run (Unix ms); null when nothing loaded. */
	lastRunAt: number | null;
	endBlock: number | null;
	refreshMinutes: number;
	/** Whole minutes since the last run. */
	delayMinutes: number;
	/** When the failed load was attempted (error state). */
	attemptedAt: number | null;
	/** Reload the data (shows the loading state until it arrives). */
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
