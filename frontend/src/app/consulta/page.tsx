import type { Metadata } from "next";
import { OsAppRoot } from "@/features/os/app/os-app-root";

export const metadata: Metadata = {
  title: "Consulta — Genus OS",
  description: "Búsqueda operativa del Digital Twin — Genus OS.",
};

/** Ruta productiva OS — inicia en vista consulta tras login. */
export default function ConsultaPage() {
  return <OsAppRoot initialNav={{ view: "consulta" }} />;
}
