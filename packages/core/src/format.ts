/**
 * Number and date formatting for the page, e.g. "$4.87M", "644K", "46.9%", "2 Oct"; separators,
 * compact suffixes and month names come from the locale.
 * Every date and time is in UTC.
 */

/** Shown wherever a value is unknown. */
export const DASH = "—";
const NBSP = "\u00a0";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface Format {
	locale: string;
	/** 3,652 */
	int(value: number): string;
	/** A plain decimal with fixed digits: 1.05, 8.0 */
	fixed(value: number, digits: number): string;
	/** $4.87M · $286K · $53.0K · $3.56K · $56 · <$1 */
	usd(value: number | null): string;
	/** Dollars with cents under $100, for surplus: $36.40 · $0.08 · <$0.01; from $100 as `usd` */
	usdCents(value: number | null): string;
	/** Whole dollars with separators, for totals in sentences: $583,649 */
	usdWhole(value: number | null): string;
	/** Transaction cost in cents under a dollar: 0.7¢ · 1.8¢ · 12¢ · <0.1¢; then $1.24 */
	cost(value: number | null): string;
	/** A 0–1 ratio in basis points, whole and separated: 65 · 4,201 */
	bps(ratio: number | null): string;
	/** Gas units: 644K · 1.37M */
	gas(units: number | null): string;
	/** A 0–1 ratio as a percentage: 46.9%. Only 0 and 1 show as 0% and 100%: <1%, >99%. */
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
	/** An age of `ms` milliseconds, in the unit a reader would use: 47 minutes ago · 8 hours ago */
	ago(ms: number): string;
	/**
	 * The time every figure is as of: "09:49 UTC" on the same UTC day as `now`, otherwise
	 * "3 Oct, 09:49 UTC". No-break spaces keep "3 Oct" and "09:49 UTC" on one line.
	 */
	asOf(ms: number, now: number): string;
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
	const wholeUsd = number({ style: "currency", currency: "USD", maximumFractionDigits: 0 });
	const centsUsd = number({
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
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
	const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" });

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
	const usd = (value: number | null): string => {
		if (value === null) return DASH;
		// Each tier starts where the one below would round up into it, so 999,600 reads
		// "$1.00M", not "$1M", and 999.60 reads "$1.00K", not "$1,000".
		if (value >= 999_500) return usd2.format(Math.max(value, 1e6));
		if (value >= 99_950) return usd0.format(Math.max(value, 1e5));
		if (value >= 9_995) return usd1.format(Math.max(value, 1e4));
		if (value >= 999.5) return usd2.format(Math.max(value, 1e3));
		// A positive amount under a dollar would otherwise round to "$0" or "$1".
		if (value > 0 && value < 1) return `<${wholeUsd.format(1)}`;
		return wholeUsd.format(Math.max(0, value));
	};
	const usdCents = (value: number | null): string => {
		if (value === null) return DASH;
		if (value < 0) return `−${usdCents(-value)}`;
		if (value === 0) return wholeUsd.format(0);
		// Under half a cent, two decimals would print "$0.00".
		if (value < 0.005) return `<${centsUsd.format(0.01)}`;
		// Where cents would round up to "$100.00", whole dollars take over.
		return Number(value.toFixed(2)) < 100 ? centsUsd.format(value) : usd(value);
	};

	return {
		locale,
		int: (value) => integer.format(value),
		fixed,
		usd,
		usdCents,
		usdWhole: (value) => (value === null ? DASH : wholeUsd.format(value)),
		cost(value) {
			if (value === null) return DASH;
			if (value <= 0) return "0¢";
			const cents = Math.round(value * 1e6) / 1e4;
			if (cents < 0.05) return `<${fixed(0.1, 1)}¢`;
			// Each step starts where the one below would round up into it: 9.96¢ reads "10¢".
			if (Number(cents.toFixed(1)) < 10) return `${fixed(cents, 1)}¢`;
			if (Math.round(cents) < 100) return `${integer.format(Math.round(cents))}¢`;
			return usdCents(value);
		},
		bps: (ratio) => (ratio === null ? DASH : integer.format(Math.round(ratio * 10_000))),
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
			// A solver that won a few auctions did not win "0%" of them, and one that missed a
			// few did not enter "100%".
			const step = 10 ** -(digits + 2);
			if (ratio > 0 && ratio < step / 2) return `<${f.format(step)}`;
			if (ratio < 1 && ratio >= 1 - step / 2) return `>${f.format(1 - step)}`;
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
		ago(ms) {
			// Minutes under an hour, rounded hours under 36 hours, then rounded days.
			const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
			if (minutes < 60) return relative.format(-minutes, "minute");
			if (minutes < 36 * 60) return relative.format(-Math.round(minutes / 60), "hour");
			return relative.format(-Math.round(minutes / (24 * 60)), "day");
		},
		asOf(ms, now) {
			const time = `${hm.format(ms)}${NBSP}UTC`;
			if (Math.floor(ms / DAY_MS) === Math.floor(now / DAY_MS)) return time;
			return `${day(ms).replaceAll(" ", NBSP)}, ${time}`;
		},
	};
}

/** 0x0123456789abcdef0123456789abcdef01234567 → 0x0123…4567 */
export function shortAddress(address: string): string {
	return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** A longer form for narrow layouts that still shows the full address elsewhere: 0x012345…234567 */
export function mediumAddress(address: string): string {
	return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
