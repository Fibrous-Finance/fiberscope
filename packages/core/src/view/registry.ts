import type { RegisteredAddress, RegisteredSolver, Snapshot, SolverAddress } from "../snapshot.ts";
import { DAY_MS } from "./view.ts";

/**
 * CoW's solver registry as the page lists it. It does not depend on the period: every last
 * settlement is checked against the whole settlement history, `coverage.chainDays`.
 */
export interface Registry {
	/** Start of the settlement history (Unix ms): "25 have settled since 12 Jul". */
	since: number;
	/** Every solver the registry lists. */
	total: number;
	/** Solvers with a settlement since `since`, the most recent first. */
	settled: RegisteredSolver[];
	/** The others: active first, then by name. */
	unsettled: RegisteredSolver[];
}

/** A table solver's entry in the registry, for its detail. */
export interface Registration {
	/** Whether the registry lists the solver as active; null when it does not list it. */
	active: boolean | null;
	/** Current addresses first (prod, then barn), retired ones after. */
	addresses: RegisteredAddress[];
}

/** The registry in two groups, each in the snapshot's order. */
export function buildRegistry(snapshot: Snapshot): Registry {
	// The oldest day of the history starts here, exclusive (see `Snapshot`).
	const since = snapshot.end.time - snapshot.coverage.chainDays * DAY_MS;
	const settled: RegisteredSolver[] = [];
	const unsettled: RegisteredSolver[] = [];
	for (const solver of snapshot.registry) {
		const time = solver.lastSettlement?.time ?? null;
		(time !== null && time > since ? settled : unsettled).push(solver);
	}
	return { since, total: snapshot.registry.length, settled, unsettled };
}

/**
 * The registry's status and addresses for a solver of the table. A solver the registry does not
 * list keeps its submission addresses, all of them current.
 */
export function registrationOf(
	registry: readonly RegisteredSolver[],
	solver: { id: string; addresses: readonly SolverAddress[] }
): Registration {
	const entry = registry.find((r) => r.id === solver.id);
	if (!entry) {
		return { active: null, addresses: solver.addresses.map((a) => ({ ...a, active: true })) };
	}
	// The registry lists prod before barn, so a stable sort keeps that order within each group.
	return {
		active: entry.active,
		addresses: entry.addresses.toSorted((a, b) => Number(b.active) - Number(a.active)),
	};
}
