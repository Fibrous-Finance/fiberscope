import { setTimeout as sleep } from "node:timers/promises";

import { backoff, describeError } from "./pacer.ts";

/** One submission address of a solver. */
export interface RegistryEntry {
	/** Lowercase hex address. */
	address: string;
	env: "prod" | "barn";
	active: boolean;
	/** CoW's id for the solver; it groups prod and barn, old and new addresses. */
	solverId: string;
	name: string;
}

export interface SolverIdentity {
	/** The registry's solver id, or the lowercase address when the registry lacks it. */
	id: string;
	name: string | null;
}

const CMS_URL = "https://cms.cow.fi/api/solver-networks";

/**
 * CoW's solver registry for one chain, keyed by address. CMS entries come first and overrides
 * win. When the CMS lists an address twice, the active entry wins, then prod over barn.
 */
export class Registry {
	readonly #byAddress = new Map<string, RegistryEntry>();
	readonly #names = new Map<string, string>();

	constructor(cms: readonly RegistryEntry[], overrides: readonly RegistryEntry[]) {
		const preferred = [...cms].sort((a, b) => preference(a) - preference(b));
		for (const entry of preferred) {
			if (!this.#byAddress.has(entry.address)) this.#byAddress.set(entry.address, entry);
		}
		for (const entry of overrides) this.#byAddress.set(entry.address, entry);
		for (const entry of [...overrides, ...preferred]) {
			if (!this.#names.has(entry.solverId)) this.#names.set(entry.solverId, entry.name);
		}
	}

	has(address: string): boolean {
		return this.#byAddress.has(address);
	}

	identify(address: string): SolverIdentity {
		const entry = this.#byAddress.get(address);
		if (!entry) return { id: address, name: null };
		return { id: entry.solverId, name: this.#names.get(entry.solverId) ?? entry.name };
	}

	/** Every address registered under a solver id. */
	addresses(solverId: string): RegistryEntry[] {
		return [...this.#byAddress.values()].filter((entry) => entry.solverId === solverId);
	}
}

/** Active before inactive, then prod before barn. */
function preference(entry: RegistryEntry): number {
	return (entry.active ? 0 : 2) + (entry.env === "prod" ? 0 : 1);
}

/** Fetches every CMS solver-network entry for a chain, page by page. */
export async function fetchCmsEntries(chainId: number): Promise<RegistryEntry[]> {
	const entries: RegistryEntry[] = [];
	for (let page = 1, pages = 1; page <= pages; page++) {
		const url = `${CMS_URL}?populate=*&pagination[pageSize]=100&pagination[page]=${page}`;
		const body = (await getJson(url)) as CmsPage;
		pages = body.meta?.pagination?.pageCount ?? 1;
		entries.push(...parseCmsPage(body, chainId));
	}
	return entries;
}

export interface CmsPage {
	data?: {
		attributes?: {
			address?: string;
			active?: boolean;
			network?: { data?: { attributes?: { chainId?: number } } | null };
			environment?: { data?: { attributes?: { name?: string } } | null };
			solver?: { data?: { attributes?: { displayName?: string; solverId?: string } } | null };
		};
	}[];
	meta?: { pagination?: { pageCount?: number } };
}

/** The entries of one CMS page that belong to `chainId`; malformed entries are skipped. */
export function parseCmsPage(page: CmsPage, chainId: number): RegistryEntry[] {
	const entries: RegistryEntry[] = [];
	for (const item of page.data ?? []) {
		const attributes = item.attributes;
		if (attributes?.network?.data?.attributes?.chainId !== chainId) continue;
		const env = attributes.environment?.data?.attributes?.name;
		const solver = attributes.solver?.data?.attributes;
		if (!attributes.address || (env !== "prod" && env !== "barn") || !solver?.solverId)
			continue;
		entries.push({
			address: attributes.address.toLowerCase(),
			env,
			active: attributes.active === true,
			solverId: solver.solverId,
			name: solver.displayName || solver.solverId,
		});
	}
	return entries;
}

async function getJson(url: string): Promise<unknown> {
	for (let attempt = 0; ; attempt++) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
			if (response.ok) return await response.json();
			await response.body?.cancel();
			throw new Error(`HTTP ${response.status}`);
		} catch (error) {
			if (attempt === 3) throw new Error(`${url}: ${describeError(error)}`);
			await sleep(backoff(attempt + 1));
		}
	}
}
