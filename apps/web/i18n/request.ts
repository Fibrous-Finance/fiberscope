import { getRequestConfig } from "next-intl/server";

import en from "../messages/en";

/**
 * English only for now. To add a language, add `messages/<locale>/`, list it here and in
 * global.d.ts `Locale`, and pick the locale per request (a cookie or a `[locale]` segment); the
 * page's copy already goes through next-intl.
 */
const MESSAGES = { en };

export default getRequestConfig(async () => {
	const locale = "en";
	return { locale, timeZone: "UTC", messages: MESSAGES[locale] };
});
