import { useId } from "react";

/**
 * Tick labels are set in 11 px Geist Mono, where every character is 0.6 em wide, so the room a
 * label takes follows from its length, without measuring it.
 */
const CHAR = 6.6;
/** The least space between two labels: about one character. */
const GAP = 6;

/** A labelled tick under a track. */
export interface Tick {
	/** Where it sits along the track: 0 at the start, 1 at the end. */
	x: number;
	label: string;
}

/**
 * The labels under a track: the first starts at 0, the last ends at the track's end, the others
 * are centred on their ticks. Where the track is too narrow for all of them, the labels between
 * the first and the last thin out to every second, third… one, so that neighbours never run
 * together ("4.5M5M"). The track is a size container and each thinning a container query worked
 * out from the labels' lengths, so the server's HTML already shows the right labels at any width.
 *
 * `end` replaces the last label with a longer one; the labels it would run into hide.
 */
export function Ticks({
	ticks,
	end,
	className = "",
}: {
	ticks: readonly Tick[];
	end?: string;
	className?: string;
}) {
	const name = `ticks${useId().replace(/[^\w-]/g, "")}`;
	const css = tickRules(ticks, end)
		.map(({ min, max, hide }) => {
			const query =
				min > 0 ? `(width >= ${min}px) and (width < ${max}px)` : `(width < ${max}px)`;
			const labels = hide.map((index) => `[data-tick="${index}"]`).join(",");
			return `@container ${name} ${query}{${labels}{display:none}}`;
		})
		.join("");
	return (
		<span className={`@container relative h-3.5 ${className}`} style={{ containerName: name }}>
			{/* Only numbers and the track's name go into it. */}
			{css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
			{ticks.map(({ x, label }, index) => (
				<span
					key={x}
					data-tick={index}
					className={`absolute whitespace-nowrap ${x === 0 ? "" : x === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
					style={{ left: `${x * 100}%` }}
				>
					{end !== undefined && index === ticks.length - 1 ? end : label}
				</span>
			))}
		</span>
	);
}

/** Labels to hide while the track is at least `min` and less than `max` px wide. */
interface Rule {
	min: number;
	max: number;
	hide: number[];
}

/** A label's place: its tick's `x`, its width in px, and how much of that lies before the tick. */
interface Extent {
	x: number;
	width: number;
	before: number;
}

/**
 * Which labels hide at which track widths. Each step k offers the labels at multiples of k, and
 * the first and last, leaving out multiples closer than k to the last. A track takes the smallest
 * step that fits it, with every two neighbouring labels at least `GAP` apart, the last one
 * included while a step with labels between the ends can fit that way. Narrower tracks take the
 * smallest step that fits from the start, and the labels the last one would run into hide, as do
 * the labels a longer `end` would run into.
 */
function tickRules(ticks: readonly Tick[], end: string | undefined): Rule[] {
	const last = ticks.length - 1;
	if (last < 2) return [];
	const extent = (tick: Tick, label: string): Extent => {
		const width = label.length * CHAR;
		return { x: tick.x, width, before: tick.x === 0 ? 0 : tick.x === 1 ? width : width / 2 };
	};
	// The narrowest track, in whole px, on which `b` starts at least GAP after `a` ends.
	const room = (a: Extent, b: Extent) =>
		Math.ceil((a.width - a.before + GAP + b.before) / (b.x - a.x));
	const plain = ticks.map((tick) => extent(tick, tick.label));

	const rules: Rule[] = [];
	// Thins the labels on tracks narrower than `max`, and returns the narrowest track a step with
	// labels between the first and last fits. Only `withLast` counts the gap to the last label.
	const thin = (max: number, withLast: boolean): number => {
		for (let step = 1; max > 0; step++) {
			const shown = [0];
			for (let index = step; index <= last - step; index += step) shown.push(index);
			shown.push(last);
			if (withLast && shown.length === 2) break;
			let min = 0;
			for (let i = 1; i < shown.length; i++) {
				if (withLast || shown[i] !== last) {
					min = Math.max(min, room(plain[shown[i - 1]!]!, plain[shown[i]!]!));
				}
			}
			if (min >= max) continue;
			const hide = ticks.map((_, index) => index).filter((index) => !shown.includes(index));
			if (hide.length > 0) rules.push({ min, max, hide });
			max = min;
		}
		return max;
	};
	thin(thin(Infinity, true), false);
	// Whatever the step, the labels the last one would run into hide.
	const tail = extent(ticks[last]!, end ?? ticks[last]!.label);
	for (let index = 1; index < last; index++) {
		rules.push({ min: 0, max: room(plain[index]!, tail), hide: [index] });
	}
	return rules;
}
