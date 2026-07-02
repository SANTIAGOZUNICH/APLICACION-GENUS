import type { Metadata } from "next";
import { EntityPageLoader } from "@/components/data/entity-page-loader";
import { EntityPageKinds } from "@/types/entity-page";

interface LiberacionPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: LiberacionPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Liberación ${id}` };
}

export default async function LiberacionPage({ params }: LiberacionPageProps) {
  const { id } = await params;
  return <EntityPageLoader kind={EntityPageKinds.LIBERACION} entityId={id} />;
}
