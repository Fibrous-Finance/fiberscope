/**
 * Figures that wrap between each other, with "·" between them. Each figure carries its dot, and the
 * dot of a figure that starts a line is clipped, so no line starts or ends with one.
 */
export function DotList({ items, className }: { items: string[]; className: string }) {
	return (
		<span className={`block overflow-x-clip ${className}`}>
			<span className="-ml-3.5 flex flex-wrap">
				{items.map((item) => (
					<span
						key={item}
						className="whitespace-nowrap before:inline-block before:w-3.5 before:text-center before:content-['·']"
					>
						{item}
					</span>
				))}
			</span>
		</span>
	);
}
