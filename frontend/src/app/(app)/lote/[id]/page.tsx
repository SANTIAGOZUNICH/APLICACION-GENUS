import type { Metadata } from "next";
import { LotePageLoader } from "@/components/data/lote-page-loader";

interface LotePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: LotePageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Lote ${id}` };
}

export default async function LotePage({ params }: LotePageProps) {
  const { id } = await params;
  return <LotePageLoader entityId={id} />;
}
