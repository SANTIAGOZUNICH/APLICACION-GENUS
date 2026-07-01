import type { Metadata } from "next";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
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
  return <EntityPageClient kind={EntityPageKinds.LIBERACION} entityId={id} />;
}
