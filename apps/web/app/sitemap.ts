import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { SITE_NETWORKS } from "@/lib/networks";
import { siteUrl } from "@/lib/site";
import { loadSnapshot } from "@/lib/snapshot";

/**
 * Each listed network's page, as of its snapshot's newest block; an unlisted network's page stays
 * out until its launch. Rendered per request: `SITE_URL` is a Worker variable, which `next build`
 * does not see. Search engines ignore changefreq and priority.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	await connection();
	return Promise.all(
		Object.values(SITE_NETWORKS)
			.filter((network) => network.listed)
			.map(async (network) => {
				const result = await loadSnapshot(network.id);
				return {
					url: new URL(network.path, siteUrl()).href,
					...(result.ok && { lastModified: new Date(result.snapshot.end.time) }),
				};
			})
	);
}
