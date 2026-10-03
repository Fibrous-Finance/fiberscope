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
};

export default withNextIntl(nextConfig);
