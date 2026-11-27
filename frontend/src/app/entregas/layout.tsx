import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@/features/portal/portal.css";
import { PortalPwaRuntime } from "@/features/portal/pwa/portal-pwa-runtime";

export const metadata: Metadata = {
  title: "GENUS | Portal de Clientes",
  description: "Seguí el avance de tu producción en Laboratorio Genus. Tu producción, en buenas manos.",
  applicationName: "GENUS — Portal de Clientes",
  robots: { index: false, follow: false },
  // PWA SOLO del portal: manifest, íconos y service worker propios con alcance /entregas (la app interna no los usa).
  manifest: "/entregas/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Portal Genus", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/entregas/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/entregas/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = { themeColor: "#0b2f57", colorScheme: "light", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="gp">
      {children}
      <PortalPwaRuntime />
    </div>
  );
}
