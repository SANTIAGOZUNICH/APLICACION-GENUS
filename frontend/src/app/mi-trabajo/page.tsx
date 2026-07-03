import type { Metadata } from "next";
import { OsAppRoot } from "@/features/os/app/os-app-root";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mi Trabajo — Genus OS",
  description: "Bandeja sectorial del Digital Twin — Genus OS.",
};

/** Ruta productiva OS — mismo entry que /design-preview vía OsAppRoot. */
export default function MiTrabajoPage() {
  return <OsAppRoot />;
}
