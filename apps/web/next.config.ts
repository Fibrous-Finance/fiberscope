import type { NextConfig } from "next";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin({
	requestConfig: "./i18n/request.ts",
	experimental: {
		// Each messages/en/*.json is compiled to its ICU syntax tree at build time, and the page
		// formats from that tree. Without it, every t() call with values builds its formats and
		// compiles the message again on every request: about a sixth of a render's CPU on the
		// Worker. Experimental in next-intl 4.14; the rendered text is the same.
		messages: {
			path: "./messages",
			format: "json",
			locales: "infer",
			sourceLocale: "en",
			precompile: true,
		},
	},
});

const nextConfig: NextConfig = {
	// `next dev` would otherwise write AGENTS.md and CLAUDE.md for AI coding agents.
	agentRules: false,
	devIndicators: false,
	poweredByHeader: false,
	reactCompiler: true,
	transpilePackages: ["@fiberscope/core"],
	// The commit this build comes from, inlined at build time and linked in the footer.
	// deploy.yml sets SITE_COMMIT to the commit it deploys; other builds leave it empty and the
	// footer leaves the line out.
	env: { SITE_COMMIT: process.env.SITE_COMMIT ?? "" },
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
