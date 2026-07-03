import type { Metadata } from "next";
import { OsAppRoot } from "@/features/os/app/os-app-root";

export const metadata: Metadata = {
  title: "Plan Semanal — Genus OS",
  description: "Plan semanal sectorial del Digital Twin — Genus OS.",
};

/** Ruta productiva OS — inicia en vista plan-semanal tras login. */
export default function PlanSemanalPage() {
  return <OsAppRoot initialNav={{ view: "plan-semanal" }} />;
}
