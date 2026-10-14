/**
 * Networks Fiberscope indexes. The page shows Base and its header lists the upcoming networks; the
 * indexer also covers BNB Chain. When another network goes live on the page, also update the copy
 * that names Base (`grep -rn Base apps/web/messages/en`), the README and the social image,
 * apps/web/public/og-image.png.
 */
export type NetworkId = "base" | "bnb";

export interface Network {
	id: NetworkId;
	name: string;
	chainId: number;
	/** CoW Protocol API root for this network. */
	cowApi: string;
	/** CoW Explorer path segment, as in `https://explorer.cow.fi/{slug}/tx/{hash}`. */
	explorerSlug: string;
	/** Block explorer root. */
	scan: string;
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
		/** Chainlink's proxy for the native token's USD price (8 decimals). */
		usdFeed: string;
	};
	contracts: {
		settlement: string;
		allowList: string;
		/** CoW's flash-loan router: it settles on behalf of the auction winner. */
		flashLoanRouter: string;
	};
}

export const BASE: Network = {
	id: "base",
	name: "Base",
	chainId: 8453,
	cowApi: "https://api.cow.fi/base",
	explorerSlug: "base",
	scan: "https://basescan.org",
	// Exactly: Base makes a block every 2 seconds.
	blockTime: 2,
	// Base's docs recommend ranges under 2,000 blocks.
	logRange: 2_000,
	// Auctions end 6–8 blocks after their start.
	sameAuctionBlocks: 10,
	native: {
		symbol: "ETH",
		wrapped: "0x4200000000000000000000000000000000000006",
		usdFeed: "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70",
	},
	contracts: {
		settlement: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
		allowList: "0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe",
		flashLoanRouter: "0x9da8b48441583a2b93e2ef8213aad0ec0b392c69",
	},
};

export const BNB: Network = {
	id: "bnb",
	name: "BNB Chain",
	chainId: 56,
	cowApi: "https://api.cow.fi/bnb",
	explorerSlug: "bnb",
	scan: "https://bscscan.com",
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
		usdFeed: "0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee",
	},
	contracts: {
		settlement: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
		allowList: "0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe",
		flashLoanRouter: "0x9da8b48441583a2b93e2ef8213aad0ec0b392c69",
	},
};

export const NETWORKS: Record<NetworkId, Network> = { base: BASE, bnb: BNB };
