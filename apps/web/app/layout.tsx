import type { Metadata } from "next";
import { headers } from "next/headers";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { isIndexable, siteUrl } from "@/lib/site";
import { themeScript } from "@/lib/theme";

import "./globals.css";

// The full Geist fonts, self-hosted (`--font-geist-sans`, `--font-geist-mono`). Google Fonts'
// Geist subsets lack →, ↗, ▲ and ▼, which would fall back to an oversized, metric-adjusted Arial.

export async function generateMetadata(): Promise<Metadata> {
	const [t, request] = await Promise.all([getTranslations("Meta"), headers()]);
	// public/og-image.png; metadataBase makes the URL absolute.
	const image = {
		url: "/og-image.png",
		type: "image/png",
		width: 1200,
		height: 630,
		alt: t("ogImageAlt"),
	};
	return {
		metadataBase: siteUrl(),
		// Period, measure and solver live in the query string; the page itself is one.
		alternates: { canonical: "/" },
		title: t("title"),
		description: t("description"),
		icons: {
			icon: { url: "/favicon.svg", type: "image/svg+xml" },
			apple: "/apple-touch-icon.png",
		},
		openGraph: {
			title: t("title"),
			description: t("ogDescription"),
			// The canonical address; metadataBase makes it absolute.
			url: "/",
			type: "website",
			siteName: "Fiberscope",
			images: [image],
		},
		twitter: {
			card: "summary_large_image",
			title: t("title"),
			description: t("ogDescription"),
			images: [image],
		},
		// Indexable only on the site's own host, and only once the deployment sets ALLOW_INDEXING.
		robots: isIndexable(request.get("host")) ? undefined : { index: false },
	};
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
	const locale = await getLocale();
	return (
		// The theme script sets data-theme before React hydrates.
		<html
			lang={locale}
			className={`${GeistSans.variable} ${GeistMono.variable}`}
			suppressHydrationWarning
		>
			<head>
				<meta name="theme-color" content="#F7F8F8" />
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body>
				<NextIntlClientProvider>{children}</NextIntlClientProvider>
			</body>
		</html>
	);
}
