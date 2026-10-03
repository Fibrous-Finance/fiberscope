"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useTranslations } from "next-intl";

import type { Status } from "@/components/dashboard/context";
import { Logo } from "@/components/frame/Logo";
import { Caret } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";
import {
	APPEARANCES,
	readAppearance,
	saveAppearance,
	subscribeAppearance,
	systemTheme,
} from "@/lib/theme";

export type HeaderStatus = Omit<Status, "retry">;

/** Sections the nav follows, in page order. */
const SECTIONS = [
	{ id: "who", key: "solvers" },
	{ id: "enter", key: "auctions" },
	{ id: "method", key: "methodology" },
] as const;
/** A section is "in view" once its top is this close to the viewport top. */
const SPY_OFFSET = 140;

export function Header({
	status,
	away,
}: {
	status: HeaderStatus;
	/** On pages other than the overview. */ away?: boolean;
}) {
	const t = useTranslations("Header");
	return (
		<header className="sticky top-0 z-20 border-b border-ln bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] backdrop-blur-[16px] backdrop-saturate-[160%]">
			<div className="page flex h-[60px] items-center gap-[clamp(16px,3vw,40px)]">
				<a
					href={away ? "/" : "#"}
					aria-label={t("home")}
					className="flex flex-none items-baseline text-[20px] leading-none font-semibold tracking-[-0.035em] text-fg hover:no-underline"
				>
					<Logo />
				</a>
				<Nav away={away} />
				<div className="ml-auto flex items-center gap-[clamp(12px,2vw,24px)]">
					<NetworkMenu />
					<StatusPill status={status} />
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

	return (
		<nav aria-label={t("label")} className="hidden gap-[26px] text-[14px] wide:flex">
			{link("#", t("overview"), !away && active === -1)}
			{SECTIONS.map(({ id, key }, i) => link(`#${id}`, t(key), !away && active === i))}
		</nav>
	);
}

function NetworkMenu() {
	const t = useTranslations("Header.network");
	const tc = useTranslations("Common");
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				aria-haspopup="true"
				aria-expanded={open}
				aria-label={t("label", { name: tc("network") })}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-[7px] border-0 bg-transparent py-2.5 text-[14px] font-medium text-fg"
			>
				<span className="size-2 rounded-[2px] bg-base" />
				{tc("network")}
				<Caret open={open} className="text-mu" />
			</button>
			{open ? (
				<div className="absolute top-11 -right-3 z-30 w-[220px] rounded-[12px] border border-ln2 bg-bg p-1.5 text-[14px]">
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="flex w-full items-baseline justify-between rounded-[8px] border-0 bg-hov px-2.5 py-[9px] text-left text-fg"
					>
						<span>{tc("network")}</span>
						<span className="font-mono text-[11px] font-medium text-act">
							{t("live")}
						</span>
					</button>
					{(["ethereum", "arbitrum", "gnosis"] as const).map((key) => (
						<div
							key={key}
							className="flex items-baseline justify-between px-2.5 py-[9px] text-mu"
						>
							<span>{t(key)}</span>
							<span className="font-mono text-[11px] font-medium">{t("soon")}</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function StatusPill({ status }: { status: HeaderStatus }) {
	const t = useTranslations("Header.status");
	const f = useFormat();
	const time = status.lastRunAt === null ? "" : f.time(status.lastRunAt);
	const minutes = status.delayMinutes;
	const content = {
		live: {
			title: t("liveTitle", {
				block: f.int(status.endBlock ?? 0),
				minutes: status.refreshMinutes,
			}),
			dot: "bg-teal animate-pulse-dot",
			wide: t("live", { time }),
			compact: null,
			tone: "",
		},
		stale: {
			title: t("staleTitle", { time, minutes }),
			dot: "bg-warn",
			wide:
				minutes >= 120
					? t("staleHours", { hours: Math.floor(minutes / 60) })
					: t("stale", { minutes }),
			compact: t("staleShort"),
			tone: "text-warn",
		},
		loading: {
			title: t("loadingTitle"),
			dot: "bg-fa",
			wide: t("loading"),
			compact: t("loading"),
			tone: "",
		},
		error: {
			title: t("errorTitle", { time: f.time(status.attemptedAt ?? 0) }),
			dot: "bg-err",
			wide: t("error"),
			compact: t("errorShort"),
			tone: "text-err",
		},
	}[status.state];

	return (
		<span
			role="status"
			title={content.title}
			className="flex items-center gap-[9px] font-mono text-[12px] font-medium whitespace-nowrap text-mu"
		>
			<span className={`size-[7px] flex-none rounded-full ${content.dot}`} />
			<span className={`hidden wide:inline ${content.tone}`}>{content.wide}</span>
			{content.compact ? (
				<span className={`wide:hidden ${content.tone}`}>{content.compact}</span>
			) : null}
		</span>
	);
}

function ThemeButton() {
	const t = useTranslations("Header.appearance");
	const appearance = useSyncExternalStore(
		subscribeAppearance,
		readAppearance,
		() => "auto" as const
	);
	const system = useSyncExternalStore(subscribeAppearance, systemTheme, () => "light" as const);
	const title = t("title", { mode: appearance, theme: system });
	const next = APPEARANCES[(APPEARANCES.indexOf(appearance) + 1) % APPEARANCES.length]!;

	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			onClick={() => saveAppearance(next)}
			className="grid size-10 place-items-center rounded-full border-0 bg-transparent text-fg transition-colors duration-200 hover:bg-hov wide:size-[34px]"
		>
			<svg viewBox="0 0 18 18" aria-hidden="true" className="block size-[18px]">
				{appearance === "light" ? (
					<>
						<circle
							cx="9"
							cy="9"
							r="3.4"
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
						/>
						<path
							d="M9 1.5v1.8M9 14.7v1.8M1.5 9h1.8M14.7 9h1.8M3.7 3.7l1.3 1.3M13 13l1.3 1.3M3.7 14.3 5 13M13 5l1.3-1.3"
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
							strokeLinecap="round"
						/>
					</>
				) : appearance === "dark" ? (
					<path
						d="M15 11.3A6.4 6.4 0 0 1 6.7 3a6.4 6.4 0 1 0 8.3 8.3z"
						fill="none"
						stroke="currentColor"
						strokeWidth={1.5}
						strokeLinejoin="round"
					/>
				) : (
					<>
						<circle
							cx="9"
							cy="9"
							r="6.5"
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
						/>
						<path d="M9 2.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" />
					</>
				)}
			</svg>
		</button>
	);
}
