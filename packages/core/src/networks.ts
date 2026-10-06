/**
 * Networks Fiberscope indexes. Only Base is live; the header lists the upcoming ones. When another
 * network goes live, also update the copy that names Base (`grep -rn Base apps/web/messages/en`),
 * the README and the social image, apps/web/public/og-image.png.
 */
export type NetworkId = "base";

export interface Network {
	id: NetworkId;
	chainId: number;
	/** CoW Protocol API root for this network. */
	cowApi: string;
	/** CoW Explorer path segment, as in `https://explorer.cow.fi/{slug}/tx/{hash}`. */
	explorerSlug: string;
	/** Block explorer root. */
	scan: string;
	/** Seconds between blocks; Base produces a block exactly every 2 seconds. */
	blockTime: number;
	/** Timestamp (Unix seconds) of block 0, so `time(block) = genesisTime + block × blockTime`. */
	genesisTime: number;
	contracts: {
		settlement: string;
		allowList: string;
		/** CoW's flash-loan router: it settles on behalf of the auction winner. */
		flashLoanRouter: string;
		/** Chainlink ETH/USD proxy (8 decimals). */
		ethUsdFeed: string;
	};
}

export const BASE: Network = {
	id: "base",
	chainId: 8453,
	cowApi: "https://api.cow.fi/base",
	explorerSlug: "base",
	scan: "https://basescan.org",
	blockTime: 2,
	genesisTime: 1686789347,
	contracts: {
		settlement: "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
		allowList: "0x2c4c28ddbdac9c5e7055b4c863b72ea0149d8afe",
		flashLoanRouter: "0x9da8b48441583a2b93e2ef8213aad0ec0b392c69",
		ethUsdFeed: "0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70",
	},
};

export const NETWORKS: Record<NetworkId, Network> = { base: BASE };
