import type { Metadata } from "next";
import "@/design-system/os-preview-tokens.css";

export const metadata: Metadata = {
  title: "Plan Semanal — Genus OS",
};

/** Minimal layout — no AppShell, same token scope as /design-preview. */
export default function PlanSemanalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
