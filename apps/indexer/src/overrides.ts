import type { NetworkId } from "@fiberscope/core";

import { NETWORK } from "./config.ts";
import type { RegistryEntry } from "./registry.ts";

/**
 * Submission addresses CoW's CMS registry lacks, by network. They are merged over the CMS entries,
 * so an entry here also replaces a CMS entry for the same address. Each is allow-listed on-chain
 * (GPv2AllowListAuthentication) but missing from the CMS.
 */
const BY_NETWORK: Record<NetworkId, readonly RegistryEntry[]> = {
	base: [
		// Rizzolver: a prod address allow-listed on-chain but missing from the CMS, which lists
		// only a retired one.
		{
			address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
			env: "prod",
			active: true,
			solverId: "rizzolver",
			name: "Rizzolver",
		},
	],
	bnb: [],
};

/** The overrides of the network this indexer covers. */
export const OVERRIDES = BY_NETWORK[NETWORK.id];
