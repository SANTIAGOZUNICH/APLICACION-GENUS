/**
 * Control de Material de Envase (ME) por trabajo de Envasado — reglas puras (sin I/O), compartidas por servidor y pantallas.
 *
 * Estados: «Sin info» (Depósito todavía no verificó; es el inicial y NUNCA se asume correcto), ✅ correcto, ❌ incorrecto/incompleto/no disponible.
 * Es INFORMATIVO: no reserva stock, no genera movimientos y no bloquea la producción. Lo modifica solo Depósito (y Dirección); todos consultan.
 */
export const ME_STATUSES = ["SIN_INFO", "OK", "NO_OK"] as const;
export type MeStatus = (typeof ME_STATUSES)[number];

export interface MeInfo {
  status: MeStatus;
  /** Observación opcional de Depósito («Faltan 300 pomos de 200 ml»). */
  observation: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const ME_LABEL: Record<MeStatus, string> = { SIN_INFO: "Sin info", OK: "✅", NO_OK: "❌" };
export const ME_LONG_LABEL: Record<MeStatus, string> = { SIN_INFO: "Sin info (Depósito todavía no verificó)", OK: "Material de Envase correcto", NO_OK: "Material de Envase incorrecto, incompleto o no disponible" };
export const ME_MAX_OBSERVATION = 500;

/** Solo los trabajos de Envasado Masivo / Premium llevan ME (no Elaboración ni Codificado). */
export function meAppliesToSector(sector: string | null | undefined): boolean {
  const s = String(sector ?? "").toUpperCase();
  return s === "ENVASADO_MASIVO" || s === "ENVASADO_PREMIUM";
}

/** Quién puede MODIFICAR el estado: Depósito y Dirección (autorización administrativa equivalente). */
export function canSetMeStatus(actorSector: string | null | undefined): boolean {
  const s = String(actorSector ?? "").toUpperCase();
  return s === "DEPOSITO" || s === "DIRECCION";
}

/** Valor de la base (NULL / «OK» / «NO_OK») → estado de pantalla. */
export function meStatusFromDb(value: string | null | undefined): MeStatus {
  return value === "OK" || value === "NO_OK" ? value : "SIN_INFO";
}

/** Estado de pantalla → valor de la base (SIN_INFO = NULL). */
export function meStatusToDb(status: MeStatus): "OK" | "NO_OK" | null {
  return status === "SIN_INFO" ? null : status;
}

export function parseMeStatus(raw: unknown): MeStatus | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "OK" || v === "✅" || v === "CORRECTO") return "OK";
  if (v === "NO_OK" || v === "NOOK" || v === "❌" || v === "INCORRECTO") return "NO_OK";
  if (v === "SIN_INFO" || v === "SIN INFO" || v === "") return "SIN_INFO";
  return null;
}

export function buildMeInfo(row: { meStatus?: string | null; meObservation?: string | null; meUpdatedBy?: string | null; meUpdatedAt?: string | Date | null }): MeInfo {
  return {
    status: meStatusFromDb(row.meStatus),
    observation: row.meObservation?.trim() ? row.meObservation : null,
    updatedBy: row.meUpdatedBy ?? null,
    updatedAt: row.meUpdatedAt ? (row.meUpdatedAt instanceof Date ? row.meUpdatedAt.toISOString() : String(row.meUpdatedAt)) : null,
  };
}

/** «ME: Sin info» / «ME: ✅» / «ME: ❌» */
export function meLine(info: Pick<MeInfo, "status"> | null | undefined): string {
  return `ME: ${ME_LABEL[info?.status ?? "SIN_INFO"]}`;
}
