import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { isIndexable, siteUrl } from "@/lib/site";

/**
 * Crawlers may fetch every host, so they see the noindex on the hosts that are not to be indexed:
 * a page that robots.txt blocks keeps its noindex unread and can still be listed. The sitemap is
 * named only on the indexed host.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
	const indexable = isIndexable((await headers()).get("host"));
	return {
		rules: { userAgent: "*", allow: "/" },
		...(indexable && { sitemap: new URL("/sitemap.xml", siteUrl()).href }),
	};
}
