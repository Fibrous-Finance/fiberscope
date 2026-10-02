import { useEffect, useState } from "react";

/**
 * Copies text to the clipboard. `copied` is that text for `ms` afterwards (null otherwise), so the
 * button can say "Copied ✓".
 */
export function useCopy(ms: number): [copied: string | null, copy: (text: string) => void] {
	const [copied, setCopied] = useState<string | null>(null);

	useEffect(() => {
		if (copied === null) return;
		const timer = setTimeout(() => setCopied(null), ms);
		return () => clearTimeout(timer);
	}, [copied, ms]);

	const copy = (text: string) => {
		navigator.clipboard?.writeText(text).then(
			() => setCopied(text),
			() => {}
		);
	};
	return [copied, copy];
}
