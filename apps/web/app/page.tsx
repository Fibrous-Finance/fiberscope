import { Dashboard } from "@/components/dashboard/Dashboard";

import { parseSelection } from "@/lib/selection";
import { loadSnapshot } from "@/lib/snapshot";

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
	const [result, params] = await Promise.all([loadSnapshot(), searchParams]);
	return <Dashboard result={result} selection={parseSelection(params)} />;
}
