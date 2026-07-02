import type { Metadata } from "next";
import { EntityPageLoader } from "@/components/data/entity-page-loader";
import { EntityPageKinds } from "@/types/entity-page";

interface OaPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: OaPageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `OA ${id}` };
}

export default async function OaPage({ params }: OaPageProps) {
  const { id } = await params;
  return <EntityPageLoader kind={EntityPageKinds.OA} entityId={id} />;
}
