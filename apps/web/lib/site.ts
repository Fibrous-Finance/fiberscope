/** The site's public address (`SITE_URL`): absolute URLs, the canonical link and the sitemap. */
export function siteUrl(): URL {
	return new URL(process.env.SITE_URL ?? "http://localhost:3000");
}

/**
 * Whether search engines may index a request: only when the deployment sets ALLOW_INDEXING=true
 * and the request reached the site's own host. PR previews and the workers.dev address of a
 * deployment with a custom domain stay noindex, so search results never show a copy.
 */
export function isIndexable(host: string | null): boolean {
	return process.env.ALLOW_INDEXING === "true" && host === siteUrl().host;
}
