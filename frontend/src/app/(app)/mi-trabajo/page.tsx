import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import { MiTrabajoView } from "@/components/operational/mi-trabajo-view";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Mi Trabajo",
};

export default function MiTrabajoPage() {
  return (
    <>
      <PageHeader
        title="Mi Trabajo"
        description={`${siteConfig.name} · Trabajo operativo por sector (WorkItems)`}
      />
      <MiTrabajoView />
    </>
  );
}
