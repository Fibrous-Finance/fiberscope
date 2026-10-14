import type { Metadata } from "next";
import { headers } from "next/headers";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import { isIndexable, siteUrl } from "@/lib/site";
import { themeScript } from "@/lib/theme";

import "./globals.css";

// The full Geist fonts, self-hosted (`--font-geist-sans`, `--font-geist-mono`). Google Fonts'
// Geist subsets lack →, ↗, ▲ and ▼, which would fall back to an oversized, metric-adjusted Arial.

/** What every page shares; each network's page adds its title, description and link previews. */
export async function generateMetadata(): Promise<Metadata> {
	const request = await headers();
	return {
		metadataBase: siteUrl(),
		icons: {
			icon: { url: "/favicon.svg", type: "image/svg+xml" },
			apple: "/apple-touch-icon.png",
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
