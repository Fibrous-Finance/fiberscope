import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
	...nextVitals,
	...nextTs,
	globalIgnores([
		".next/**",
		".open-next/**",
		".wrangler/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
	]),
]);
