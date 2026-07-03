import type { Metadata } from "next";
import "@/design-system/os-preview-tokens.css";

export const metadata: Metadata = {
  title: "F9 Design Preview — Genus OS",
};

/** Minimal layout — no AppShell, no providers beyond root. */
export default function DesignPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
