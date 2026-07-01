import type { Metadata } from "next";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { resolveEntityPage } from "@/lib/entity-pages";
import { EntityPageKinds } from "@/types/entity-page";

interface OaPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: OaPageProps): Promise<Metadata> {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.OA, id);
  return {
    title: model ? `${model.entityId} · ${model.title}` : `OA ${id}`,
  };
}

export default async function OaPage({ params }: OaPageProps) {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.OA, id);

  if (!model) {
    return <EntityPageNotFound entityLabel="Orden de acondicionamiento" entityId={id} />;
  }

  return <EntityPageView model={model} />;
}
