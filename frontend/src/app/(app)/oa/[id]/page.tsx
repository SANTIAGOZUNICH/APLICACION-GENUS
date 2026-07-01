import type { Metadata } from "next";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
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
  return <EntityPageClient kind={EntityPageKinds.OA} entityId={id} />;
}
