import type { NetworkId } from "../networks.ts";
import type { AuctionDetails } from "./details.ts";
import type { SurplusCost, SurplusCostFigures } from "./surplus.ts";
import { DAY_MS } from "./view.ts";
import type { Measure, Row, View } from "./view.ts";

/**
 * The leaderboard's exports, Download CSV and Copy as Markdown, and the days each source covers
 * in them. The CSV says so on every row with ISO 8601 UTC instants, so a file keeps it without
 * breaking parsers; the Markdown with a mark after each partly covered column and a footnote per
 * mark. The CSV is machine-readable, so the same in every language; the page writes the Markdown
 * in its own words from `ExportCoverage`. Every CSV row also names its network, so files of two
 * networks, whose solver ids are the same, can be merged into one table.
 */

/** A coverage footnote of the Markdown: which one, over how many of the window's days. */
interface ExportFootnote {
	/**
	 * One footnote per mark: a source that covers the same days as an earlier one shares its mark
	 * and its footnote ("auctionAndSurplus", "auctionSurplusAndDetail", "surplusAndDetail" …).
	 */
	key:
		| "auction"
		| "auctionAndSurplus"
		| "auctionAndDetail"
		| "auctionSurplusAndDetail"
		| "surplus"
		| "surplusAndDetail"
		| "detail";
	covered: number;
}

export interface ExportCoverage {
	/** Start of the window (Unix ms). */
	start: number;
	/** End of the window: the newest block in the data (Unix ms). */
	end: number;
	/**
	 * Where the auction data starts: volume, entered, win rate and batch value cover it to `end`.
	 * `start` when it covers the whole window; null when the window has none.
	 */
	auctionFrom: number | null;
	/** Where the surplus data starts, as `auctionFrom`: every surplus column covers it to `end`. */
	surplusFrom: number | null;
	/**
	 * Where the auction details start, as `auctionFrom`: solutions, close losses, quotes and fees
	 * cover it to `end`.
	 */
	detailFrom: number | null;
	/**
	 * The marks after the partly covered columns, empty where a source covers the whole window:
	 * "†" after Volume, Entered and Win rate; after the surplus columns "†" as well when surplus
	 * covers the same days, "‡" when it covers fewer; after the auction-detail columns the mark of
	 * the source that covers the same days, "§" when none does.
	 */
	marks: { auction: "" | "†"; surplus: "" | "†" | "‡"; detail: "" | "†" | "‡" | "§" };
	/** One per mark, "†" first. */
	footnotes: ExportFootnote[];
}

export function exportCoverage(
	view: View,
	figures: SurplusCost,
	details: AuctionDetails
): ExportCoverage {
	const end = view.end.time;
	const auction = view.coverage.auction;
	const surplus = figures.coverage.surplus;
	const detail = details.coverage;
	const from = (days: number) => (days > 0 ? end - days * DAY_MS : null);
	const auctionMark = auction < view.days ? "†" : "";
	const surplusMark = surplus >= view.days ? "" : surplus === auction ? auctionMark : "‡";
	// Partly covered details mean partly covered auction data and surplus too (they never cover
	// more), so matching days always match a mark.
	const detailMark =
		detail >= view.days ? "" : detail === auction ? "†" : detail === surplus ? "‡" : "§";
	const footnotes: ExportFootnote[] = [];
	if (auctionMark !== "") {
		const withSurplus = surplusMark === "†";
		const withDetail = detailMark === "†";
		const key = withSurplus
			? withDetail
				? "auctionSurplusAndDetail"
				: "auctionAndSurplus"
			: withDetail
				? "auctionAndDetail"
				: "auction";
		footnotes.push({ key, covered: auction });
	}
	if (surplusMark === "‡") {
		const key = detailMark === "‡" ? "surplusAndDetail" : "surplus";
		footnotes.push({ key, covered: surplus });
	}
	if (detailMark === "§") footnotes.push({ key: "detail", covered: detail });
	return {
		start: view.start,
		end,
		auctionFrom: from(auction),
		surplusFrom: from(surplus),
		detailFrom: from(detail),
		marks: { auction: auctionMark, surplus: surplusMark, detail: detailMark },
		footnotes,
	};
}

/**
 * A solver's surplus as the exports report it: null without surplus trades in the covered days,
 * where "$0" would read as trades that beat none of their limits.
 */
export function exportedSurplus(figures: SurplusCostFigures | undefined): number | null {
	return figures?.surplusTrades ? figures.surplus : null;
}

const CSV_COLUMNS = [
	"rank",
	"solver",
	"share_pct",
	"batches",
	"trades",
	"volume_usd",
	"gas_per_trade",
	"cost_usd",
	"cost_per_trade_usd",
	"dex_swaps_per_trade",
	"avg_batch_value_usd",
	"trades_per_batch",
	"entered_pct",
	"win_rate_pct",
	"surplus_usd",
	"surplus_per_trade_usd",
	"surplus_bps",
	"typical_surplus_per_trade_usd",
	"typical_surplus_bps",
	"unusual_surplus_share",
	"solutions",
	"filtered_out_share",
	"close_loss_share",
	"quotes",
	"quotes_share",
	"quotes_verified_share",
	"quotes_settled_share",
	"protocol_fees_usd",
	"partner_fees_usd",
	"window_start_utc",
	"window_end_utc",
	"auction_data_from_utc",
	"surplus_data_from_utc",
	"detail_data_from_utc",
	"network",
];

/**
 * The leaderboard as CSV, its rows in the given order, ranked by `measure`: a row without any of
 * it has no rank. Money keeps its cents (cost per trade to four decimals); volume, batch value and
 * gas are whole. `_pct` columns are percentages; `_share` columns are 0–1 fractions to three
 * decimals, `filtered_out_share` and `quotes_share` to four, the tenth of a percent the page gives
 * them in. Solutions and quotes are counts over the detail days, and fees are on the trades the
 * solver settled. The five columns before the last say which days the others cover; an empty
 * "from" means the source has no data in the window, and the columns it feeds are empty. The last,
 * `network`, is the id of the network the rows come from (`base`, `bnb`), the same on every row.
 */
export function leaderboardCsv(
	rows: readonly Row[],
	measure: Measure,
	figures: SurplusCost,
	details: AuctionDetails,
	coverage: ExportCoverage,
	network: NetworkId
): string {
	// A value to `digits` decimals once scaled (a 0.42 share is 42.00 in percent); empty if unknown.
	const decimals = (value: number | null | undefined, digits: number, scale = 1) =>
		value === null || value === undefined ? "" : (value * scale).toFixed(digits);
	// ISO 8601 UTC to the second, as block times are: 2026-10-03T15:21:51Z.
	const window = [
		coverage.start,
		coverage.end,
		coverage.auctionFrom,
		coverage.surplusFrom,
		coverage.detailFrom,
	].map((ms) => (ms === null ? "" : new Date(ms).toISOString().replace(".000Z", "Z")));
	const lines = rows.map((row) => {
		const own = figures.rows.get(row.id);
		// Without surplus trades, none of the surplus figures exists.
		const surplus = exportedSurplus(own) === null ? undefined : own;
		// Without auction details in the window, none of their figures exists.
		const detail = details.coverage > 0 ? details.solvers.get(row.id) : undefined;
		return [
			row.ranks[measure] ?? "",
			`"${row.label.replaceAll('"', '""')}"`,
			decimals(row.shares[measure], 2, 100),
			row.batches,
			row.trades,
			decimals(row.volume, 0),
			decimals(row.gasPerTrade, 0),
			decimals(own?.cost, 2),
			decimals(own?.costPerTrade, 4),
			decimals(row.swapsPerTrade, 2),
			decimals(row.batchValue, 0),
			decimals(row.tradesPerBatch, 2),
			decimals(row.participation, 1, 100),
			decimals(row.winRate, 1, 100),
			decimals(surplus?.surplus, 2),
			decimals(surplus?.surplusPerTrade, 2),
			decimals(surplus?.surplusRate, 1, 10_000),
			decimals(surplus?.typicalSurplusPerTrade, 2),
			decimals(surplus?.typicalSurplusRate, 1, 10_000),
			decimals(surplus?.unusualShare, 3),
			decimals(detail?.solutions, 0),
			decimals(detail?.filteredShare, 4),
			decimals(detail?.closeLossShare, 3),
			decimals(detail?.quotes, 0),
			decimals(detail?.quoteShare, 4),
			decimals(detail?.verifiedShare, 3),
			decimals(detail?.settledShare, 3),
			decimals(detail?.protocolFees, 2),
			decimals(detail?.partnerFees, 2),
			...window,
			network,
		].join(",");
	});
	return [CSV_COLUMNS.join(","), ...lines].join("\n");
}
