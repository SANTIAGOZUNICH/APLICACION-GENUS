import type { Metadata } from "next";
import { EntityPageLoader } from "@/components/data/entity-page-loader";
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
  return <EntityPageLoader kind={EntityPageKinds.OE} entityId={id} />;
}
