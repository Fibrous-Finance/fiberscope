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
import { Hero } from "@/components/hero/Hero";
import { Methodology } from "@/components/methodology/Methodology";
import { Winning, WinningSkeleton } from "@/components/winning/Winning";

import { useFormat } from "@/lib/format";
import { selectionQuery } from "@/lib/selection";
import type { Selection } from "@/lib/selection";
import type { SnapshotResult } from "@/lib/snapshot";
import { dataStatus } from "@/lib/status";

const COMPACT_QUERY = "(max-width: 759.98px)";
/** Before the page measures itself: the content width at 1280px, or at 390px on a phone. */
const DEFAULT_CONTENT_WIDTH = 1184;
const PHONE_CONTENT_WIDTH = 350;
/** The mosaic starts fading in this long after mount. */
const INTRO_DELAY_MS = 120;
/** Until a response replaces the data, the page asks again this often. */
const RETRY_MS = 60_000;

function subscribeCompact(onChange: () => void) {
	const media = window.matchMedia(COMPACT_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

export function Dashboard({
	result,
	selection,
	phone,
}: {
	result: SnapshotResult;
	selection: Selection;
	/** The request most likely comes from a phone: render the compact layout before measuring. */
	phone: boolean;
}) {
	const router = useRouter();
	const f = useFormat();
	const snapshot = result.ok ? result.snapshot : null;
	const [period, setPeriod] = useState<Period>(selection.period);
	const [measure, setMeasure] = useState<Measure>(selection.measure);
	const [sort, setSort] = useState<Sort | null>(null);
	const [open, setOpen] = useState<string | null>(selection.solver);
	const [hovered, setHovered] = useState<string | null>(null);
	// Starts at the server's load time so the first client render matches it, then ticks.
	const [clock, setClock] = useState(result.at);
	const now = Math.max(clock, result.at);
	const [contentWidth, setContentWidth] = useState(
		phone ? PHONE_CONTENT_WIDTH : DEFAULT_CONTENT_WIDTH
	);
	const [intro, setIntro] = useState(false);
	const [retrying, startRetry] = useTransition();
	// The server cannot measure the window: it guesses from the request, and the client corrects
	// the guess right after hydration if the window says otherwise.
	const compact = useSyncExternalStore(
		subscribeCompact,
		() => window.matchMedia(COMPACT_QUERY).matches,
		() => phone
	);
	const mainRef = useRef<HTMLElement>(null);

	const view = useMemo(
		() => (snapshot ? buildView(snapshot, period, measure) : null),
		[snapshot, period, measure]
	);

	const fresh = dataStatus(result, now);
	const state = retrying ? "loading" : fresh.state;
	const status: Status = {
		...fresh,
		state,
		delayed: state === "delayed",
		asOf: fresh.dataTime === null ? null : f.asOf(fresh.dataTime, now),
		// A fetch in a transition: loading until the data (or the error) arrives.
		retry: () => startRetry(() => router.refresh()),
	};

	// Shared links: the period, measure and open solver live in the query string.
	useEffect(() => {
		const { pathname, search, hash } = window.location;
		const query = selectionQuery({ period, measure, solver: open });
		if (query !== search) window.history.replaceState(null, "", `${pathname}${query}${hash}`);
	}, [period, measure, open]);

	// The age of the data ticks: it turns delayed 30 minutes after its newest block. A page that
	// comes back into view reads the clock at once.
	useEffect(() => {
		const tick = () => setClock(Date.now());
		const timer = setInterval(tick, 30_000);
		document.addEventListener("visibilitychange", tick);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", tick);
		};
	}, []);
	// Fetch again without reloading the page, `nextTryAt - result.at` after this result arrived:
	// both are on the server's clock, so a device clock that is off does not move the fetch. Only
	// a visible, online page fetches; a hidden one fetches as soon as it is back in view, an
	// offline one once it is back online. (Offline, the fetch would fail and Next would fall back
	// to a full page load, which ends on the browser's error page.) Until a response replaces
	// this result, the page asks again every minute.
	const delay = fresh.nextTryAt - result.at;
	useEffect(() => {
		const due = Date.now() + delay;
		let timer = 0;
		const refresh = () => {
			window.clearTimeout(timer);
			if (document.visibilityState !== "visible" || !navigator.onLine) return;
			router.refresh();
			timer = window.setTimeout(refresh, RETRY_MS);
		};
		const resume = () => {
			if (Date.now() >= due) refresh();
		};
		timer = window.setTimeout(refresh, delay);
		document.addEventListener("visibilitychange", resume);
		window.addEventListener("online", resume);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", resume);
			window.removeEventListener("online", resume);
		};
	}, [router, result.at, delay]);

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

	// Below the hero: every section while the window has data, the first one's placeholder while
	// loading; Methodology and the footer always.
	const showData = (state === "live" || state === "delayed") && view !== null && view.total > 0;

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
				<div className="page">
					<main ref={mainRef}>
						<Hero />
						{showData ? (
							<>
								<Winning />
								<Change
									asOf={status.delayed ? (status.asOf ?? undefined) : undefined}
								/>
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
