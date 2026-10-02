/**
 * The ring-dot wordmark: "f", a dotless "ı" with a teal dot, "bersc", a teal ring for the "o",
 * "pe". Ring and dot echo the Fibrous mark. Sized by the parent's font size.
 */
export function Logo() {
	return (
		<>
			<span aria-hidden="true" className="flex items-baseline">
				f
				<span className="relative inline-block">
					ı
					<span className="absolute top-[.04em] left-1/2 -ml-[.095em] size-[.19em] rounded-full bg-teal" />
				</span>
				bersc
				<span className="mx-[.02em] -mb-[.01em] inline-block size-[.54em] rounded-full border-[.105em] border-solid border-teal" />
				pe
			</span>
			<span className="sr-only">Fiberscope</span>
		</>
	);
}
