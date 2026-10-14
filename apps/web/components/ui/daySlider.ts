import { useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";

/** What a day slider's chart listens to: spread them next to its slider role and values. */
interface DaySliderHandlers {
	onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
	onFocus: () => void;
	onBlur: (event: FocusEvent<HTMLElement>) => void;
	onPointerDown: (event: PointerEvent<HTMLElement>) => void;
	onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
	onMouseMove?: (event: MouseEvent<HTMLElement>) => void;
	onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
}

export interface DaySlider {
	/** The picked day, counted from the oldest; null while none is. */
	day: number | null;
	/** The day the slider stands on, its `aria-valuenow` less one: the picked day, or the latest. */
	now: number;
	handlers: DaySliderHandlers;
}

/**
 * A chart of daily values that is also a slider over its days, in one tab stop. Focus picks the
 * latest day; ← and ↓ step back a day, → and ↑ forward, Home and End jump to the first and the
 * latest; blur clears the pick. A touch or pen press picks the day under the finger. Give the chart
 * `touch-action: pan-y pinch-zoom` so the page still scrolls and zooms under a finger; a press that
 * turns into a scroll gives back the pick it made.
 */
export function useDaySlider({
	count,
	at,
	hover = false,
}: {
	/** Days on the chart. */
	count: number;
	/** The day at a place across the chart, from 0 at its left edge to 1 at its right. */
	at: (across: number) => number;
	/** The mouse picks the day under it too; the pick then lasts while it is over the chart. */
	hover?: boolean;
}): DaySlider {
	const [picked, setPicked] = useState<number | null>(null);
	// The pick a press replaced, restored if the press scrolls the page instead.
	const replaced = useRef<number | null>(null);
	// A pick from a longer chart, before the period changed, can lie past this one's end.
	const day = picked !== null && picked < count ? picked : null;
	const now = day ?? count - 1;
	const pickUnder = (event: MouseEvent<HTMLElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		if (box.width === 0) return;
		const index = at((event.clientX - box.left) / box.width);
		setPicked(Math.min(count - 1, Math.max(0, index)));
	};

	const handlers: DaySliderHandlers = {
		onKeyDown(event) {
			if (event.altKey || event.ctrlKey || event.metaKey) return;
			const back = Math.max(0, now - 1);
			const forward = Math.min(count - 1, now + 1);
			const moves: Partial<Record<string, number>> = {
				ArrowLeft: back,
				ArrowDown: back,
				ArrowRight: forward,
				ArrowUp: forward,
				Home: 0,
				End: count - 1,
			};
			const next = moves[event.key];
			if (next === undefined) return;
			event.preventDefault();
			setPicked(next);
		},
		// A click or a tap focuses the chart too: the day it picked stays.
		onFocus: () =>
			setPicked((current) => (current !== null && current < count ? current : count - 1)),
		onBlur(event) {
			if (!(hover && event.currentTarget.matches(":hover"))) setPicked(null);
		},
		onPointerDown(event) {
			// The mouse picks by hovering, where it picks at all.
			if (event.pointerType === "mouse") return;
			replaced.current = day;
			pickUnder(event);
		},
		onPointerCancel(event) {
			if (event.pointerType !== "mouse") setPicked(replaced.current);
		},
	};
	if (hover) {
		handlers.onMouseMove = pickUnder;
		// While the chart has focus, the pick stays for the keys to move on from.
		handlers.onMouseLeave = (event) => {
			if (document.activeElement !== event.currentTarget) setPicked(null);
		};
	}
	return { day, now, handlers };
}
