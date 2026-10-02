import { decodeSymbol } from "./abi.ts";
import { ethCall, SELECTOR } from "./chain.ts";
import { NATIVE_ETH } from "./config.ts";
import { log, shortAddress } from "./log.ts";
import { describeError } from "./pacer.ts";
import type { Rpc } from "./rpc.ts";
import type { Store } from "./store.ts";

/**
 * Token symbols via ERC-20 `symbol()`, cached in the database. A token whose call reverts or
 * returns no text is cached under its shortened address; if the RPC itself fails, the missing
 * symbols fall back to shortened addresses without being cached.
 */
export async function resolveSymbols(
	rpc: Rpc,
	store: Store,
	tokens: string[]
): Promise<Map<string, string>> {
	const symbols = store.symbols();
	symbols.set(NATIVE_ETH, "ETH");
	const missing = [...new Set(tokens)].filter((token) => !symbols.has(token));
	if (missing.length === 0) return symbols;
	try {
		const outcomes = await rpc.batch(
			missing.map((token) => ethCall(token, SELECTOR.symbol, "latest"))
		);
		const found = new Map<string, string>();
		outcomes.forEach((outcome, i) => {
			const symbol = outcome.ok ? decodeSymbol(outcome.result as string) : null;
			found.set(missing[i], symbol ?? shortAddress(missing[i]));
		});
		store.saveSymbols(found);
		for (const [token, symbol] of found) symbols.set(token, symbol);
	} catch (error) {
		log(`symbols: ${missing.length} unresolved (${describeError(error)})`);
	}
	return symbols;
}
