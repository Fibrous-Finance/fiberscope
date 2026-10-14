import { BASE } from "@fiberscope/core";

import { networkMetadata, NetworkPage } from "@/components/dashboard/NetworkPage";

import { siteUrl } from "@/lib/site";

export function generateMetadata() {
	return networkMetadata(BASE);
}

/** The home page: Base. */
export default function BasePage({ searchParams }: PageProps<"/">) {
	// The site's name in search results: Google reads it from WebSite data on the home page.
	const website = {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: "Fiberscope",
		url: new URL("/", siteUrl()).href,
	};
	return (
		<>
			<script
				type="application/ld+json"
				// "<" escaped, so no string can close the script element.
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(website).replace(/</g, "\\u003c"),
				}}
			/>
			<NetworkPage network={BASE} searchParams={searchParams} />
		</>
	);
}
