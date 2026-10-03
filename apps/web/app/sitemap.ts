import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/** The site is one page; its figures change every 10 minutes. */
export default function sitemap(): MetadataRoute.Sitemap {
	return [{ url: new URL("/", siteUrl()).href, changeFrequency: "hourly", priority: 1 }];
}
