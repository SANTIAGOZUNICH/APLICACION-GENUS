import type { Metadata } from "next";
import "@/design-system/os-preview-tokens.css";
import { DesignPreviewApp } from "@/design-preview/design-preview-app";

export const metadata: Metadata = {
  title: "F9 Design Preview — Genus OS",
  description: "Wireframes del rediseño UX/UI. Pendiente de aprobación.",
};

/** F9 — isolated design preview. Does NOT use AppShell or touch backend. */
export default function DesignPreviewPage() {
  return <DesignPreviewApp />;
}
