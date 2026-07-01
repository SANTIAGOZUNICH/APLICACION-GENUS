import type { Metadata } from "next";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
import { EntityPageKinds } from "@/types/entity-page";

interface PedidoPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PedidoPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Pedido ${id}` };
}

export default async function PedidoPage({ params }: PedidoPageProps) {
  const { id } = await params;
  return <EntityPageClient kind={EntityPageKinds.PEDIDO} entityId={id} />;
}
