"use client";

import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	useTransition,
} from "react";

import { useRouter } from "next/navigation";

import { buildView } from "@fiberscope/core";
import type { Measure, Period, Sort } from "@fiberscope/core";

import { Change } from "@/components/change/Change";
import { DashboardContext, HoverContext } from "@/components/dashboard/context";
import type { Status } from "@/components/dashboard/context";
import { Efficiency } from "@/components/efficiency/Efficiency";
import { Enter } from "@/components/enter/Enter";
import { Footer } from "@/components/frame/Footer";
import { Header } from "@/components/frame/Header";
import { StaleBanner } from "@/components/frame/StaleBanner";
import { Hero } from "@/components/hero/Hero";
import { Methodology } from "@/components/methodology/Methodology";
import { Winning, WinningSkeleton } from "@/components/winning/Winning";

import { selectionQuery } from "@/lib/selection";
import type { Selection } from "@/lib/selection";
import type { SnapshotResult } from "@/lib/snapshot";
import { dataStatus, MINUTE } from "@/lib/status";

const COMPACT_QUERY = "(max-width: 759.98px)";
/** Before the page measures itself: the content width at 1280px. */
const DEFAULT_CONTENT_WIDTH = 1184;
/** The mosaic starts fading in this long after mount. */
const INTRO_DELAY_MS = 120;

function subscribeCompact(onChange: () => void) {
	const media = window.matchMedia(COMPACT_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

export function Dashboard({ result, selection }: { result: SnapshotResult; selection: Selection }) {
	const router = useRouter();
	const snapshot = result.ok ? result.snapshot : null;
	const [period, setPeriod] = useState<Period>(selection.period);
	const [measure, setMeasure] = useState<Measure>(selection.measure);
	const [sort, setSort] = useState<Sort | null>(null);
	const [open, setOpen] = useState<string | null>(selection.solver);
	const [hovered, setHovered] = useState<string | null>(null);
	// Starts at the server's load time so the first client render matches it, then ticks.
	const [clock, setClock] = useState(result.at);
	const now = Math.max(clock, result.at);
	const [contentWidth, setContentWidth] = useState(DEFAULT_CONTENT_WIDTH);
	const [intro, setIntro] = useState(false);
	const [retrying, startRetry] = useTransition();
	const compact = useSyncExternalStore(
		subscribeCompact,
		() => window.matchMedia(COMPACT_QUERY).matches,
		() => false
	);
	const mainRef = useRef<HTMLElement>(null);

	const view = useMemo(
		() => (snapshot ? buildView(snapshot, period, measure) : null),
		[snapshot, period, measure]
	);

	const fresh = dataStatus(result, now);
	const status: Status = {
		...fresh,
		state: retrying ? "loading" : fresh.state,
		retry: () => startRetry(() => router.refresh()),
	};
	const stale = fresh.state === "stale";
	const { state, refreshMinutes } = status;

	// Shared links: the period, measure and open solver live in the query string.
	useEffect(() => {
		const { pathname, search, hash } = window.location;
		const query = selectionQuery({ period, measure, solver: open });
		if (query !== search) window.history.replaceState(null, "", `${pathname}${query}${hash}`);
	}, [period, measure, open]);

	// Relative times tick; the data reloads on the indexer's schedule, every minute while late.
	useEffect(() => {
		const timer = setInterval(() => setClock(Date.now()), 30_000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		const every = (stale || !result.ok ? 1 : refreshMinutes) * MINUTE;
		const reload = setInterval(() => {
			if (document.visibilityState === "visible") router.refresh();
		}, every);
		return () => clearInterval(reload);
	}, [router, stale, result.ok, refreshMinutes]);

	// Measure before the first paint, so the mosaic never draws a frame at the default width.
	useLayoutEffect(() => {
		const main = mainRef.current;
		if (!main) return;
		setContentWidth(main.clientWidth);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setContentWidth(Math.round(entry.contentRect.width));
		});
		observer.observe(main);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		const timer = setTimeout(() => setIntro(true), INTRO_DELAY_MS);
		return () => clearTimeout(timer);
	}, []);

	const showData = (state === "live" || state === "stale") && view !== null && view.total > 0;

	return (
		<DashboardContext
			value={{
				snapshot,
				view,
				period,
				measure,
				setPeriod: (next) => {
					setPeriod(next);
					setSort(null);
				},
				setMeasure: (next) => {
					setMeasure(next);
					setSort(null);
				},
				sort: sort ?? { key: measure, direction: -1 },
				setSort,
				open,
				setOpen,
				status,
				layout: { compact, contentWidth, intro },
			}}
		>
			<HoverContext value={{ hovered, setHovered }}>
				<Header status={status} />
				{state === "stale" ? <StaleBanner status={status} /> : null}
				<div className="page">
					<main ref={mainRef}>
						<Hero />
						{showData ? (
							<>
								<Winning />
								<Change />
								<Enter />
								<Efficiency />
							</>
						) : state === "loading" ? (
							<WinningSkeleton />
						) : null}
						<Methodology />
					</main>
					<Footer />
				</div>
			</HoverContext>
		</DashboardContext>
	);
}
