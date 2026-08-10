/** Fuente de planificación — no mezclar sheets y native. */

export type PlanningSource = "sheets" | "native";

function parseSource(raw: string | undefined | null): PlanningSource | null {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase();
  if (v === "native") return "native";
  if (v === "sheets") return "sheets";
  return null;
}

function hasDatabaseUrl(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim() ||
      process.env.DATABASE_URL_UNPOOLED?.trim()
  );
}

/**
 * Preview + Neon Marketplace: si hay DATABASE_URL inyectada y no hay override
 * explícito a sheets, activar native. Production con Neon también usa native.
 * Flag explícito GENUS_PLANNING_SOURCE siempre gana.
 */
export function getPlanningSource(): PlanningSource {
  const explicit = parseSource(
    process.env.GENUS_PLANNING_SOURCE ?? process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE
  );
  if (explicit) return explicit;

  if (hasDatabaseUrl()) {
    return "native";
  }

  return "sheets";
}

/**
 * En cliente no hay DATABASE_URL — la única forma confiable de saber el modo
 * real es leerlo de lo que el servidor ya resolvió. RootLayout (server
 * component) estampa `data-genus-planning-source` en <html> con
 * getPlanningSource(); acá solo lo leemos. NEXT_PUBLIC_GENUS_PLANNING_SOURCE
 * queda como fallback explícito para SSR/tests sin DOM.
 */
export function getClientPlanningSource(): PlanningSource {
  if (typeof document !== "undefined") {
    const fromDom = parseSource(document.documentElement.dataset.genusPlanningSource);
    if (fromDom) return fromDom;
  }
  const explicit = parseSource(process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE);
  if (explicit) return explicit;
  return "sheets";
}

export function isNativePlanningEnabled(): boolean {
  return getPlanningSource() === "native";
}
