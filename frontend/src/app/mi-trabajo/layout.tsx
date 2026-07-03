import type { Metadata } from "next";
import "@/design-system/os-preview-tokens.css";

export const metadata: Metadata = {
  title: "Mi Trabajo — Genus OS",
};

/** Minimal layout — no AppShell, same token scope as /design-preview. */
export default function MiTrabajoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
