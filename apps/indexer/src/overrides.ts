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
	bnb: [
		// Rizzolver: the address of its Base entry, allow-listed on BNB Chain too. The CMS lists it
		// (prod, active) for Ethereum only and, for BNB Chain, only a retired one, as for Base;
		// Dune's Spellbook lists it as Rizzolver on BNB Chain (cow_protocol_bnb_solvers).
		{
			address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
			env: "prod",
			active: true,
			solverId: "rizzolver",
			name: "Rizzolver",
		},
		// Fractal: allow-listed on BNB Chain, where CoW's competition data names it as the winning
		// solver of the auctions it settles, e.g. through Euler's open-position bundle in tx
		// 0x4b61e1649a3e48af1b1a5b5a36a91e87e6436ec361b4b428a24a9c6fd5080e07. The CMS lists it
		// (prod, active) for Ethereum only, as does Dune's Spellbook (cow_protocol_ethereum_solvers).
		{
			address: "0x95480d3f27658e73b2785d30beb0c847d78294c7",
			env: "prod",
			active: true,
			solverId: "fractal",
			name: "Fractal",
		},
	],
};

/** The overrides of the network this indexer covers. */
export const OVERRIDES = BY_NETWORK[NETWORK.id];
