/**
 * The mosaic mark, a 3 × 3 grid filled column by column like the hero mosaic, then the word. The
 * parent sets the type (Geist 600, line-height 1, letter-spacing −0.035em) and the size: 20px in
 * the header, 15px in the footer. The mark is 0.9em square and sits 0.095em low, centred on the
 * cap height; its greys follow the theme through `--fg` and `--bg`.
 */
export function Logo() {
	return (
		<>
			<svg
				viewBox="0 0 24 24"
				aria-hidden="true"
				className="relative top-[.095em] mr-[.3em] block size-[.9em] flex-none"
			>
				<path
					className="fill-teal"
					d="M0 0h7v7H0zM0 8.5h7v7H0zM0 17h7v7H0zM8.5 0h7v7h-7z"
				/>
				<path
					className="fill-[color-mix(in_oklab,var(--fg)_70%,var(--bg))]"
					d="M8.5 8.5h7v7h-7zM8.5 17h7v7h-7zM17 0h7v7h-7z"
				/>
				<path
					className="fill-[color-mix(in_oklab,var(--fg)_40%,var(--bg))]"
					d="M17 8.5h7v7h-7zM17 17h7v7h-7z"
				/>
			</svg>
			Fiberscope
		</>
	);
}
