/**
 * RBAC para la memoria de Creamy — separada de `features/os/assistant/permissions.ts`
 * (que controla el acceso a dominios operativos existentes vía snapshot local).
 */

import { OPERATIONAL_SECTOR_IDS, type SectorId } from "@/types/operational/sector";

function isKnownSector(sector: string | null | undefined): sector is SectorId {
  return !!sector && (OPERATIONAL_SECTOR_IDS as readonly string[]).includes(sector);
}

const VALIDATOR_SECTORS: ReadonlySet<SectorId> = new Set(["CALIDAD", "PRODUCCION", "DIRECCION"]);

/** Cualquier sector operativo reconocido puede reportar un hecho operativo (queda REPORTADA). */
export function canReportOperationalMemory(sector: SectorId | string | null | undefined): boolean {
  return isKnownSector(sector);
}

/** Solo Calidad, Producción o Dirección pueden validar/revocar un hecho operativo reportado. */
export function canValidateOperationalMemory(sector: SectorId | string | null | undefined): boolean {
  return isKnownSector(sector) && VALIDATOR_SECTORS.has(sector);
}

/** La memoria operativa es compartida: cualquier sector reconocido puede leerla. */
export function canReadOperationalMemory(sector: SectorId | string | null | undefined): boolean {
  return isKnownSector(sector);
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Memoria personal: solo el mismo usuario puede leer su propia memoria. */
export function canReadUserMemory(actorEmail: string, targetEmail: string): boolean {
  const a = normalizeEmail(actorEmail);
  const t = normalizeEmail(targetEmail);
  return !!a && !!t && a === t;
}

/** Memoria personal: solo el mismo usuario puede crear/actualizar/olvidar su memoria. */
export function canMutateUserMemory(actorEmail: string, targetEmail: string): boolean {
  return canReadUserMemory(actorEmail, targetEmail);
}
