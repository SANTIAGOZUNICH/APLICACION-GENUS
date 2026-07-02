import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import { MiTrabajoView } from "@/components/operational/mi-trabajo-view";

export const metadata: Metadata = {
  title: "Mi Trabajo",
};

export default function MiTrabajoPage() {
  return (
    <>
      <PageHeader
        title="Mi Trabajo"
        description="Preview F8.1 — validación funcional del modelo operativo por sector"
      />
      <MiTrabajoView />
    </>
  );
}
