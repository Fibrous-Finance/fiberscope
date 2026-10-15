import { NETWORK } from "./config.ts";
import type { RegistryEntry } from "./registry.ts";

/**
 * Submission addresses CoW's CMS registry lacks on the network this indexer covers: its
 * `overrides` in packages/core/src/networks.ts, where the page's methodology reads them too. Each
 * is allow-listed on-chain (GPv2AllowListAuthentication) but missing from the CMS, so it counts as
 * an active prod address. They are merged over the CMS entries, so an entry here also replaces a
 * CMS entry for the same address.
 */
export const OVERRIDES: readonly RegistryEntry[] = NETWORK.overrides.map(
	({ address, solverId, name }) => ({ address, env: "prod", active: true, solverId, name })
);
