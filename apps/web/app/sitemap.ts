import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { siteUrl } from "@/lib/site";
import { loadSnapshot } from "@/lib/snapshot";

/**
 * The site is one page, as of the snapshot's newest block. Rendered per request: `SITE_URL` is a
 * Worker variable, which `next build` does not see. Search engines ignore changefreq and priority.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	await connection();
	const result = await loadSnapshot();
	return [
		{
			url: new URL("/", siteUrl()).href,
			...(result.ok && { lastModified: new Date(result.snapshot.end.time) }),
		},
	];
}
