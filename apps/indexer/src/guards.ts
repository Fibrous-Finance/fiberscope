/** Type guards for parsed JSON from outside the indexer, such as CoW's API. */

/** An object, not an array; its fields are still unchecked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

/** A string, null, or absent. */
export function isOptionalString(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || typeof value === "string";
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
