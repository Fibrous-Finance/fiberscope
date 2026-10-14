/**
 * Appearance: Auto follows the system; Light and Dark pin a theme. `themeScript` applies the saved
 * choice before first paint, so the page never flashes the wrong theme. Every later change, from
 * the appearance button, the system or another tab, goes through `showAppearance`.
 */

export type Appearance = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const APPEARANCES: readonly Appearance[] = ["auto", "light", "dark"];
const STORAGE_KEY = "fiberscope.appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** `<meta name="theme-color">` follows the active background. */
const BACKGROUND: Record<Theme, string> = { light: "#F7F8F8", dark: "#1B1F2C" };
const CHANGE_EVENT = "fiberscope:appearance";
/**
 * Holds every transition while the theme changes. Rows, bars, dots and links fade their colors on
 * hover; without this, those fades would also run on a theme change, each at its own speed, while
 * the rest of the page switched at once. Running transitions, such as the mosaic's intro, go on.
 */
const HOLD_TRANSITIONS =
	"*,*::before,*::after{transition-duration:0s!important;transition-delay:0s!important}";

/**
 * Inline in `<head>`: mirrors `applyTheme` for the saved choice, before React loads. It sets
 * data-theme in Auto too, to the system's theme, so the colors change only when this code says so:
 * CSS that followed the system by itself would recolor before transitions could be held.
 */
export const themeScript = `(()=>{var p;try{p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)})}catch(e){}var t=p==="light"||p==="dark"?p:matchMedia(${JSON.stringify(DARK_QUERY)}).matches?"dark":"light";document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?${JSON.stringify(BACKGROUND.dark)}:${JSON.stringify(BACKGROUND.light)})})()`;

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

/** Recolors the page in one frame. */
function applyTheme(theme: Theme): void {
	const hold = document.createElement("style");
	hold.textContent = HOLD_TRANSITIONS;
	document.head.append(hold);
	document.documentElement.dataset.theme = theme;
	document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BACKGROUND[theme]);
	// The next frame recolors the page with transitions held; the one after releases them.
	requestAnimationFrame(() => requestAnimationFrame(() => hold.remove()));
}

/** Counts theme changes, so a fade still waiting to start can tell that a later change came. */
let changes = 0;
/** The theme a fade that has not recolored the page yet is heading for. */
let fadingTo: Theme | null = null;

/**
 * Changes the theme on screen, if the appearance changes it: the old page fades into the new one
 * as a single picture, for as long as globals.css says. With reduced motion, while the page is
 * hidden, or in browsers without view transitions, it changes in one frame.
 */
function showAppearance(appearance: Appearance): void {
	const theme = appearance === "auto" ? systemTheme() : appearance;
	// Auto and the pinned theme it matches look the same; each subscriber also reports a system
	// change, so the same theme can be asked for twice.
	if ((fadingTo ?? document.documentElement.dataset.theme) === theme) return;
	const change = ++changes;
	const fade =
		typeof document.startViewTransition === "function" &&
		document.visibilityState === "visible" &&
		!window.matchMedia(REDUCED_MOTION_QUERY).matches;
	if (!fade) {
		fadingTo = null;
		applyTheme(theme);
		return;
	}
	fadingTo = theme;
	const transition = document.startViewTransition(() => {
		// The browser runs this even for a fade it skipped; the latest change wins.
		if (change !== changes) return;
		fadingTo = null;
		applyTheme(theme);
	});
	// The browser skips a fade when another one starts or the page is hidden. The theme changes
	// all the same, so the rejected `ready` is expected.
	transition.ready.catch(() => {});
}

export function saveAppearance(appearance: Appearance): void {
	try {
		localStorage.setItem(STORAGE_KEY, appearance);
	} catch {
		// Private mode or blocked storage: the choice lasts for this page only.
	}
	showAppearance(appearance);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For `useSyncExternalStore`: the saved choice, other tabs, and live system changes in Auto. */
export function subscribeAppearance(onChange: () => void): () => void {
	const media = window.matchMedia(DARK_QUERY);
	const onSystem = () => {
		if (readAppearance() === "auto") showAppearance("auto");
		onChange();
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== STORAGE_KEY) return;
		showAppearance(readAppearance());
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
