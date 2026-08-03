import type { MetadataRoute } from "next";

/** PWA manifest — Genus OS (Industrial Glass Night). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Genus OS",
    short_name: "Genus OS",
    description: "Manufacturing Operating System de Laboratorio Genus",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#071925",
    theme_color: "#071925",
    lang: "es-AR",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
