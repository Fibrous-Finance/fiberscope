"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { useTranslations } from "next-intl";

import { NETWORKS } from "@fiberscope/core";
import type { Network, NetworkId } from "@fiberscope/core";

import type { Status } from "@/components/dashboard/context";
import { Logo } from "@/components/frame/Logo";
import { Caret } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";
import { shownTheme, subscribeTheme, toggleAppearance } from "@/lib/theme";

/** The data status the header shows on every page; the overview adds what its sections need. */
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
/** Each network's mark, the square by its name: a colour token (globals.css). */
const MARK: Record<NetworkId, string> = { base: "bg-base", bnb: "bg-bnb" };
/**
 * Below these widths a network's name does not fit next to a status word such as Delayed, so it
 * hides and the button keeps it. Next to a live status, a dot alone, every name fits to 360px.
 */
const NAME_HIDES: Record<NetworkId, string> = {
	base: "max-[360px]:hidden",
	bnb: "max-[400px]:hidden",
};
/** The live networks, in the menu's order, then the ones still to come (Header.network messages). */
const LIVE = Object.values(NETWORKS);
const UPCOMING = ["ethereum", "arbitrum", "gnosis"] as const;

export function Header({
	network,
	status,
	query = "",
	away,
}: {
	/** The page's network, whose data the status describes. */
	network: Network;
	status: HeaderStatus;
	/** The query string another network's page opens with. */
	query?: string;
	/** On pages other than a network's overview. */ away?: boolean;
}) {
	const t = useTranslations("Header");
	return (
		<header className="sticky top-0 z-20 border-b border-ln bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] backdrop-blur-[16px] backdrop-saturate-[160%]">
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
					<NetworkMenu
						network={network}
						query={query}
						away={away}
						// Below 980px a live status is a dot alone, which leaves room for a long name.
						roomy={status.state === "live"}
					/>
					<StatusPill status={status} away={away} />
					<ThemeButton />
				</div>
			</div>
		</header>
	);
}

function Nav({ away }: { away?: boolean }) {
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
 * The network picker, a disclosure: Escape, a click outside or focus moving out closes it. Closing
 * from inside the popup puts focus back on the button, which would otherwise be lost with the popup.
 * Each live network is a link to its page; the page's own only closes the popup.
 */
function NetworkMenu({
	network,
	query,
	away,
	roomy,
}: {
	network: Network;
	query: string;
	away?: boolean;
	roomy: boolean;
}) {
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
				aria-label={t("label", { name: network.name })}
				onClick={() => setOpen(!open)}
				className="-mx-1.5 flex h-11 items-center gap-[7px] border-0 bg-transparent px-1.5 text-[14px] font-medium text-fg wide:mx-0 wide:h-auto wide:px-0 wide:py-2.5"
			>
				<span className={`size-2 rounded-[2px] ${MARK[network.id]}`} />
				<span className={roomy ? "max-[360px]:hidden" : NAME_HIDES[network.id]}>
					{network.name}
				</span>
				<Caret open={open} className="text-mu" />
			</button>
			{open ? (
				<ul
					id={popup}
					className="absolute top-[50px] -right-3 z-30 w-[220px] rounded-[12px] border border-ln2 bg-bg p-1.5 text-[14px] wide:top-11"
				>
					{LIVE.map((item) => {
						const current = item.id === network.id;
						// Away from the network pages, the header's network is not this page.
						const here = current && !away;
						return (
							<li key={item.id}>
								<a
									href={`${item.path}${query}`}
									aria-current={here ? "page" : undefined}
									onClick={
										here
											? (event) => {
													event.preventDefault();
													button.current?.focus();
													setOpen(false);
												}
											: undefined
									}
									className={`flex items-baseline justify-between rounded-[8px] px-2.5 py-[9px] text-fg hover:no-underline ${current ? "bg-hov" : "transition-colors duration-200 hover:bg-hov"}`}
								>
									<span>{item.name}</span>
									<span className="font-mono text-[11px] font-medium text-act">
										{t("live")}
									</span>
								</a>
							</li>
						);
					})}
					{UPCOMING.map((key) => (
						<li
							key={key}
							className="flex items-baseline justify-between px-2.5 py-[9px] text-mu"
						>
							<span>{t(key)}</span>
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
	/** The label below 980px, when it differs. */
	short?: string;
	/** Below 980px only the dot shows; the label stays for screen readers. */
	quiet?: boolean;
}

/**
 * The data status: a dot and a label. Below 980px the label does not fit next to the nav, so the
 * pill shows only the dot when live and one word otherwise; that is also what lets the header fit
 * at 360px.
 */
function StatusPill({ status, away }: { status: HeaderStatus; away?: boolean }) {
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
								// Only the overview fetches on its own.
								polling: away ? "no" : "yes",
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
			};
			break;
		case "error":
			pill = {
				title: t("errorTitle", { time: f.time(status.failedAt ?? now) }),
				dot: "bg-err",
				label: t("error"),
				tone: "text-err",
				short: t("errorShort"),
			};
	}
	const compact = pill.short ? "max-[980px]:hidden" : pill.quiet ? "max-[980px]:sr-only" : "";

	return (
		<span
			role="status"
			title={pill.title}
			className="flex items-center gap-[9px] font-mono text-[12px] leading-[normal] font-medium whitespace-nowrap text-mu"
		>
			<span className={`size-[7px] flex-none rounded-full ${pill.dot}`} />
			<span className={`${pill.tone ?? ""} ${compact}`}>{pill.label}</span>
			{pill.short ? (
				<span className={`min-[980px]:hidden ${pill.tone ?? ""}`}>{pill.short}</span>
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
