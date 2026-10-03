import { createHash, createHmac } from "node:crypto";

import type { R2Target } from "./config.ts";

const TIMEOUT_MS = 60_000;

/**
 * Uploads the snapshot JSON to R2 through its S3 API, replacing the previous one. S3 requests are
 * what a bucket-scoped R2 API token can sign; Cloudflare's own object API accepts only tokens with
 * write access to every bucket in the account.
 */
export async function uploadSnapshot(target: R2Target, json: string): Promise<void> {
	const body = Buffer.from(json);
	const host = `${target.accountId}.r2.cloudflarestorage.com`;
	const path = `/${target.bucket}/${target.key.split("/").map(encodeSegment).join("/")}`;
	const headers = sign(target, "PUT", host, path, body, new Date());
	const response = await fetch(`https://${host}${path}`, {
		method: "PUT",
		headers,
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) {
		throw new Error(`R2 answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
	}
}

/**
 * The headers of an S3 request signed with AWS Signature Version 4, in R2's region `auto`. Host
 * is signed but not returned: fetch sends it from the URL.
 */
function sign(
	target: R2Target,
	method: string,
	host: string,
	path: string,
	body: Buffer,
	now: Date
): Record<string, string> {
	const stamp = now
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
	const scope = `${stamp.slice(0, 8)}/auto/s3/aws4_request`;
	const payload = sha256(body);
	const headers: Record<string, string> = {
		"content-type": "application/json",
		"x-amz-content-sha256": payload,
		"x-amz-date": stamp,
	};
	const signed: Record<string, string> = { ...headers, host };
	const names = Object.keys(signed).sort();
	const request = [method, path, "", ...names.map((name) => `${name}:${signed[name]}`), ""];
	const canonical = [...request, names.join(";"), payload].join("\n");
	const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
	let key = hmac(`AWS4${target.secretAccessKey}`, stamp.slice(0, 8));
	for (const part of ["auto", "s3", "aws4_request"]) key = hmac(key, part);
	const signature = hmac(key, toSign).toString("hex");
	return {
		...headers,
		authorization:
			`AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${scope}, ` +
			`SignedHeaders=${names.join(";")}, Signature=${signature}`,
	};
}

/** A key segment as S3 canonicalizes it: RFC 3986, so also !'()* are percent-encoded. */
function encodeSegment(segment: string): string {
	return encodeURIComponent(segment).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

function sha256(data: string | Buffer): string {
	return createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
	return createHmac("sha256", key).update(data).digest();
}
