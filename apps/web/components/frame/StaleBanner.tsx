"use client";

import { useTranslations } from "next-intl";

import type { HeaderStatus } from "@/components/frame/Header";

import { useFormat } from "@/lib/format";

/** Under the header while the indexer is behind. */
export function StaleBanner({ status }: { status: HeaderStatus }) {
	const t = useTranslations("Header.banner");
	const f = useFormat();
	return (
		<div
			role="status"
			className="border-b border-[color-mix(in_oklab,var(--warn)_28%,transparent)] bg-[color-mix(in_oklab,var(--warn)_10%,var(--bg))]"
		>
			<div className="page flex flex-wrap items-center gap-x-4 gap-y-1.5 py-[11px] text-[13.5px] leading-[1.45]">
				<span className="flex items-center gap-2 font-mono text-[11.5px] font-medium tracking-[.07em] text-warn uppercase">
					<span className="size-[7px] rounded-full bg-current" />
					{t("label")}
				</span>
				<span>
					{t("text", {
						time: status.lastRunAt === null ? "" : f.time(status.lastRunAt),
						minutes: status.delayMinutes,
					})}
				</span>
				<span className="ml-auto font-mono text-[12px] font-medium text-mu">
					{t("retrying")}
				</span>
			</div>
		</div>
	);
}
