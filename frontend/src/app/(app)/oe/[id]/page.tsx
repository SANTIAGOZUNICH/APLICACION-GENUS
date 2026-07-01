import type { Metadata } from "next";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { resolveEntityPage } from "@/lib/entity-pages";
import { EntityPageKinds } from "@/types/entity-page";

interface OePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: OePageProps): Promise<Metadata> {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.OE, id);
  return {
    title: model ? `${model.entityId} · ${model.title}` : `OE ${id}`,
  };
}

export default async function OePage({ params }: OePageProps) {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.OE, id);

  if (!model) {
    return <EntityPageNotFound entityLabel="Orden de elaboración" entityId={id} />;
  }

  return <EntityPageView model={model} />;
}
