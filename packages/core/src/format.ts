/**
 * Number and date formatting for the page. The rules follow the design (e.g. "$4.87M", "644K",
 * "46.9%", "2 Oct"); separators, compact suffixes and month names come from the locale.
 * Every date and time is in UTC.
 */

/** Shown wherever a value is unknown. */
export const DASH = "—";

export interface Format {
	locale: string;
	/** 3,652 */
	int(value: number): string;
	/** A plain decimal with fixed digits: 1.05, 8.0 */
	fixed(value: number, digits: number): string;
	/** $4.87M · $286K · $53.0K · $3.56K · $56 */
	usd(value: number | null): string;
	/** Gas units: 644K · 1.37M */
	gas(units: number | null): string;
	/** A 0–1 ratio as a percentage: 46.9% */
	percent(ratio: number | null, digits?: number): string;
	/** Signed percentage points without the unit: +6.5 · −0.3 · ±0.0 */
	points(value: number): string;
	/** A multiple: 3.6× */
	times(value: number): string;
	/** 10:35 */
	time(ms: number): string;
	/** 10:34:52 */
	clock(ms: number): string;
	/** 2 Oct */
	day(ms: number): string;
	/** 1 Oct 22:10 */
	dayTime(ms: number): string;
	/** 2 Oct 2026 */
	date(ms: number): string;
}

/**
 * English day labels keep the short month "Sep": en-GB now abbreviates it "Sept", and en-US puts
 * the month first.
 */
const EN_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export function createFormat(locale: string): Format {
	const english = locale === "en" || locale.startsWith("en-");
	const number = (options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options);
	const dates = (options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });

	const integer = number({ maximumFractionDigits: 0 });
	const decimals = new Map<number, Intl.NumberFormat>();
	const percents = new Map<number, Intl.NumberFormat>();
	const usdCompact = (digits: number) =>
		number({
			style: "currency",
			currency: "USD",
			notation: "compact",
			minimumFractionDigits: digits,
			maximumFractionDigits: digits,
		});
	const usd2 = usdCompact(2);
	const usd1 = usdCompact(1);
	const usd0 = usdCompact(0);
	const usdWhole = number({ style: "currency", currency: "USD", maximumFractionDigits: 0 });
	const gasK = number({ notation: "compact", maximumFractionDigits: 0 });
	const gasM = number({
		notation: "compact",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const hm = dates({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	const hms = dates({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
	const dayMonth = dates({ day: "numeric", month: "short" });
	const dayMonthYear = dates({ day: "numeric", month: "short", year: "numeric" });

	const fixed = (value: number, digits: number) => {
		let f = decimals.get(digits);
		if (!f) {
			f = number({ minimumFractionDigits: digits, maximumFractionDigits: digits });
			decimals.set(digits, f);
		}
		return f.format(value);
	};
	const day = (ms: number) => {
		if (!english) return dayMonth.format(ms);
		const d = new Date(ms);
		return `${d.getUTCDate()} ${EN_MONTHS[d.getUTCMonth()]}`;
	};

	return {
		locale,
		int: (value) => integer.format(value),
		fixed,
		usd(value) {
			if (value === null) return DASH;
			if (value >= 1e6) return usd2.format(value);
			if (value >= 1e5) return usd0.format(value);
			if (value >= 1e4) return usd1.format(value);
			if (value >= 1e3) return usd2.format(value);
			return usdWhole.format(Math.max(0, value));
		},
		gas(units) {
			if (units === null) return DASH;
			// From 999.5K on, rounding to whole thousands would print "1000K".
			return units >= 999_500 ? gasM.format(Math.max(units, 1e6)) : gasK.format(units);
		},
		percent(ratio, digits = 0) {
			if (ratio === null) return DASH;
			let f = percents.get(digits);
			if (!f) {
				f = number({
					style: "percent",
					minimumFractionDigits: digits,
					maximumFractionDigits: digits,
				});
				percents.set(digits, f);
			}
			return f.format(ratio);
		},
		points(value) {
			const sign = value >= 0.05 ? "+" : value <= -0.05 ? "−" : "±";
			return sign + fixed(Math.abs(value), 1);
		},
		times: (value) => `${fixed(value, 1)}×`,
		time: (ms) => hm.format(ms),
		clock: (ms) => hms.format(ms),
		day,
		dayTime: (ms) => `${day(ms)} ${hm.format(ms)}`,
		date(ms) {
			if (!english) return dayMonthYear.format(ms);
			return `${day(ms)} ${new Date(ms).getUTCFullYear()}`;
		},
	};
}

/** 0x588ef3de…5e30 → 0x588e…5e30 */
export function shortAddress(address: string): string {
	return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** A longer form for narrow layouts that still shows the full address elsewhere: 0x588ef3…665e30 */
export function mediumAddress(address: string): string {
	return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
