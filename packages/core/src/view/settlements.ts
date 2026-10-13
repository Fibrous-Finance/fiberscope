import { shortAddress } from "../format.ts";
import type { CreditedSettlement, Snapshot } from "../snapshot.ts";
import { solverRef } from "./view.ts";
import type { SolverRef } from "./view.ts";

/** A settlement of the network-wide list, credited to its solver. */
export interface LatestSettlement extends Omit<CreditedSettlement, "solver" | "quotedBy"> {
	solver: SolverRef;
	/**
	 * The solver whose quote the first trade's order was placed with; null when it was placed
	 * without a solver's quote or was not looked up. Either way the page shows "—".
	 */
	quotedBy: SolverRef | null;
}

/**
 * Names a solver by its id as it is named everywhere else on the page. A solver the snapshot does
 * not list is shown by its address.
 */
export function solverRefs(snapshot: Snapshot): (id: string) => SolverRef {
	const refs = new Map(snapshot.solvers.map((s) => [s.id, solverRef(s)]));
	return (id) => refs.get(id) ?? { id, label: shortAddress(id), unnamed: true };
}

/**
 * The newest settlements across all solvers, newest first, with the settling solver and the one
 * that gave the quote named as in `solverRefs`.
 */
export function latestSettlements(snapshot: Snapshot): LatestSettlement[] {
	const ref = solverRefs(snapshot);
	return snapshot.latestSettlements.map(({ solver, quotedBy, ...settlement }) => ({
		...settlement,
		solver: ref(solver),
		quotedBy: quotedBy ? ref(quotedBy) : null,
	}));
}
