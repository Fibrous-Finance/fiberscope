"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { useTranslations } from "next-intl";

import type { Status } from "@/components/dashboard/context";
import { Logo } from "@/components/frame/Logo";
import { NetworkMark } from "@/components/frame/NetworkMark";
import { Caret } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";
import { menuNetworks, UPCOMING } from "@/lib/networks";
import type { SiteNetwork } from "@/lib/networks";
import { shownTheme, subscribeTheme, toggleAppearance } from "@/lib/theme";

/** The data status the header shows on a network's page; the overview adds what its sections need. */
export type HeaderStatus = Omit<Status, "delayed" | "asOf" | "retry">;

/** Sections the nav follows, in page order; at the bottom of the page the last one is marked. */
const SECTIONS = [
	{ id: "who", key: "solvers" },
	{ id: "enter", key: "auctions" },
	{ id: "eff", key: "efficiency" },
	{ id: "method", key: "methodology" },
] as const;
/** A section is "in view" once its top is this close to the viewport top. */
const SPY_OFFSET = 140;
/** The menu's rows: 39px, 44px in compact mode. */
const ROW = "flex items-center gap-2.5 rounded-[8px] px-2.5 py-[9px] max-wide:py-[11.5px]";
/** Tailwind's `sr-only`, for a status label the header has no room for. */
const SR_ONLY =
	"position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border-width: 0";

/**
 * The network's header widths (lib/networks.ts) as media queries, so the page is right from its
 * first paint at any width. Below 360px, and from the compact breakpoint (760px) up to `nameFrom`,
 * the trigger shows the mark alone, in a 12px box 3px from the caret. Below `liveFrom` the Live
 * status shows its dot alone, its label kept for screen readers, and "Data unavailable" its short
 * label. Next to the other states' word, which takes more room than the Live dot, the name shows
 * only from `compactWordNameFrom` and `wordNameFrom`, and from 760px the word only from
 * `wordFrom` (below it, the dot alone).
 */
function widthRules(network: SiteNetwork): string {
	const { id, nameFrom, liveFrom, compactWordNameFrom, wordNameFrom, wordFrom } = network;
	const scope = `[data-network="${id}"]`;
	const word = `${scope}:not([data-status="live"])`;
	const nameless: [string, string[]][] = [
		[
			scope,
			["(width < 360px)", ...(nameFrom > 760 ? [`(760px <= width < ${nameFrom}px)`] : [])],
		],
		[word, [`(width < ${compactWordNameFrom}px)`, `(760px <= width < ${wordNameFrom}px)`]],
	];
	return [
		...nameless.flatMap(([selector, media]) => [
			`@media ${media.join(", ")} {`,
			`${selector} .net-trigger { gap: 3px }`,
			`${selector} .net-name { display: none }`,
			`${selector} .net-mark { font-size: 12px }`,
			"}",
		]),
		`@media (760px <= width < ${wordFrom}px) {`,
		`${word} .status-word { ${SR_ONLY} }`,
		"}",
		`@media (width < ${liveFrom}px) {`,
		`${scope} .status-quiet { ${SR_ONLY} }`,
		`${scope} .status-long { display: none }`,
		"}",
		`@media (width >= ${liveFrom}px) {`,
		`${scope} .status-short { display: none }`,
		"}",
	].join("\n");
}

export function Header({
	network,
	status,
	query = "",
}: {
	/**
	 * The page's network, whose data the status describes. The 404 page has none: it belongs to no
	 * network, so its selector reads "Networks", its links lead to the overview's sections and it
	 * shows no data status.
	 */
	network?: SiteNetwork;
	/** The network's data status. */
	status?: HeaderStatus;
	/** The query string another network's page opens with: the period and the measure. */
	query?: string;
}) {
	const t = useTranslations("Header");
	const away = !network;
	return (
		<header
			data-network={network?.id}
			data-status={status?.state}
			className="sticky top-0 z-20 border-b border-ln bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] backdrop-blur-[16px] backdrop-saturate-[160%]"
		>
			{network ? (
				// React puts it in the head, so it applies before the header paints.
				<style href={`header-${network.id}`} precedence="medium">
					{widthRules(network)}
				</style>
			) : null}
			<div className="page flex h-[60px] items-center gap-[clamp(16px,3vw,40px)]">
				<a
					href={away ? "/" : "#"}
					aria-label={t("home")}
					className="flex flex-none items-baseline text-[20px] leading-none font-semibold tracking-[-0.035em] text-fg hover:no-underline max-wide:-my-3 max-wide:py-3"
				>
					<Logo />
				</a>
				<Nav away={away} />
				<div className="ml-auto flex items-center gap-2 wide:gap-[clamp(12px,2vw,24px)]">
					<NetworkMenu network={network} query={query} />
					{status ? <StatusPill status={status} /> : null}
					<ThemeButton />
				</div>
			</div>
		</header>
	);
}

function Nav({ away }: { away: boolean }) {
	const t = useTranslations("Header.nav");
	const [active, setActive] = useState(-1);

	useEffect(() => {
		if (away) return;
		let frame = 0;
		const spy = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const root = document.documentElement;
				const atBottom =
					root.scrollHeight > window.innerHeight + 8 &&
					window.innerHeight + window.scrollY >= root.scrollHeight - 4;
				let current = -1;
				SECTIONS.forEach(({ id }, i) => {
					const top = document.getElementById(id)?.getBoundingClientRect().top;
					if (top !== undefined && top <= SPY_OFFSET) current = i;
				});
				setActive(atBottom ? SECTIONS.length - 1 : current);
			});
		};
		spy();
		window.addEventListener("scroll", spy, { passive: true });
		window.addEventListener("resize", spy);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", spy);
			window.removeEventListener("resize", spy);
		};
	}, [away]);

	const link = (href: string, label: string, current: boolean) => (
		<a
			key={href}
			href={away ? `/${href}` : href}
			aria-current={current ? "location" : undefined}
			className={`no-underline transition-colors duration-200 hover:text-fg hover:no-underline ${current ? "text-fg" : "text-mu"}`}
		>
			{label}
		</a>
	);

	// Below 980px the five items leave too little room for the network menu and the button at 26px.
	return (
		<nav
			aria-label={t("label")}
			className="hidden gap-[26px] text-[14px] max-[980px]:gap-4 wide:flex"
		>
			{link("#", t("overview"), !away && active === -1)}
			{SECTIONS.map(({ id, key }, i) => link(`#${id}`, t(key), !away && active === i))}
		</nav>
	);
}

/**
 * The network menu, a disclosure: Escape, a click outside or focus moving out closes it. Closing
 * from inside the popup puts focus back on the button, which would otherwise be lost with the popup.
 * Each live network is a link to its page, in the same order on every page; the page's own, marked
 * with a check, only closes the popup. The networks still to come follow, muted.
 */
function NetworkMenu({ network, query }: { network?: SiteNetwork; query: string }) {
	const t = useTranslations("Header.network");
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const popup = useId();

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (ref.current?.contains(document.activeElement)) button.current?.focus();
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div
			ref={ref}
			// Tabbing out closes it; a click elsewhere leaves no new focus and is handled above.
			onBlur={(event) => {
				const next = event.relatedTarget;
				if (next && !event.currentTarget.contains(next)) setOpen(false);
			}}
			className="relative"
		>
			<button
				ref={button}
				type="button"
				aria-expanded={open}
				aria-controls={open ? popup : undefined}
				// Without a network, its visible "Networks" names it.
				aria-label={network ? t("label", { name: t(network.id) }) : undefined}
				onClick={() => setOpen(!open)}
				className="net-trigger -mx-1.5 flex h-11 items-center gap-1.5 border-0 bg-transparent px-1.5 text-[14px] font-medium text-fg wide:mx-0 wide:h-auto wide:px-0 wide:py-2.5"
			>
				{network ? (
					<>
						<NetworkMark id={network.id} className="net-mark" />
						<span className="net-name">{t(network.id)}</span>
					</>
				) : (
					t("menu")
				)}
				<Caret open={open} className="text-mu" />
			</button>
			{open ? (
				<ul
					id={popup}
					aria-label={t("menu")}
					className="absolute top-[50px] -right-3 z-30 max-h-[calc(100vh-72px)] w-[220px] overflow-y-auto rounded-[12px] border border-ln2 bg-bg p-1.5 text-[14px] wide:top-11"
				>
					{menuNetworks(network?.id).map((item) => {
						const current = item.id === network?.id;
						return (
							<li key={item.id}>
								<a
									href={`${item.path}${query}`}
									aria-current={current ? "page" : undefined}
									onClick={
										current
											? (event) => {
													event.preventDefault();
													button.current?.focus();
													setOpen(false);
												}
											: undefined
									}
									className={`${ROW} text-fg transition-colors duration-150 hover:bg-hov hover:no-underline`}
								>
									<NetworkMark id={item.id} />
									<span className="min-w-0 flex-1">{t(item.id)}</span>
									{current ? (
										<svg
											viewBox="0 0 12 12"
											aria-hidden="true"
											className="size-3 flex-none"
										>
											<path
												d="M2.5 6.4 4.9 8.8 9.5 3.7"
												fill="none"
												stroke="currentColor"
												strokeWidth={1.6}
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									) : null}
								</a>
							</li>
						);
					})}
					{UPCOMING.map((id) => (
						<li key={id} className={`${ROW} text-mu`}>
							<NetworkMark id={id} />
							<span className="min-w-0 flex-1">{t(id)}</span>
							<span className="font-mono text-[11px] font-medium">{t("soon")}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

interface Pill {
	title: string;
	dot: string;
	label: string;
	tone?: string;
	/** The one-word label of narrower headers, when it differs. */
	short?: string;
	/** The classes that show the label, then the short one, each at its widths. */
	widths?: [label: string, short: string];
	/** Below the network's `liveFrom` only the dot shows; the label stays for screen readers. */
	quiet?: boolean;
}

/**
 * The data status: a dot and a label. Below the network's `liveFrom` the label does not fit next
 * to the nav and the network's name, so the pill shows only the dot when live and one word
 * otherwise; that is also what lets the header fit at 360px (`widthRules`).
 */
function StatusPill({ status }: { status: HeaderStatus }) {
	const t = useTranslations("Header.status");
	const f = useFormat();
	const { dataTime, now } = status;
	let pill: Pill;
	switch (status.state) {
		case "live":
			pill = {
				title: t("liveTitle", {
					block: f.int(status.endBlock ?? 0),
					minutes: status.refreshMinutes,
				}),
				dot: "bg-teal animate-pulse-dot",
				label: t("live", { time: dataTime === null ? "" : f.time(dataTime) }),
				quiet: true,
			};
			break;
		case "delayed":
			pill = {
				title:
					dataTime === null
						? ""
						: t("delayedTitle", {
								age: f.ago(now - dataTime),
								asOf: f.asOf(dataTime, now),
								// The network's page fetches on its own.
								polling: "yes",
							}),
				dot: "bg-warn",
				label: t("delayed"),
				tone: "text-warn",
			};
			break;
		case "loading":
			pill = {
				title: t("loadingTitle"),
				dot: "bg-fa",
				label: t("loading"),
				short: t("loadingShort"),
				// "Loading…" fits from 980px next to any network's name (Header's width rules).
				widths: ["max-[980px]:hidden", "min-[980px]:hidden"],
			};
			break;
		case "error":
			pill = {
				title: t("errorTitle", { time: f.time(status.failedAt ?? now) }),
				dot: "bg-err",
				label: t("error"),
				tone: "text-err",
				short: t("errorShort"),
				// "Data unavailable" fits only from the network's `liveFrom`.
				widths: ["status-long", "status-short"],
			};
	}
	const [long, short] = pill.widths ?? ["", ""];

	return (
		<span
			role="status"
			title={pill.title}
			className="flex items-center gap-[9px] font-mono text-[12px] leading-[normal] font-medium whitespace-nowrap text-mu"
		>
			<span className={`size-[7px] flex-none rounded-full ${pill.dot}`} />
			<span
				className={`status-word ${pill.tone ?? ""} ${pill.quiet ? "status-quiet" : long}`}
			>
				{pill.label}
			</span>
			{pill.short ? (
				<span className={`status-word ${short} ${pill.tone ?? ""}`}>{pill.short}</span>
			) : null}
		</span>
	);
}

function ThemeButton() {
	const t = useTranslations("Header.appearance");
	// The label follows once React runs; the icon is right from the first paint, as CSS picks it
	// from data-theme.
	const theme = useSyncExternalStore(subscribeTheme, shownTheme, () => "light" as const);
	const title = t("title", { theme: theme === "dark" ? "light" : "dark" });

	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			onClick={toggleAppearance}
			className="-mr-3 grid size-11 place-items-center rounded-full border-0 bg-transparent text-fg transition-colors duration-200 hover:bg-hov wide:mr-0 wide:size-[34px]"
		>
			{/* The theme on screen: a sun for light, a moon for dark. */}
			<svg viewBox="0 0 18 18" aria-hidden="true" className="block size-[18px] dark:hidden">
				<circle cx="9" cy="9" r="3.4" fill="none" stroke="currentColor" strokeWidth={1.5} />
				<path
					d="M9 1.5v1.8M9 14.7v1.8M1.5 9h1.8M14.7 9h1.8M3.7 3.7l1.3 1.3M13 13l1.3 1.3M3.7 14.3 5 13M13 5l1.3-1.3"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					strokeLinecap="round"
				/>
			</svg>
			<svg viewBox="0 0 18 18" aria-hidden="true" className="hidden size-[18px] dark:block">
				<path
					d="M15 11.3A6.4 6.4 0 0 1 6.7 3a6.4 6.4 0 1 0 8.3 8.3z"
					fill="none"
					stroke="currentColor"
					strokeWidth={1.5}
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}
