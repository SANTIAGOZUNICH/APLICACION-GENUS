import type { NextConfig } from "next";

/**
 * Con Neon (DATABASE_URL), exponer native al cliente salvo override explícito.
 * Sin DB queda sheets.
 */
function resolvePublicPlanningSource(): string {
  const explicit = (
    process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE ??
    process.env.GENUS_PLANNING_SOURCE ??
    ""
  )
    .trim()
    .toLowerCase();
  if (explicit === "native" || explicit === "sheets") return explicit;

  const hasDb = Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim() ||
      process.env.DATABASE_URL_UNPOOLED?.trim()
  );
  if (hasDb) return "native";
  return explicit || "sheets";
}

const nextConfig: NextConfig = {
  // Playwright / scripts locales usan 127.0.0.1; Next 16 bloquea HMR/dev assets cross-origin.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // pdfkit AFM + plantilla XLSX deben viajar en el serverless bundle (Preview).
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/pdfkit/js/data/**/*",
      "./assets/remitos/**/*",
    ],
  },
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    NEXT_PUBLIC_GENUS_PLANNING_SOURCE: resolvePublicPlanningSource(),
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/offline",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
