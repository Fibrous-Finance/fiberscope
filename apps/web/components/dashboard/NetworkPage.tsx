import type { Metadata } from "next";
import { headers } from "next/headers";

import { getTranslations } from "next-intl/server";

import type { NetworkId } from "@fiberscope/core";

import { Dashboard } from "@/components/dashboard/Dashboard";

import { looksLikePhone } from "@/lib/device";
import { SITE_NETWORKS } from "@/lib/networks";
import { parseSelection } from "@/lib/selection";
import { loadSnapshot } from "@/lib/snapshot";

/** A network's page: the overview of its data, in the view its query string selects. */
export async function NetworkPage({
	network,
	searchParams,
}: {
	network: NetworkId;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [result, params, request] = await Promise.all([
		loadSnapshot(network),
		searchParams,
		headers(),
	]);
	return (
		<Dashboard
			network={network}
			result={result}
			selection={parseSelection(params)}
			phone={looksLikePhone(request)}
		/>
	);
}

/**
 * A network's page title, description and link previews, each with its own image. Period, measure
 * and solver live in the query string; the network's page itself is one, so its path is the
 * canonical address. An unlisted network's page is noindex, whatever the site allows.
 */
export async function networkMetadata(id: NetworkId): Promise<Metadata> {
	const [t, tn] = await Promise.all([getTranslations("Meta"), getTranslations("Header.network")]);
	const network = SITE_NETWORKS[id];
	const values = { network: tn(id) };
	const title = t("title", values);
	const description = t("ogDescription", values);
	// metadataBase (in the layout) makes the URL absolute.
	const images = [
		{
			url: network.image,
			type: "image/png",
			width: 1200,
			height: 630,
			alt: t("ogImageAlt", values),
		},
	];
	return {
		alternates: { canonical: network.path },
		title,
		description: t("description", values),
		openGraph: {
			title,
			description,
			url: network.path,
			type: "website",
			siteName: "Fiberscope",
			images,
		},
		twitter: { card: "summary_large_image", title, description, images },
		// Left out for a listed network, which keeps the layout's rule: a robots field here, even an
		// empty one, would replace it.
		...(!network.listed && { robots: { index: false } }),
	};
}
