import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import { ConsultaView } from "@/components/data/consulta-view";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Consulta",
};

export default function ConsultaPage() {
  return (
    <>
      <PageHeader
        title="Consulta"
        description={`${siteConfig.name} · Explorá OEs, lotes y pedidos indexados desde Google Drive`}
      />
      <ConsultaView />
    </>
  );
}
