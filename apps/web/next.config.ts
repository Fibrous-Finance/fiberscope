import type { NextConfig } from "next";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
	// `next dev` would otherwise write AGENTS.md and CLAUDE.md for AI coding agents.
	agentRules: false,
	devIndicators: false,
	poweredByHeader: false,
	reactCompiler: true,
	transpilePackages: ["@fiberscope/core"],
	// The Worker's own workers.dev address was the public link before fiberscope.org (the README
	// until #31), so its pages answer with a permanent redirect to the domain, query string
	// included. Pull-request previews (pr-<number>-fiberscope.kermo.workers.dev) don't match. The
	// anchors matter: OpenNext tests a host pattern with an unanchored RegExp. The root has a rule
	// of its own because OpenNext leaves an empty `:path*` unfilled in the destination.
	async redirects() {
		const host = [{ type: "host" as const, value: "^fiberscope\\.kermo\\.workers\\.dev$" }];
		return [
			{ source: "/", has: host, destination: "https://fiberscope.org/", permanent: true },
			{
				source: "/:path+",
				has: host,
				destination: "https://fiberscope.org/:path+",
				permanent: true,
			},
		];
	},
};

export default withNextIntl(nextConfig);
