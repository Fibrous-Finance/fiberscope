import { shortAddress } from "../format.ts";
import type { SettlementSummary, Snapshot } from "../snapshot.ts";
import { solverRef } from "./view.ts";
import type { SolverRef } from "./view.ts";

/** A settlement of the network-wide list, credited to its solver. */
export interface LatestSettlement extends SettlementSummary {
	solver: SolverRef;
}

/**
 * The newest settlements across all solvers, newest first, each named as its solver is everywhere
 * else on the page. A solver the snapshot does not list is shown by its address.
 */
export function latestSettlements(snapshot: Snapshot): LatestSettlement[] {
	const refs = new Map(snapshot.solvers.map((s) => [s.id, solverRef(s)]));
	return snapshot.latestSettlements.map(({ solver, ...settlement }) => ({
		...settlement,
		solver: refs.get(solver) ?? { id: solver, label: shortAddress(solver), unnamed: true },
	}));
}
