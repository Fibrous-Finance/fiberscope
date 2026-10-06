import { headers } from "next/headers";

import { Dashboard } from "@/components/dashboard/Dashboard";

import { looksLikePhone } from "@/lib/device";
import { parseSelection } from "@/lib/selection";
import { siteUrl } from "@/lib/site";
import { loadSnapshot } from "@/lib/snapshot";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
	const [result, params, request] = await Promise.all([loadSnapshot(), searchParams, headers()]);
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
			<Dashboard
				result={result}
				selection={parseSelection(params)}
				phone={looksLikePhone(request)}
			/>
		</>
	);
}
