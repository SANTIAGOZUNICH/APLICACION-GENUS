import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/providers";
import { siteConfig } from "@/config/site";
import { DEFERRED_INSTALL_BOOTSTRAP_SCRIPT } from "@/features/os/pwa/deferred-install-bootstrap";
import { getPlanningSource } from "@/lib/planning/planning-source";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
  description: "Manufacturing Operating System de Laboratorio Genus",
  applicationName: "Genus OS",
  appleWebApp: {
    capable: true,
    title: "Genus OS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#071925",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fuente de verdad del modo de planificación resuelta server-side — el
  // cliente la lee desde el DOM en vez de adivinar por env var de build
  // (evitaba que Preview quedara en "sheets" si faltaba la var pública).
  const planningSource = getPlanningSource();
  return (
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${inter.variable} h-full`}
      data-genus-planning-source={planningSource}
    >
      <head>
        <script
          // Early BIP capture before React hydration — required for one-click install.
          dangerouslySetInnerHTML={{ __html: DEFERRED_INSTALL_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="min-h-dvh antialiased">{/* safe-area shell */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
