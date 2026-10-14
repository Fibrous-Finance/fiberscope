import type { Metadata } from "next";
import { headers } from "next/headers";

import { getTranslations } from "next-intl/server";

import type { Network, NetworkId } from "@fiberscope/core";

import { Dashboard } from "@/components/dashboard/Dashboard";

import { looksLikePhone } from "@/lib/device";
import { parseSelection } from "@/lib/selection";
import { loadSnapshot } from "@/lib/snapshot";

/** The networks with a social image of their own (in public/): Base's names Base. */
const SOCIAL_IMAGE: Partial<Record<NetworkId, string>> = { base: "/og-image.png" };

/** A network's page: the overview of its data, in the view its query string selects. */
export async function NetworkPage({
	network,
	searchParams,
}: {
	network: Network;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [result, params, request] = await Promise.all([
		loadSnapshot(network.id),
		searchParams,
		headers(),
	]);
	return (
		<Dashboard
			network={network.id}
			result={result}
			selection={parseSelection(params)}
			phone={looksLikePhone(request)}
		/>
	);
}

/**
 * A network's page title, description and link previews. Period, measure and solver live in the
 * query string; the network's page itself is one, so its path is the canonical address.
 */
export async function networkMetadata(network: Network): Promise<Metadata> {
	const t = await getTranslations("Meta");
	const values = { network: network.name };
	const title = t("title", values);
	const description = t("ogDescription", values);
	const url = SOCIAL_IMAGE[network.id];
	// metadataBase (in the layout) makes the URLs absolute.
	const images = url
		? [{ url, type: "image/png", width: 1200, height: 630, alt: t("ogImageAlt", values) }]
		: undefined;
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
		twitter: {
			card: images ? "summary_large_image" : "summary",
			title,
			description,
			images,
		},
	};
}
