import type { Metadata } from "next";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { resolveEntityPage } from "@/lib/entity-pages";
import { EntityPageKinds } from "@/types/entity-page";

interface LotePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: LotePageProps): Promise<Metadata> {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.LOTE, id);
  return {
    title: model ? `${model.entityId} · ${model.title}` : `Lote ${id}`,
  };
}

export default async function LotePage({ params }: LotePageProps) {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.LOTE, id);

  if (!model) {
    return <EntityPageNotFound entityLabel="Lote" entityId={id} />;
  }

  return <EntityPageView model={model} />;
}
