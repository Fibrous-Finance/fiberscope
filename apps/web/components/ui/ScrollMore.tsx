"use client";

import { useEffect, useState } from "react";

/** How far a horizontal scroller is scrolled sideways. */
interface Scroll {
	/** Visible width of the scroller; 0 until measured. */
	width: number;
	/** Scrolled away from the left edge. */
	scrolled: boolean;
	/** Content continues past the right edge. */
	more: boolean;
}

const UNMEASURED: Scroll = { width: 0, scrolled: false, more: false };

/**
 * Follows a horizontal scroller: attach `ref` to it. `more` is true while its content continues
 * past the right edge; `scrolled` and `width` serve a table with pinned columns. All three update
 * on scroll and on resize, and a scroller that grows taller (rows added) counts as a resize.
 * Keyboard focus on a cell the edge cuts is scrolled into view, out from under the fade.
 */
export function useScrollMore(): Scroll & { ref: (node: HTMLElement | null) => void } {
	const [node, ref] = useState<HTMLElement | null>(null);
	const [scroll, setScroll] = useState(UNMEASURED);

	useEffect(() => {
		if (!node) return;
		const measure = () => {
			const width = node.clientWidth;
			const scrolled = node.scrollLeft > 1;
			const more = node.scrollLeft + width < node.scrollWidth - 1;
			setScroll((prev) =>
				prev.width === width && prev.scrolled === scrolled && prev.more === more
					? prev
					: { width, scrolled, more }
			);
		};
		// The observer also measures once when it starts.
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		// Chrome leaves a link that Tab reaches part-way past the edge where it is, under the fade.
		// Only keyboard focus: a click must not scroll its link away between press and release.
		const reveal = (event: FocusEvent) => {
			const target = event.target;
			if (target instanceof Element && target.matches(":focus-visible")) {
				target.scrollIntoView({ block: "nearest", inline: "nearest" });
			}
		};
		node.addEventListener("scroll", measure, { passive: true });
		node.addEventListener("focusin", reveal);
		return () => {
			observer.disconnect();
			node.removeEventListener("scroll", measure);
			node.removeEventListener("focusin", reveal);
		};
	}, [node]);

	return { ref, ...scroll };
}

/**
 * The fade on a scroller's right edge that shows more columns follow. Place it after the scroller,
 * inside a `relative` wrapper around it.
 */
export function ScrollMoreFade({ more }: { more: boolean }) {
	return (
		<div
			aria-hidden="true"
			className={`pointer-events-none absolute inset-y-0 right-0 z-2 w-14 bg-[linear-gradient(90deg,transparent,var(--bg))] transition-opacity duration-200 ${more ? "opacity-100" : "opacity-0"}`}
		/>
	);
}
