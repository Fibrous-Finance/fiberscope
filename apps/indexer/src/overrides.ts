import type { RegistryEntry } from "./registry.ts";

/**
 * Submission addresses CoW's CMS registry lacks. They are merged over the CMS entries, so an
 * entry here also replaces a CMS entry for the same address. Each is allow-listed on-chain
 * (GPv2AllowListAuthentication) but missing from the CMS.
 */
export const OVERRIDES: readonly RegistryEntry[] = [
	// Rizzolver: a prod address allow-listed on-chain but missing from the CMS, which lists only a
	// retired one.
	{
		address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
		env: "prod",
		active: true,
		solverId: "rizzolver",
		name: "Rizzolver",
	},
];
