/** Fase 3 — flags de convergencia OS (Strangler Fig). Default: desactivados. */

function isTruthyEnv(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Muestra banner informativo en workspaces Track A hacia rutas OS productivas. */
export function isLegacyOsBannerEnabled(): boolean {
  return isTruthyEnv(process.env.NEXT_PUBLIC_GENUS_OS_LEGACY_BANNER);
}

/** Activa redirects 302 opt-in desde rutas legacy (middleware PR 3.11). */
export function isLegacyOsRedirectEnabled(): boolean {
  return isTruthyEnv(process.env.GENUS_OS_LEGACY_REDIRECTS);
}

/** Rutas legacy Track A elegibles para banner (workspaces AppShell). */
export const LEGACY_WORKSPACE_PREFIXES = [
  "/bandeja",
  "/produccion",
  "/calidad",
  "/deposito",
  "/comercial",
  "/direccion",
  "/dt",
] as const;

/** Mapeo conservador legacy → OS (solo equivalencias semánticas claras). */
export const LEGACY_TO_OS_REDIRECTS: Readonly<Record<string, string>> = {
  "/bandeja": "/mi-trabajo",
};
