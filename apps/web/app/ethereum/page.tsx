import { networkMetadata, NetworkPage } from "@/components/dashboard/NetworkPage";

export function generateMetadata() {
	return networkMetadata("ethereum");
}

export default function EthereumPage({ searchParams }: PageProps<"/ethereum">) {
	return <NetworkPage network="ethereum" searchParams={searchParams} />;
}
