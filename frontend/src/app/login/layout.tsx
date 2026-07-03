import type { Metadata } from "next";
import "@/design-system/os-preview-tokens.css";

export const metadata: Metadata = {
  title: "Ingresar — Genus OS",
};

/** Layout mínimo OS — mismos tokens que rutas productivas. */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
