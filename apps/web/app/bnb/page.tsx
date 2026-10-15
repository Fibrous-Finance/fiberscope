import { networkMetadata, NetworkPage } from "@/components/dashboard/NetworkPage";

export function generateMetadata() {
	return networkMetadata("bnb");
}

export default function BnbPage({ searchParams }: PageProps<"/bnb">) {
	return <NetworkPage network="bnb" searchParams={searchParams} />;
}
