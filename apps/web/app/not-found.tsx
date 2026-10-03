import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getTranslations } from "next-intl/server";

import { Footer } from "@/components/frame/Footer";
import { Header } from "@/components/frame/Header";
import { arrow } from "@/components/ui/Section";

import { loadSnapshot } from "@/lib/snapshot";
import { dataStatus } from "@/lib/status";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("Meta");
	// Next.js marks not-found responses noindex itself; a robots field here or inherited from the
	// layout would add a second tag.
	return { title: t("notFoundTitle"), robots: null };
}

export default async function NotFound() {
	// Per request, not prerendered: the header shows how fresh the data is right now.
	await connection();
	const t = await getTranslations("NotFound");
	const result = await loadSnapshot();

	return (
		<>
			<Header status={dataStatus(result, result.at)} away />
			{/* A block, not a flex item: auto margins would shrink it, and `page` is content-box. */}
			<div className="page flex min-h-[calc(100dvh-61px)] flex-col">
				<main className="pt-[clamp(72px,12vw,168px)] pb-[clamp(72px,10vw,128px)]">
					<p className="eyebrow">{t("eyebrow")}</p>
					<h1 className="mt-[18px] max-w-[19ch] headline">{t("headline")}</h1>
					<p className="mt-6 max-w-[560px] answer">{t("text")}</p>
					<Link href="/" className="mt-9 btn-teal">
						{t.rich("back", { arrow })}
					</Link>
				</main>
				<Footer away />
			</div>
		</>
	);
}
