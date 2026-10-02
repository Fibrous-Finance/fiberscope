import { useTranslations } from "next-intl";

import type { Format, Row, SortKey } from "@fiberscope/core";

/** The sortable columns, in table order. */
export const COLUMNS: readonly SortKey[] = [
	"share",
	"batches",
	"trades",
	"volume",
	"gas",
	"participation",
	"winRate",
];

/** Header labels of the sortable columns; the detail's stats use them too. */
export function useColumnLabels(): Record<SortKey, string> {
	const t = useTranslations("Winning.columns");
	const tc = useTranslations("Common.measureLabel");
	return {
		share: t("share"),
		batches: tc("batches"),
		trades: tc("trades"),
		volume: tc("volume"),
		gas: t("gas"),
		participation: t("participation"),
		winRate: t("winRate"),
	};
}

/** A sortable column's value as the table shows it. */
export function cellText(row: Row, key: SortKey, f: Format): string {
	switch (key) {
		case "share":
			return f.percent(row.share, 1);
		case "batches":
			return f.int(row.batches);
		case "trades":
			return f.int(row.trades);
		case "volume":
			return f.usd(row.volume);
		case "gas":
			return f.gas(row.gasPerTrade);
		case "participation":
			return f.percent(row.participation);
		case "winRate":
			return f.percent(row.winRate);
	}
}
