import type { Metadata } from "next";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { resolveEntityPage } from "@/lib/entity-pages";
import { EntityPageKinds } from "@/types/entity-page";

interface LiberacionPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: LiberacionPageProps): Promise<Metadata> {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.LIBERACION, id);
  return {
    title: model
      ? `${model.entityId} · ${model.title}`
      : `Liberación ${id}`,
  };
}

export default async function LiberacionPage({ params }: LiberacionPageProps) {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.LIBERACION, id);

  if (!model) {
    return <EntityPageNotFound entityLabel="Liberación" entityId={id} />;
  }

  return <EntityPageView model={model} />;
}
