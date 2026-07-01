import type { Metadata } from "next";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { EntityPageView } from "@/components/patterns/entity-page/entity-page-view";
import { resolveEntityPage } from "@/lib/entity-pages";
import { EntityPageKinds } from "@/types/entity-page";

interface PedidoPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PedidoPageProps): Promise<Metadata> {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.PEDIDO, id);
  return {
    title: model ? `${model.entityId} · ${model.title}` : `Pedido ${id}`,
  };
}

export default async function PedidoPage({ params }: PedidoPageProps) {
  const { id } = await params;
  const model = resolveEntityPage(EntityPageKinds.PEDIDO, id);

  if (!model) {
    return <EntityPageNotFound entityLabel="Pedido" entityId={id} />;
  }

  return <EntityPageView model={model} />;
}
