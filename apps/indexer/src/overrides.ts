import type { RegistryEntry } from "./registry.ts";

/**
 * Submission addresses CoW's CMS registry lacks. They are merged over the CMS entries, so an
 * entry here also replaces a CMS entry for the same address.
 */
export const OVERRIDES: readonly RegistryEntry[] = [
	// Rizzolver's current prod address, allow-listed on-chain; the CMS only has a retired one.
	{
		address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
		env: "prod",
		active: true,
		solverId: "rizzolver",
		name: "Rizzolver",
	},
];
