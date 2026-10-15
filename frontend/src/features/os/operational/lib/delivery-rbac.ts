/**
 * RBAC de entregas.
 *  - Registrar una entrega final (`deliver_work`, circuito sin Calidad): Producción y Dirección (cualquier trabajo) y
 *    el sector que tiene el trabajo — Envasado Masivo/Premium y Codificado (SOLO los suyos; el chequeo por trabajo lo
 *    hace el servidor, ver canActorDeliverItem en lib/planning/circuit/delivery-core.ts). Elaboración NO entrega a
 *    cliente: envía a Envasado.
 *  - Archivar / anular / eliminar entregas ya registradas: solo PRODUCCION.
 * actorSectorId obligatorio; no es auth server-side completa.
 */

import type { SectorId } from "@/types/operational/sector";

export const DELIVERY_MUTATION_DENIED_MESSAGE =
  "Solo Producción puede confirmar, archivar, anular o eliminar entregas.";

export const DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE =
  "Falta actorSectorId. Las acciones de entrega requieren sector PRODUCCION.";

export const DELIVER_WORK_DENIED_MESSAGE =
  "Tu sector no puede registrar entregas finales. Elaboración envía a Envasado; las entregas las registran Producción, Dirección, Envasado o Codificado sobre sus trabajos.";

/** ¿Puede este sector registrar (algunas) entregas finales? El permiso por trabajo lo valida el servidor. */
export function canDeliverWork(sectorId: SectorId | string | null | undefined): boolean {
  return (
    sectorId === "PRODUCCION" ||
    sectorId === "DIRECCION" ||
    sectorId === "ENVASADO_MASIVO" ||
    sectorId === "ENVASADO_PREMIUM" ||
    sectorId === "CODIFICADO"
  );
}

export function validateDeliverWorkActor(actorSectorId: unknown): DeliveryMutationAttempt {
  if (typeof actorSectorId !== "string" || actorSectorId.trim() === "") {
    return {
      ok: false,
      error: DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "DELIVERY_MUTATION_MISSING_ACTOR",
    };
  }
  if (!canDeliverWork(actorSectorId)) {
    return { ok: false, error: DELIVER_WORK_DENIED_MESSAGE, code: "DELIVERY_MUTATION_FORBIDDEN" };
  }
  return { ok: true };
}

export type DeliveryMutationAttempt =
  | { ok: true }
  | {
      ok: false;
      error: string;
      code: "DELIVERY_MUTATION_FORBIDDEN" | "DELIVERY_MUTATION_MISSING_ACTOR";
    };

export function canMutateDeliveries(sectorId: SectorId | null | undefined): boolean {
  return sectorId === "PRODUCCION";
}

export function canViewDeliveries(sectorId: SectorId | null | undefined): boolean {
  return (
    sectorId === "PRODUCCION" ||
    // CALIDAD conserva la CONSULTA (solo lectura) de entregas: el sector ya no opera pero sus cuentas siguen vigentes.
    sectorId === "CALIDAD" ||
    sectorId === "DIRECCION" ||
    sectorId === "ELABORACION" ||
    sectorId === "ENVASADO_MASIVO" ||
    sectorId === "ENVASADO_PREMIUM"
  );
}

export function gateDeliveryMutation(
  actorSectorId: SectorId | null | undefined
): DeliveryMutationAttempt {
  if (actorSectorId == null || actorSectorId === ("" as SectorId)) {
    return {
      ok: false,
      error: DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "DELIVERY_MUTATION_MISSING_ACTOR",
    };
  }
  if (actorSectorId !== "PRODUCCION") {
    return {
      ok: false,
      error: DELIVERY_MUTATION_DENIED_MESSAGE,
      code: "DELIVERY_MUTATION_FORBIDDEN",
    };
  }
  return { ok: true };
}

export function validateDeliveryMutationActor(actorSectorId: unknown): DeliveryMutationAttempt {
  if (typeof actorSectorId !== "string" || actorSectorId.trim() === "") {
    return {
      ok: false,
      error: DELIVERY_MUTATION_MISSING_ACTOR_MESSAGE,
      code: "DELIVERY_MUTATION_MISSING_ACTOR",
    };
  }
  return gateDeliveryMutation(actorSectorId as SectorId);
}
