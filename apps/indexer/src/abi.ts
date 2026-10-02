/** Helpers for the few ABI shapes the indexer reads. */

/** The `index`-th 32-byte word of ABI-encoded data, as 64 hex digits without a prefix. */
export function word(data: string, index: number): string {
	const start = 2 + index * 64;
	const out = data.slice(start, start + 64);
	if (out.length !== 64) throw new Error(`ABI data has no word ${index}: ${data.slice(0, 80)}`);
	return out;
}

/** The address in the low 20 bytes of a word or topic, lowercase. */
export function wordAddress(hex: string): string {
	return `0x${hex.slice(-40)}`.toLowerCase();
}

/** A word or topic read as a two's-complement int256. */
export function int256(hex: string): bigint {
	return BigInt.asIntN(256, BigInt(hex.startsWith("0x") ? hex : `0x${hex}`));
}

/** A block number as an RPC quantity. */
export function hexBlock(block: number): string {
	return `0x${block.toString(16)}`;
}

/**
 * Decodes an ERC-20 `symbol()` result: an ABI string, or bytes32 for older tokens such as MKR.
 * Returns null when the result is neither or holds no printable text.
 */
export function decodeSymbol(data: string): string | null {
	const hex = data.startsWith("0x") ? data.slice(2) : data;
	let bytes: Buffer | null = null;
	if (hex.length >= 128) {
		const offset = Number.parseInt(hex.slice(0, 64), 16) * 2;
		const length = Number.parseInt(hex.slice(offset, offset + 64), 16) * 2;
		const start = offset + 64;
		if (offset % 64 === 0 && start + length <= hex.length) {
			bytes = Buffer.from(hex.slice(start, start + length), "hex");
		}
	} else if (hex.length === 64) {
		bytes = Buffer.from(hex, "hex");
	}
	if (bytes === null) return null;
	const text = new TextDecoder()
		.decode(bytes)
		.replace(/[\u0000-\u001f\u007f\ufffd]/g, "")
		.trim();
	return text === "" ? null : text.slice(0, 32);
}
