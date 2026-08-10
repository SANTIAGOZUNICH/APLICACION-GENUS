/**
 * Normalización y compatibilidad de números OA para asignación de trabajos.
 */

export const OA_NUMBER_PATTERN = /^OA-\d{4}-\d{1,8}$/;

/** trim + uppercase; colapsa espacios internos. */
export function normalizeOaOrderNumber(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw).trim().replace(/\s+/g, "").toUpperCase();
}

export function isValidOaOrderNumber(normalized: string): boolean {
  return OA_NUMBER_PATTERN.test(normalized);
}

/** Extrae año y secuencia numérica de OA-YYYY-######. */
export function parseOaOrderNumber(
  normalized: string
): { year: number; seq: number } | null {
  const m = normalized.match(/^OA-(\d{4})-(\d{1,8})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const seq = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(seq) || seq < 1) return null;
  return { year, seq };
}

export type FieldCompat = "ok" | "fill_empty" | "mismatch";

export function compareCompatField(
  existing: string | null | undefined,
  incoming: string | null | undefined
): FieldCompat {
  const a = (existing ?? "").trim();
  const b = (incoming ?? "").trim();
  if (!b) return "ok";
  if (!a) return "fill_empty";
  if (a.toLocaleLowerCase("es") === b.toLocaleLowerCase("es")) return "ok";
  return "mismatch";
}

export type OaCompatSnapshot = {
  product: string;
  client: string;
  lot: string;
  vto: string;
  code: string;
};

export type OaCompatMismatch = {
  field: keyof OaCompatSnapshot;
  existing: string;
  incoming: string;
};

export type OaCompatResult = {
  mismatches: OaCompatMismatch[];
  fills: Partial<OaCompatSnapshot>;
};

export function evaluateOaCompatibility(
  existing: OaCompatSnapshot,
  incoming: OaCompatSnapshot
): OaCompatResult {
  const mismatches: OaCompatMismatch[] = [];
  const fills: Partial<OaCompatSnapshot> = {};
  const fields: (keyof OaCompatSnapshot)[] = [
    "product",
    "client",
    "lot",
    "vto",
    "code",
  ];
  for (const field of fields) {
    const result = compareCompatField(existing[field], incoming[field]);
    if (result === "mismatch") {
      mismatches.push({
        field,
        existing: (existing[field] ?? "").trim(),
        incoming: (incoming[field] ?? "").trim(),
      });
    } else if (result === "fill_empty") {
      fills[field] = (incoming[field] ?? "").trim();
    }
  }
  return { mismatches, fills };
}

export function formatOaCompatibilityMessage(
  orderNumber: string,
  mismatches: OaCompatMismatch[]
): string {
  const labels: Record<keyof OaCompatSnapshot, string> = {
    product: "producto",
    client: "cliente",
    lot: "lote",
    vto: "VTO",
    code: "código",
  };
  const parts = mismatches.map((m) => labels[m.field]);
  const joined =
    parts.length <= 1
      ? parts[0] ?? "datos"
      : `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
  return `La ${orderNumber} ya existe con otro ${joined}. Revisá los datos antes de continuar.`;
}

export const PACKAGING_OA_SECTORS = [
  "ENVASADO_MASIVO",
  "ENVASADO_PREMIUM",
  "CODIFICADO",
] as const;

export type PackagingOaSector = (typeof PACKAGING_OA_SECTORS)[number];

export function isPackagingOaSector(sector: string): sector is PackagingOaSector {
  return (PACKAGING_OA_SECTORS as readonly string[]).includes(sector);
}
