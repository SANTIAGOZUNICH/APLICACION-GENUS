import type { Metadata } from "next";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
import { EntityPageKinds } from "@/types/entity-page";

interface LotePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: LotePageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Lote ${id}` };
}

export default async function LotePage({ params }: LotePageProps) {
  const { id } = await params;
  return <EntityPageClient kind={EntityPageKinds.LOTE} entityId={id} />;
}
