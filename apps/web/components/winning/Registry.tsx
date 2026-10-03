"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { BASE, buildRegistry, DASH, shortAddress } from "@fiberscope/core";
import type { RegisteredAddress, RegisteredSolver } from "@fiberscope/core";

import { useDashboard } from "@/components/dashboard/context";
import { Caret } from "@/components/ui/Section";

import { useFormat } from "@/lib/format";

/** Solver, status, prod and barn addresses, last settlement: the header and every row share it. */
const GRID =
	"grid grid-cols-[minmax(150px,1.1fr)_90px_minmax(0,1.3fr)_minmax(0,1.3fr)_150px] gap-x-4";
/** "Retired" after an address. */
const RETIRED = "text-[10.5px] tracking-[.06em] text-fa uppercase";

/**
 * Every solver in CoW's registry, collapsed under the leaderboard. It does not follow the period:
 * each last settlement is checked against the whole settlement history, and the solvers without
 * one since it starts sit behind a second toggle.
 */
export function Registry() {
	const { snapshot, layout } = useDashboard();
	const t = useTranslations("Winning.registry");
	const tc = useTranslations("Common");
	const f = useFormat();
	const [open, setOpen] = useState(false);
	const [all, setAll] = useState(false);
	if (!snapshot || snapshot.registry.length === 0) return null;

	const registry = buildRegistry(snapshot);
	const since = f.day(registry.since);
	const { compact } = layout;
	const Entry = compact ? RegistryBlock : RegistryRow;

	return (
		<div id="registry" className="mt-11 scroll-mt-[60px] border-t border-ln2">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="relative flex min-h-[60px] w-full flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-ln py-[18px] pr-9 text-left transition-colors duration-150 hover:bg-hov"
			>
				<span className="text-[16px] font-medium tracking-[-0.01em]">{t("title")}</span>
				<span className="text-[14px] text-pretty text-mu">
					{t("summary", { total: registry.total, network: tc("network") })}
				</span>
				<Caret
					open={open}
					className="absolute top-1/2 right-1.5 -mt-[6.5px] size-[13px] text-fa"
				/>
			</button>
			{open ? (
				<>
					<p className="mt-[18px] max-w-[720px] text-[14px] leading-[1.55] text-pretty text-mu">
						{t("intro", {
							settled: registry.settled.length,
							unsettled: registry.unsettled.length,
							since,
						})}
					</p>
					<div className={compact ? "mt-3 border-t border-ln2" : "mt-4 tabular-nums"}>
						{compact ? null : (
							<div
								className={`${GRID} box-content h-9 items-center border-b border-ln2 label whitespace-nowrap`}
							>
								<span>{t("columns.solver")}</span>
								<span>{t("columns.status")}</span>
								<span>{t("columns.prod")}</span>
								<span>{t("columns.barn")}</span>
								<span className="text-right">{t("columns.last")}</span>
							</div>
						)}
						{registry.settled.map((solver) => (
							<Entry key={solver.id} solver={solver} since={since} />
						))}
						{registry.unsettled.length > 0 ? (
							<button
								type="button"
								aria-expanded={all}
								onClick={() => setAll(!all)}
								className={`flex w-full items-center gap-2.5 border-b border-ln text-left font-mono text-[12px] leading-[normal] font-medium quiet ${compact ? "min-h-[52px]" : "min-h-12"}`}
							>
								{t("unsettled", {
									open: all ? "yes" : "no",
									count: registry.unsettled.length,
									since,
								})}
								<Caret open={all} />
							</button>
						) : null}
						{all
							? registry.unsettled.map((solver) => (
									<Entry key={solver.id} solver={solver} since={since} />
								))
							: null}
					</div>
					<div className="mt-3.5 flex flex-wrap justify-between gap-x-5 gap-y-1.5 foot-line">
						<span>{t("note")}</span>
						<span>{t("source", { network: tc("network") })}</span>
					</div>
				</>
			) : null}
		</div>
	);
}

/** Desktop: one row per solver, every address of each role in its column. */
function RegistryRow({ solver, since }: { solver: RegisteredSolver; since: string }) {
	const t = useTranslations("Winning.registry");
	const f = useFormat();
	const last = solver.lastSettlement;
	return (
		<div
			className={`${GRID} items-start border-b border-ln py-[11px] font-mono text-[12.5px] leading-5 font-medium`}
		>
			<span className="truncate font-sans text-[14px] leading-5">{solver.name}</span>
			<span className={solver.active ? "" : "text-fa"}>
				{t("status", { status: solver.active ? "active" : "inactive" })}
			</span>
			<Addresses addresses={solver.addresses.filter((a) => a.env === "prod")} />
			<Addresses addresses={solver.addresses.filter((a) => a.env === "barn")} />
			<span className={`text-right ${last ? "" : "text-fa"}`}>
				{last ? f.dayTime(last.time) : t("none", { since })}
			</span>
		</div>
	);
}

/** A role's addresses, current first, each linked to Basescan; "—" when it has none. */
function Addresses({ addresses }: { addresses: RegisteredAddress[] }) {
	const t = useTranslations("Winning");
	if (addresses.length === 0) return <span className="text-fa">{DASH}</span>;
	return (
		<span className="flex min-w-0 flex-col gap-0.5">
			{addresses.map((a) => (
				<span key={a.address} className="flex items-baseline gap-2 whitespace-nowrap">
					<a
						href={`${BASE.scan}/address/${a.address}`}
						target="_blank"
						rel="noopener"
						title={a.address}
						className={`hover:text-act hover:no-underline ${a.active ? "text-fg" : "text-fa"}`}
					>
						{shortAddress(a.address)}
					</a>
					{a.active ? null : <span className={RETIRED}>{t("retired")}</span>}
				</span>
			))}
		</span>
	);
}

/** Compact: one block per solver, its addresses listed under it, ready to select. */
function RegistryBlock({ solver, since }: { solver: RegisteredSolver; since: string }) {
	const t = useTranslations("Winning");
	const f = useFormat();
	const last = solver.lastSettlement;
	return (
		<div className="border-b border-ln py-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-[15px] font-medium">{solver.name}</span>
				<span
					className={`font-mono text-[11.5px] leading-[normal] font-medium ${solver.active ? "" : "text-fa"}`}
				>
					{t("registry.status", { status: solver.active ? "active" : "inactive" })}
				</span>
			</div>
			<div className="mt-0.5 font-mono text-[11.5px] leading-[normal] font-medium text-mu">
				{last
					? t("registry.last", { time: f.dayTime(last.time) })
					: t("registry.never", { since })}
			</div>
			{solver.addresses.length > 0 ? (
				<div className="mt-1.5 flex flex-col gap-[3px] font-mono text-[11.5px] leading-[normal] font-medium">
					{solver.addresses.map((a) => (
						<span key={`${a.env}:${a.address}`} className={a.active ? "" : "text-fa"}>
							<span className="inline-block w-10 text-fa">
								{t(`detail.env.${a.env}`)}
							</span>
							<span className="select-all">{shortAddress(a.address)}</span>
							{a.active ? null : ` ${t("registry.retiredNote")}`}
						</span>
					))}
				</div>
			) : null}
		</div>
	);
}
