import { headers } from "next/headers";

import { Dashboard } from "@/components/dashboard/Dashboard";

import { looksLikePhone } from "@/lib/device";
import { parseSelection } from "@/lib/selection";
import { loadSnapshot } from "@/lib/snapshot";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
	const [result, params, request] = await Promise.all([loadSnapshot(), searchParams, headers()]);
	return (
		<Dashboard
			result={result}
			selection={parseSelection(params)}
			phone={looksLikePhone(request)}
		/>
	);
}
