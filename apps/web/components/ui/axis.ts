/**
 * Compact tracks are too narrow to label every tick: past four ticks, only every other one keeps
 * its label, so neighbouring labels never run together ("300400").
 */
export function compactTickClass(index: number, count: number): string {
	return count > 4 && index % 2 === 1 ? "max-wide:hidden" : "";
}
