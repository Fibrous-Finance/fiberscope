import type { Metadata } from "next";
import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { Footer } from "@/components/frame/Footer";
import { Header } from "@/components/frame/Header";
import { arrow } from "@/components/ui/Section";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("Meta");
	// Next.js marks not-found responses noindex itself; a robots field here or inherited from the
	// layout would add a second tag.
	return { title: t("notFoundTitle"), robots: null };
}

/**
 * The page of no network: it loads no data, so its header has no data status and a "Networks"
 * menu with no current row, and its footer names the page's code version alone.
 */
export default async function NotFound() {
	const t = await getTranslations("NotFound");

	return (
		<>
			<Header />
			{/* A block-level child, not a flex item: auto margins would shrink it; `page` is content-box. */}
			<div className="page flex min-h-[calc(100dvh-61px)] flex-col">
				<main className="pt-[clamp(72px,12vw,168px)] pb-[clamp(72px,10vw,128px)]">
					<p className="eyebrow">{t("eyebrow")}</p>
					<h1 className="mt-[18px] max-w-[19ch] headline">{t("headline")}</h1>
					<p className="mt-6 max-w-[560px] answer">{t("text")}</p>
					<Link href="/" className="mt-9 btn-teal gap-2.5">
						{t.rich("back", { arrow })}
					</Link>
				</main>
				<Footer away />
			</div>
		</>
	);
}
