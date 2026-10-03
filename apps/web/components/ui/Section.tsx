import type { ReactNode } from "react";

/** A page section below the hero: generous top spacing, and anchors clear the sticky header. */
export function Section({
	id,
	busy,
	children,
}: {
	id?: string;
	/** Loading placeholder sections. */
	busy?: boolean;
	children: ReactNode;
}) {
	return (
		<section
			id={id}
			aria-busy={busy || undefined}
			className="scroll-mt-[60px] pt-[clamp(84px,11vw,140px)]"
		>
			{children}
		</section>
	);
}

/** The row under every chart: a note on the left and the source on the right. */
export function FootLine({ children, source }: { children?: ReactNode; source?: ReactNode }) {
	return (
		<div className="mt-4 flex flex-wrap justify-between gap-x-5 gap-y-1.5 foot-line">
			<span>{children}</span>
			{source ? <span>{source}</span> : null}
		</div>
	);
}

/**
 * The `<arrow>` chunk of a message ("CoW Explorer ↗", "Back to the overview →", a sort arrow):
 * decorative, so screen readers skip it.
 */
export function arrow(chunks: ReactNode) {
	return <span aria-hidden="true">{chunks}</span>;
}

/** A 12px chevron that points down; rotate it to show an open state. */
export function Caret({ open, className = "" }: { open?: boolean; className?: string }) {
	return (
		<svg
			viewBox="0 0 12 12"
			aria-hidden="true"
			className={`size-3 flex-none transition-transform duration-200 ${open ? "rotate-180" : ""} ${className}`}
		>
			<path
				d="M3 4.5 6 7.5 9 4.5"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.6}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
