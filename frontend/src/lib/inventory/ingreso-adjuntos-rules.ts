/**
 * Fotos/archivos de remito de los ingresos de MP y ME — reglas PURAS (cliente y servidor).
 * Solo imágenes: JPG/JPEG, PNG y HEIC/HEIF (iPhone). Nunca tocan cantidades ni stock.
 */
import type { SectorId } from "@/types/operational/sector";
import { canReadInventory, canWriteInventory } from "@/lib/inventory/rbac";

export type IngresoAdjuntoModule = "MP" | "ME";

export const ADJUNTO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"] as const;
const EXT_TO_TYPE: Record<string, (typeof ADJUNTO_ALLOWED_TYPES)[number]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

/**
 * Tamaño máximo por archivo que llega al servidor. Vercel corta los pedidos de más de ~4,5 MB antes de que corra el
 * código; el navegador achica las fotos (JPG/PNG) antes de subirlas, así que una foto de celular entra holgada.
 */
export const ADJUNTO_MAX_BYTES = 4 * 1024 * 1024;
/** Máximo de fotos activas por ingreso. */
export const ADJUNTO_MAX_PER_INGRESO = 20;

export type AdjuntoValidation = { ok: true; contentType: string } | { ok: false; message: string };

/** Valida formato (por tipo y extensión) y tamaño. El tipo que manda el navegador puede venir vacío (HEIC en Windows). */
export function validateAdjuntoFile(input: { name: string; type: string; size: number }): AdjuntoValidation {
  const ext = (input.name.split(".").pop() ?? "").toLowerCase();
  const byExt = EXT_TO_TYPE[ext];
  const declared = (input.type || "").toLowerCase();
  const contentType = (ADJUNTO_ALLOWED_TYPES as readonly string[]).includes(declared) ? declared : byExt;
  if (!contentType) {
    return { ok: false, message: `«${input.name}»: formato no permitido. Usá fotos JPG, JPEG, PNG o HEIC.` };
  }
  if (!(input.size > 0)) return { ok: false, message: `«${input.name}» está vacío.` };
  if (input.size > ADJUNTO_MAX_BYTES) {
    const mb = (input.size / 1024 / 1024).toFixed(1).replace(".", ",");
    return { ok: false, message: `«${input.name}» pesa ${mb} MB: el máximo es 4 MB. Sacá la foto desde GENUS OS o en JPG.` };
  }
  return { ok: true, contentType };
}

/** Comprueba la firma real del archivo (no alcanza con el nombre). */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12) {
    const box = String.fromCharCode(...bytes.slice(4, 8));
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (box === "ftyp" && ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "heif"].includes(brand)) return "image/heic";
  }
  return null;
}

export function adjuntoInventoryModule(module: IngresoAdjuntoModule) {
  return module === "MP" ? ("mp_ingresos" as const) : ("me_ingresos" as const);
}

/** Ver fotos: quien puede ver los ingresos de ese módulo. */
export function canViewAdjuntos(sector: SectorId | undefined, module: IngresoAdjuntoModule): boolean {
  return canReadInventory(sector, adjuntoInventoryModule(module));
}

/** Adjuntar/quitar fotos: quien puede cargar ingresos (MP: Materia Prima; ME: Depósito; Dirección en ambos). */
export function canManageAdjuntos(sector: SectorId | undefined, module: IngresoAdjuntoModule): boolean {
  return canWriteInventory(sector, adjuntoInventoryModule(module));
}

export function parseAdjuntoModule(raw: unknown): IngresoAdjuntoModule | null {
  const v = String(raw ?? "").trim().toUpperCase();
  return v === "MP" || v === "ME" ? v : null;
}

export type IngresoAdjunto = {
  id: string;
  module: IngresoAdjuntoModule;
  ingresoId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedBySector: string;
  uploadedAt: string;
};
