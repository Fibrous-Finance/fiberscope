import { useLocale } from "next-intl";

import { createFormat } from "@fiberscope/core";
import type { Format } from "@fiberscope/core";

const formats: Record<string, Format> = {};

/** The page's formatters for the active locale. */
export function useFormat(): Format {
	const locale = useLocale();
	formats[locale] ??= createFormat(locale);
	return formats[locale];
}
