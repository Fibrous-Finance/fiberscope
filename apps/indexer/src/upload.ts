import type { R2Target } from "./config.ts";

const TIMEOUT_MS = 60_000;

/** Uploads the snapshot JSON to R2 through the Cloudflare API, replacing the previous one. */
export async function uploadSnapshot(target: R2Target, json: string): Promise<void> {
	// The API takes the slashes of a key literally; everything else is percent-encoded.
	const key = target.key.split("/").map(encodeURIComponent).join("/");
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/r2/buckets/${target.bucket}/objects/${key}`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${target.token}`,
				"Content-Type": "application/json",
			},
			body: json,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		}
	);
	if (!response.ok) {
		throw new Error(`R2 answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
	}
}
