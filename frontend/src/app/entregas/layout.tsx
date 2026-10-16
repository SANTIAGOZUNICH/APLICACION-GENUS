import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/features/portal/portal.css";

export const metadata: Metadata = {
  title: "GENUS | Portal de Clientes",
  description: "Seguí el avance de tu producción en Laboratorio Genus. Tu producción, en buenas manos.",
  applicationName: "GENUS | Portal de Clientes",
  robots: { index: false, follow: false },
  manifest: undefined,
  appleWebApp: undefined,
  icons: { icon: "/entregas/logo-genus.png" },
};

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light", width: "device-width", initialScale: 1 };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="gp">{children}</div>;
}
