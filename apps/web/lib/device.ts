/**
 * Whether a request most likely comes from a phone, so the server renders the compact layout
 * first instead of drawing the desktop one until the page loads. Phone browsers say "Mobile" in
 * their user agent, and Chromium also sends `Sec-CH-UA-Mobile: ?1`. Tablets and narrow desktop
 * windows still switch to compact on the client, as before.
 */
export function looksLikePhone(headers: Headers): boolean {
	if (headers.get("sec-ch-ua-mobile") === "?1") return true;
	return /\bMobile\b/.test(headers.get("user-agent") ?? "");
}
