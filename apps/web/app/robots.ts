import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { isIndexable, siteUrl } from "@/lib/site";

/** Crawlers are welcome on the site's own host once indexing is on; everywhere else, kept out. */
export default async function robots(): Promise<MetadataRoute.Robots> {
	if (!isIndexable((await headers()).get("host"))) {
		return { rules: { userAgent: "*", disallow: "/" } };
	}
	return {
		rules: { userAgent: "*", allow: "/" },
		sitemap: new URL("/sitemap.xml", siteUrl()).href,
	};
}
