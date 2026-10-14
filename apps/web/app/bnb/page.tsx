import { BNB } from "@fiberscope/core";

import { networkMetadata, NetworkPage } from "@/components/dashboard/NetworkPage";

export function generateMetadata() {
	return networkMetadata(BNB);
}

export default function BnbPage({ searchParams }: PageProps<"/bnb">) {
	return <NetworkPage network={BNB} searchParams={searchParams} />;
}
