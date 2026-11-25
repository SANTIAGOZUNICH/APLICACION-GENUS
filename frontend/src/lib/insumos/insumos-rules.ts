/**
 * Módulo INSUMOS — reglas PURAS (sin base ni red): permisos por sector, validación de cantidades,
 * responsables por sector y clave de idempotencia. El servidor y la pantalla usan las mismas reglas.
 */
import { OPERATIONAL_SECTOR_IDS, type SectorId } from "@/types/operational/sector";
import type { InsumoResponsable } from "./types";

/** Sectores operativos que registran retiros (solo de SU propio sector). */
export const INSUMO_REGISTER_SECTORS = ["ENVASADO_MASIVO", "ENVASADO_PREMIUM", "CODIFICADO", "ELABORACION", "MATERIA_PRIMA", "DEPOSITO"] as const satisfies readonly SectorId[];
/** Sectores que consultan reportes, corrigen/anulan y administran catálogo y responsables. */
export const INSUMO_ADMIN_SECTORS = ["ADMINISTRACION", "DIRECCION"] as const satisfies readonly SectorId[];
/** Sectores a los que pertenecen los responsables (los mismos que registran). */
export const INSUMO_RESPONSABLE_SECTORS = INSUMO_REGISTER_SECTORS;

export const MAX_CANTIDAD = 9999;
export const MAX_LINES = 50;
export const MIN_MOTIVO = 3;
export const MAX_MOTIVO = 500;

export function canRegisterInsumos(sector: SectorId | null | undefined): boolean {
  return Boolean(sector && (INSUMO_REGISTER_SECTORS as readonly string[]).includes(sector));
}
export function canAdminInsumos(sector: SectorId | null | undefined): boolean {
  return Boolean(sector && (INSUMO_ADMIN_SECTORS as readonly string[]).includes(sector));
}
export function isInsumoSector(value: string): value is SectorId {
  return (OPERATIONAL_SECTOR_IDS as readonly string[]).includes(value);
}

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

/** Cantidad: entero ≥ 0 (acepta texto numérico entero), tope razonable. */
export function parseCantidad(raw: unknown): Validation<number> {
  const n = typeof raw === "string" ? (raw.trim() === "" ? Number.NaN : Number(raw.trim())) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(n)) return { ok: false, message: "La cantidad tiene que ser un número." };
  if (!Number.isInteger(n)) return { ok: false, message: "La cantidad tiene que ser un número entero." };
  if (n < 0) return { ok: false, message: "La cantidad no puede ser negativa." };
  if (n > MAX_CANTIDAD) return { ok: false, message: `La cantidad no puede superar ${MAX_CANTIDAD}.` };
  return { ok: true, value: n };
}

/** Cuenta de renglones con cantidad > 0 (habilita SIGUIENTE en el paso 1). */
export function hasAnyQuantity(quantities: Record<string, number>): boolean {
  return Object.values(quantities).some((q) => Number.isInteger(q) && q > 0);
}

/**
 * Normaliza los renglones recibidos: descarta los de cantidad 0, rechaza negativos, decimales, ids repetidos o vacíos,
 * y exige al menos un renglón con cantidad > 0. No consulta el catálogo (eso lo hace el servicio).
 */
export function normalizeLines(raw: unknown): Validation<Array<{ insumoId: string; cantidad: number }>> {
  if (!Array.isArray(raw)) return { ok: false, message: "Faltan los insumos del retiro." };
  if (raw.length > MAX_LINES) return { ok: false, message: `Un retiro admite hasta ${MAX_LINES} insumos.` };
  const out: Array<{ insumoId: string; cantidad: number }> = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const row = (r ?? {}) as { insumoId?: unknown; cantidad?: unknown };
    const insumoId = typeof row.insumoId === "string" ? row.insumoId.trim() : "";
    if (!insumoId) return { ok: false, message: "Un renglón no indica el insumo." };
    if (seen.has(insumoId)) return { ok: false, message: "Un insumo no puede repetirse en el mismo retiro." };
    seen.add(insumoId);
    const q = parseCantidad(row.cantidad);
    if (!q.ok) return { ok: false, message: q.message };
    if (q.value > 0) out.push({ insumoId, cantidad: q.value });
  }
  if (out.length === 0) return { ok: false, message: "Cargá al menos un insumo con cantidad mayor a 0." };
  return { ok: true, value: out };
}

/** Un responsable es válido para un retiro si pertenece EXACTAMENTE a ese sector y está activo. */
export function responsableAllowedForSector(r: Pick<InsumoResponsable, "sector" | "active">, sector: SectorId): boolean {
  return r.active && r.sector === sector;
}

/** Responsables que ve (y puede elegir) un sector: solo los suyos y activos, en el orden configurado. */
export function responsablesForSector(all: InsumoResponsable[], sector: SectorId | null): InsumoResponsable[] {
  if (!sector) return [];
  return all.filter((r) => responsableAllowedForSector(r, sector)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"));
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/;
export function isValidClientRequestId(v: unknown): v is string {
  return typeof v === "string" && REQUEST_ID_RE.test(v);
}
/** Clave de idempotencia por intento de retiro (se genera al abrir el formulario y se renueva tras un guardado exitoso). */
export function newClientRequestId(): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `ins-${rnd}`;
}

export function validateMotivo(raw: unknown): Validation<string> {
  const m = typeof raw === "string" ? raw.trim() : "";
  if (m.length < MIN_MOTIVO) return { ok: false, message: "Indicá el motivo (mínimo 3 caracteres)." };
  if (m.length > MAX_MOTIVO) return { ok: false, message: `El motivo no puede superar ${MAX_MOTIVO} caracteres.` };
  return { ok: true, value: m };
}

/** Nombre de catálogo / responsable: se guarda en MAYÚSCULAS, sin espacios dobles. */
export function normalizeName(raw: unknown): Validation<string> {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().toUpperCase() : "";
  if (!s) return { ok: false, message: "Indicá el nombre." };
  if (s.length > 80) return { ok: false, message: "El nombre no puede superar 80 caracteres." };
  return { ok: true, value: s };
}

/** Slug estable para ids de catálogo (sin acentos, minúsculas, guiones). */
export function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
