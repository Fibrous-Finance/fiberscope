import { useTranslations } from "next-intl";

import { DASH } from "@fiberscope/core";
import type { Format, Measure, Row, SortKey } from "@fiberscope/core";

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

/** The columns after the share, which `cellText` writes. */
export const VALUE_COLUMNS = COLUMNS.filter(
	(key): key is Exclude<SortKey, "share"> => key !== "share"
);

/** Columns that need auction data: "Volume†" when it covers only part of the window. */
export const AUCTION_COLUMNS: Partial<Record<SortKey, true>> = {
	volume: true,
	participation: true,
	winRate: true,
};

/** The leaderboard's footnote that explains "†", which every marked figure points to. */
export const WHO_FOOTNOTE = "fn-who";

/** Header labels of the sortable columns; the detail's stats and Copy as Markdown use them too. */
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
 * The table's header labels: the auction columns end in "†" when auction data does not cover
 * the whole window.
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

/**
 * The # column, in the table, the compact list and Copy as Markdown: the rank by the active
 * measure, "—" for a row with none of it.
 */
export function rankText(row: Row, measure: Measure): string {
	return row.ranks[measure]?.toString() ?? DASH;
}

/**
 * The share column, in the table, the compact list, the detail and Copy as Markdown: the active
 * measure's share, "—" for a row with none of it, as its rank.
 */
export function shareText(row: Row, measure: Measure, f: Format): string {
	return f.percent(row.shares[measure], 1);
}

/** A value column as the table shows it. */
export function cellText(row: Row, key: Exclude<SortKey, "share">, f: Format): string {
	switch (key) {
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

/**
 * A filtered-out share as the detail and Copy as Markdown show it: one decimal, as small shares
 * need it ("2.9%"), but "0%" for none, which "0.0%" would read as rounded down.
 */
export function filteredText(share: number | null, f: Format): string {
	return share === 0 ? f.percent(0) : f.percent(share, 1);
}
