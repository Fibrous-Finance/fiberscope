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

/** Columns that need auction data: "Volume†" when it covers only part of the window. */
const AUCTION_COLUMNS: Partial<Record<SortKey, true>> = {
	volume: true,
	participation: true,
	winRate: true,
};

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

/**
 * The table's header labels: the auction columns end in "†" when auction data covers only part
 * of the window. Copy as Markdown uses them too, so a pasted table keeps its footnote mark.
 */
export function useHeaderLabels(partial: boolean): Record<SortKey, string> {
	const t = useTranslations("Winning.columns");
	const labels = useColumnLabels();
	return Object.fromEntries(
		COLUMNS.map((key) => [
			key,
			partial && AUCTION_COLUMNS[key] ? t("partial", { label: labels[key] }) : labels[key],
		])
	) as Record<SortKey, string>;
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
