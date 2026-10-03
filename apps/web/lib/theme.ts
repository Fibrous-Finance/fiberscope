/**
 * Appearance: Auto follows the system; Light and Dark pin a theme. The choice is saved and applied
 * before first paint by `themeScript`, so the page never flashes the wrong theme.
 */

export type Appearance = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["auto", "light", "dark"];
const STORAGE_KEY = "fiberscope.appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";
/** `<meta name="theme-color">` follows the active background. */
const BACKGROUND: Record<Theme, string> = { light: "#F7F8F8", dark: "#1B1F2C" };
const CHANGE_EVENT = "fiberscope:appearance";

/** Inline in `<head>`: mirrors `applyAppearance` for the saved choice, before React loads. */
export const themeScript = `(()=>{try{var p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)}),d=document.documentElement;if(p==="light"||p==="dark")d.dataset.theme=p;var t=p==="light"||p==="dark"?p:matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?${JSON.stringify(BACKGROUND.dark)}:${JSON.stringify(BACKGROUND.light)})}catch(e){}})()`;

export function readAppearance(): Appearance {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		return saved === "light" || saved === "dark" ? saved : "auto";
	} catch {
		return "auto";
	}
}

export function systemTheme(): Theme {
	return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function applyAppearance(appearance: Appearance): void {
	const root = document.documentElement;
	if (appearance === "auto") delete root.dataset.theme;
	else root.dataset.theme = appearance;
	const theme = appearance === "auto" ? systemTheme() : appearance;
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BACKGROUND[theme]);
}

export function saveAppearance(appearance: Appearance): void {
	try {
		localStorage.setItem(STORAGE_KEY, appearance);
	} catch {
		// Private mode or blocked storage: the choice lasts for this page only.
	}
	applyAppearance(appearance);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For `useSyncExternalStore`: the saved choice, other tabs, and live system changes in Auto. */
export function subscribeAppearance(onChange: () => void): () => void {
	const media = window.matchMedia(DARK_QUERY);
	const onSystem = () => {
		if (readAppearance() === "auto") applyAppearance("auto");
		onChange();
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		applyAppearance(readAppearance());
		onChange();
	};
	media.addEventListener("change", onSystem);
	window.addEventListener("storage", onStorage);
	window.addEventListener(CHANGE_EVENT, onChange);
	return () => {
		media.removeEventListener("change", onSystem);
		window.removeEventListener("storage", onStorage);
		window.removeEventListener(CHANGE_EVENT, onChange);
	};
}
