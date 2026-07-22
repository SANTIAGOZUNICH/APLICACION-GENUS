import type { SectorId } from "@/types/operational/sector";

export type InventoryModule =
  | "me_ingresos"
  | "me_salidas"
  | "me_stock"
  | "me_avisos"
  | "me_ajustes"
  | "mp_stock"
  | "mp_ingresos"
  | "mp_control"
  | "mp_compras"
  | "semanas_ro";

/** Ocho accesos de planta que reciben avisos ME. */
export const ME_ALERT_NOTIFY_SECTORS: SectorId[] = [
  "ELABORACION",
  "PRODUCCION",
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CALIDAD",
  "MATERIA_PRIMA",
  "CODIFICADO",
  "DEPOSITO",
];

export function canReadInventory(sector: SectorId | undefined, module: InventoryModule): boolean {
  if (!sector) return false;
  if (module === "semanas_ro") return sector === "DEPOSITO" || sector === "PRODUCCION";
  if (module.startsWith("me_")) {
    return (
      sector === "DEPOSITO" ||
      sector === "PRODUCCION" ||
      sector === "CALIDAD" ||
      sector === "MATERIA_PRIMA" ||
      sector === "ENVASADO_MASIVO" ||
      sector === "ENVASADO_PREMIUM"
    );
  }
  if (module.startsWith("mp_")) {
    return (
      sector === "MATERIA_PRIMA" ||
      sector === "PRODUCCION" ||
      sector === "CALIDAD" ||
      sector === "DEPOSITO"
    );
  }
  return false;
}

/** Escritura de salidas OA automáticas (entrega OA). */
export function canWriteOaMeSalida(sector: SectorId | undefined): boolean {
  if (!sector) return false;
  return (
    sector === "ENVASADO_MASIVO" ||
    sector === "ENVASADO_PREMIUM" ||
    sector === "PRODUCCION" ||
    sector === "CALIDAD" ||
    sector === "DEPOSITO"
  );
}

export function canWriteInventory(sector: SectorId | undefined, module: InventoryModule): boolean {
  if (!sector) return false;
  if (module === "semanas_ro") return false;
  if (module === "me_ingresos" || module === "me_salidas") {
    return sector === "DEPOSITO";
  }
  if (module === "me_ajustes" || module === "me_stock") {
    return sector === "DEPOSITO" || sector === "PRODUCCION";
  }
  if (module === "me_avisos") {
    return sector === "DEPOSITO" || sector === "PRODUCCION";
  }
  if (module.startsWith("mp_")) {
    return sector === "MATERIA_PRIMA";
  }
  return false;
}

export function canAdjustMeStock(sector: SectorId | undefined): boolean {
  return sector === "DEPOSITO" || sector === "PRODUCCION";
}

export function assertInventoryActor(
  actorSectorId: string | undefined | null
): asserts actorSectorId is SectorId {
  if (!actorSectorId || typeof actorSectorId !== "string") {
    throw Object.assign(new Error("actorSectorId requerido"), { status: 403, code: "FORBIDDEN" });
  }
}

export function assertCanWrite(sector: SectorId, module: InventoryModule): void {
  if (!canWriteInventory(sector, module)) {
    throw Object.assign(new Error(`Sector ${sector} no puede escribir ${module}`), {
      status: 403,
      code: "FORBIDDEN",
    });
  }
}

export function assertCanRead(sector: SectorId, module: InventoryModule): void {
  if (!canReadInventory(sector, module)) {
    throw Object.assign(new Error(`Sector ${sector} no puede leer ${module}`), {
      status: 403,
      code: "FORBIDDEN",
    });
  }
}
