import type { NextConfig } from "next";

/**
 * En Preview con Neon (DATABASE_URL inyectada), exponer native al cliente
 * salvo override explícito. Production sin DB / con sheets queda sheets.
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
  if (process.env.VERCEL_ENV === "preview" && hasDb) return "native";
  return explicit || "sheets";
}

const nextConfig: NextConfig = {
  // Playwright / scripts locales usan 127.0.0.1; Next 16 bloquea HMR/dev assets cross-origin.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    NEXT_PUBLIC_GENUS_PLANNING_SOURCE: resolvePublicPlanningSource(),
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
