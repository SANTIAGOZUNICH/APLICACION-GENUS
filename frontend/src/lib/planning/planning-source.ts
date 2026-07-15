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
 * explícito a sheets, activar native. Production sin Neon queda en sheets.
 * Flag explícito GENUS_PLANNING_SOURCE siempre gana.
 */
export function getPlanningSource(): PlanningSource {
  const explicit = parseSource(
    process.env.GENUS_PLANNING_SOURCE ?? process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE
  );
  if (explicit) return explicit;

  if (process.env.VERCEL_ENV === "preview" && hasDatabaseUrl()) {
    return "native";
  }

  return "sheets";
}

export function getClientPlanningSource(): PlanningSource {
  const explicit = parseSource(process.env.NEXT_PUBLIC_GENUS_PLANNING_SOURCE);
  if (explicit) return explicit;
  // En cliente, el valor se materializa vía next.config env en build Preview.
  return "sheets";
}

export function isNativePlanningEnabled(): boolean {
  return getPlanningSource() === "native";
}
