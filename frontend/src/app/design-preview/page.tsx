import type { Metadata } from "next";
import { OsAppRoot } from "@/features/os/app/os-app-root";

export const metadata: Metadata = {
  title: "F9 Design Preview — Genus OS",
  description: "Alias de compatibilidad — mismo OS que /mi-trabajo vía OsAppRoot.",
};

/** Alias Strangler — /design-preview renderiza OsAppRoot (login sectorial F10.1). */
export default function DesignPreviewPage() {
  return <OsAppRoot />;
}
