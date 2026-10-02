import { useTranslations } from "next-intl";

import { Logo } from "@/components/frame/Logo";

/** The only place Fibrous appears, besides the disclosure in Methodology. */
export function Footer({ away }: { /** On pages other than the overview. */ away?: boolean }) {
	const t = useTranslations("Footer");
	return (
		<footer
			className={`${away ? "mt-auto" : "mt-[clamp(84px,10vw,128px)]"} flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-ln pt-7 pb-10 text-[13px] text-mu`}
		>
			<span className="flex items-baseline text-[15px] leading-none font-semibold tracking-[-0.04em] text-fg">
				<Logo />
			</span>
			<span>{t("tagline")}</span>
			<a href={away ? "/#method" : "#method"} className="quiet">
				{t("methodology")}
			</a>
			<a
				href="https://fibrous.finance"
				target="_blank"
				rel="noopener"
				className="ml-auto flex items-center gap-2 quiet"
			>
				<svg viewBox="0 0 100 100" aria-hidden="true" className="size-4">
					<path
						fill="#11bab5"
						d="M76.78 22.52A12.3 12.3 0 0 1 64.5 34.8H28.6a3.5 3.5 0 0 0 0 7h16.76a12.3 12.3 0 0 1 12.28 12.28 12.3 12.3 0 0 1-12.28 12.28H20.71a4.4 4.4 0 0 1 0-8.78h24.65a3.5 3.5 0 0 0 0-7H28.6A12.3 12.3 0 0 1 16.32 38.3 12.3 12.3 0 0 1 28.6 26.02h35.9a3.5 3.5 0 0 0 0-7H46.56a4.4 4.4 0 0 1 0-8.78H64.5a12.3 12.3 0 0 1 12.28 12.28m-56.07 50.9a8.42 8.42 0 1 0 .01 16.83 8.42 8.42 0 0 0-.01-16.83m0 11.94a3.54 3.54 0 1 1 .01-7.07 3.54 3.54 0 0 1-.01 7.07m9.16-70.73a4.39 4.39 0 1 1 8.78 0 4.39 4.39 0 0 1-8.78 0"
					/>
				</svg>
				{t("builtBy")}
			</a>
			<span className="basis-full text-[12.5px] text-fa">{t("independent")}</span>
		</footer>
	);
}
