import type { Metadata } from "next";
import { EntityPageClient } from "@/components/patterns/actions/entity-page-client";
import { EntityPageKinds } from "@/types/entity-page";

interface OePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: OePageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `OE ${id}` };
}

export default async function OePage({ params }: OePageProps) {
  const { id } = await params;
  return <EntityPageClient kind={EntityPageKinds.OE} entityId={id} />;
}
