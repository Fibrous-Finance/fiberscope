/**
 * Networks Fiberscope indexes, each shown on a page of its own (`path`): the facts the indexer
 * reads it with and the page's copy names. How the site shows each one (its row in the network
 * menu, its header widths, its link preview, whether it is listed yet) is in
 * apps/web/lib/networks.ts; docs/development.md ("Networks on the site") lists what a new network
 * needs.
 */
export type NetworkId = "base" | "bnb";

/**
 * A submission address CoW's solver registry (its CMS) lacks for a network, though it is
 * allow-listed on-chain (GPv2AllowListAuthentication) and settles there. The indexer adds it as an
 * active prod address, over any CMS entry for the same address; the page's methodology lists it.
 */
export interface RegistryOverride {
	/** Lowercase hex address. */
	address: string;
	/** CoW's id for the solver; it groups the solver's addresses. */
	solverId: string;
	name: string;
}

export interface Network {
	id: NetworkId;
	/** The network's name in the indexer's messages; the page's copy takes `Header.network.{id}`. */
	name: string;
	/** The site's page for this network. */
	path: string;
	chainId: number;
	/** CoW Protocol API root for this network. */
	cowApi: string;
	/** CoW Explorer path segment, as in `https://explorer.cow.fi/{slug}/tx/{hash}`. */
	explorerSlug: string;
	/** Block explorer root. */
	scan: string;
	/** The block explorer's name, as the page's links name it. */
	scanName: string;
	/**
	 * Whether a transaction also pays an L1 data fee, an L2's charge for posting its data to
	 * Ethereum: a settlement's cost includes it, and the page's copy says so.
	 */
	l1DataFee: boolean;
	/** Dune Spellbook's table of CoW Protocol trades on this network, as the methodology cites it. */
	duneTable: string;
	/**
	 * Average seconds between blocks, only to turn seconds into block counts: block times come
	 * from the blocks' own timestamps (the indexer's clock).
	 */
	blockTime: number;
	/**
	 * Blocks per `eth_getLogs` request, and the step of the indexer's block ranges; a range the
	 * node refuses is split.
	 */
	logRange: number;
	/**
	 * Blocks within which one auction's settlements land, from its start to its deadline with a
	 * margin: a settlement's lookup waits for the lookups of the settlements this close before it.
	 */
	sameAuctionBlocks: number;
	native: {
		symbol: string;
		/** The wrapped native token. CoW prices both alike, so a native buy is priced as it. */
		wrapped: string;
		/** The wrapped native token's symbol. */
		wrappedSymbol: string;
		/** Chainlink's proxy for the native token's USD price (8 decimals). */
		usdFeed: string;
	};
	contracts: {
		settlement: string;
		allowList: string;
		/** CoW's flash-loan router: it settles on behalf of the auction winner. */
		flashLoanRouter: string;
		/**
		 * The network's Atomic Bundles (formerly Generalized Wrappers), lowercase: contracts CoW
		 * DAO allow-lists that a solver calls instead of the settlement contract, and that call
		 * `settle` on its behalf.
		 */
		bundles: string[];
	};
	/** Addresses the registry lacks on this network, with the evidence for each. */
	overrides: RegistryOverride[];
}

export const BASE: Network = {
	id: "base",
	name: "Base",
	path: "/",
	chainId: 8453,
	cowApi: "https://api.cow.fi/base",
	explorerSlug: "base",
	scan: "https://basescan.org",
	scanName: "Basescan",
	l1DataFee: true,
	duneTable: "cow_protocol_base.trades",
	// Exactly: Base makes a block every 2 seconds.
	blockTime: 2,
	// Base's docs recommend ranges under 2,000 blocks.
	logRange: 2_000,
	// Auctions end 6–8 blocks after their start.
	sameAuctionBlocks: 10,
	native: {
		symbol: "ETH",
		wrapped: "0x4200000000000000000000000000000000000006",
		wrappedSymbol: "WETH",
		usdFeed: "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70",
	},
	contracts: {
		settlement: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
		allowList: "0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe",
		flashLoanRouter: "0x9da8b48441583a2b93e2ef8213aad0ec0b392c69",
		// None: Euler's SDK lists bundles for Ethereum and BNB Chain only.
		bundles: [],
	},
	overrides: [
		// Rizzolver: a prod address allow-listed on-chain but missing from the CMS, which lists
		// only a retired one.
		{
			address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
			solverId: "rizzolver",
			name: "Rizzolver",
		},
	],
};

export const BNB: Network = {
	id: "bnb",
	name: "BNB Chain",
	path: "/bnb",
	chainId: 56,
	cowApi: "https://api.cow.fi/bnb",
	explorerSlug: "bnb",
	scan: "https://bscscan.com",
	scanName: "BscScan",
	l1DataFee: false,
	duneTable: "cow_protocol_bnb.trades",
	// On average since January 2026 (0.4502 s measured); it was 3, 1.5 and then 0.75 seconds before.
	blockTime: 0.45,
	// The widest range every BNB node we use serves (one caps ranges at 5,000 blocks): about 37
	// minutes of blocks.
	logRange: 5_000,
	// Auctions end 13–14 blocks after their start.
	sameAuctionBlocks: 16,
	native: {
		symbol: "BNB",
		wrapped: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
		wrappedSymbol: "WBNB",
		usdFeed: "0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee",
	},
	contracts: {
		settlement: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
		allowList: "0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe",
		flashLoanRouter: "0x9da8b48441583a2b93e2ef8213aad0ec0b392c69",
		// Euler's, to open, close and collateral-swap positions: COWSWAP_CHAIN_CONFIG[56] in
		// euler-xyz/euler-sdks (packages/euler-v2-sdk/src/services/executionService/
		// cowSwapHelpers.ts). Each is allow-listed, settles through the settlement contract
		// (`SETTLEMENT()`) and gives the `name()` of its contract in
		// cowprotocol/euler-integration-contracts, which lists no addresses itself.
		bundles: [
			"0x64c26b3a182826fe2ab8c04c8caf40b0c4bf9a66",
			"0x4f4ce927188637b4a1d91350c3114f4bd301dd02",
			"0xcc054cd4b814a2caeb63c6f6a446435480a383f3",
		],
	},
	overrides: [
		// Rizzolver: the address of its Base entry, allow-listed on BNB Chain too. The CMS lists it
		// (prod, active) for Ethereum only and, for BNB Chain, only a retired one, as for Base;
		// Dune's Spellbook lists it as Rizzolver on BNB Chain (cow_protocol_bnb_solvers).
		{
			address: "0x8f5835e9d756c9bd934bce527157a4b0ef3c5cb7",
			solverId: "rizzolver",
			name: "Rizzolver",
		},
		// Fractal: allow-listed on BNB Chain, where CoW's competition data names it as the winning
		// solver of the auctions it settles, e.g. through Euler's open-position bundle in tx
		// 0x4b61e1649a3e48af1b1a5b5a36a91e87e6436ec361b4b428a24a9c6fd5080e07. The CMS lists it
		// (prod, active) for Ethereum only, as does Dune's Spellbook (cow_protocol_ethereum_solvers).
		{
			address: "0x95480d3f27658e73b2785d30beb0c847d78294c7",
			solverId: "fractal",
			name: "Fractal",
		},
	],
};

export const NETWORKS: Record<NetworkId, Network> = { base: BASE, bnb: BNB };
