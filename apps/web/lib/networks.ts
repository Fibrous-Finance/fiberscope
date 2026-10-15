import { BASE, BNB, shortAddress } from "@fiberscope/core";
import type { Network, NetworkId, RegistryOverride } from "@fiberscope/core";

/**
 * How the site shows each network: its facts from packages/core/src/networks.ts (path, explorer,
 * native token, L1 data fee, Dune table, bundles, registry overrides), plus what only the site
 * needs. Facts belong in core, presentation here. docs/development.md ("Networks on the site")
 * lists what a new network needs.
 */
export interface SiteNetwork extends Network {
	/**
	 * The width from which the header's network selector shows the network's name, at 760px and
	 * up; below it, the mark alone, as below 360px. Measured with the name and the Live dot so the
	 * header ends inside the content edge.
	 */
	nameFrom: number;
	/** The width from which the header's Live status shows its label; below it, its dot alone. */
	liveFrom: number;
	/**
	 * The other states' word (Delayed, Loading, No data) takes more room than the Live dot. Next to
	 * it the trigger shows the name from `compactWordNameFrom` below 760px (from 360px next to the
	 * dot) and from `wordNameFrom` at 760px and up, and from 760px the status shows the word from
	 * `wordFrom`; below it, the dot alone, the word kept for screen readers. Measured so that the
	 * header in every state ends inside the content edge at every width.
	 */
	compactWordNameFrom: number;
	wordNameFrom: number;
	wordFrom: number;
	/** The network's link preview, 1200 × 630, in public/. */
	image: string;
	/**
	 * A listed network has a row in every page's network menu and an entry in the sitemap, and its
	 * page may be indexed. An unlisted one, before its launch, has a page and data as a listed one
	 * does, but only its own page's menu shows it, the sitemap leaves it out and its page is
	 * noindex. Launching it is setting this to true.
	 */
	listed: boolean;
}

/** Every network with a page, keyed by id, in the menu's order: the live ones keep their launch order. */
export const SITE_NETWORKS: Record<NetworkId, SiteNetwork> = {
	base: {
		...BASE,
		nameFrom: 760,
		liveFrom: 980,
		compactWordNameFrom: 365,
		wordNameFrom: 835,
		wordFrom: 780,
		image: "/og-image.png",
		listed: true,
	},
	// Unlisted until its history is complete and its figures match Dune's Spellbook.
	bnb: {
		...BNB,
		nameFrom: 820,
		liveFrom: 1020,
		compactWordNameFrom: 403,
		wordNameFrom: 881,
		wordFrom: 780,
		image: "/og-image-bnb.png",
		listed: false,
	},
};

/** The networks still to come, after the live ones in the menu (`Header.network.{id}`, their marks). */
export const UPCOMING = ["ethereum", "arbitrum", "gnosis"] as const;
export type UpcomingId = (typeof UPCOMING)[number];

/**
 * The menu's live rows, in its order: the listed networks and, on an unlisted network's own page,
 * that network. Without a network (the 404 page), the listed ones.
 */
export function menuNetworks(
	current?: NetworkId,
	networks: readonly SiteNetwork[] = Object.values(SITE_NETWORKS)
): SiteNetwork[] {
	return networks.filter((network) => network.listed || network.id === current);
}

/**
 * The registry term's `{overrides}`: each address the registry lacks as "Rizzolver’s
 * 0x8f58…5cb7", joined as the page's lists are ("A, B and C").
 */
export function overridesText(
	overrides: readonly RegistryOverride[],
	list: (items: readonly string[]) => string,
	possessive: (name: string) => string
): string {
	return list(
		overrides.map(({ name, address }) => `${possessive(name)} ${shortAddress(address)}`)
	);
}
