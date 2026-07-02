import type { Metadata } from "next";
import { EntityPageLoader } from "@/components/data/entity-page-loader";
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
  return <EntityPageLoader kind={EntityPageKinds.PEDIDO} entityId={id} />;
}
