/**
 * Presentación compacta de identificadores OE/OA.
 * No altera el valor legal persistido (Neon, PDF, XLSX, auditoría).
 *
 * Ejemplos:
 * - OE-2026-000015 → OE-000015
 * - OA-2026-000122 → OA-000122
 * - ORDEN DE ELABORACION OE-2026-000015 → OE-000015
 */

const FULL_ID_RE = /\b((?:OE|OA))-(\d{4})-(\d{1,6})\b/gi;
const LOOSE_PREFIX_RE =
  /(?:ORDEN\s+DE\s+(?:ELABORACI[OÓ]N|ACONDICIONAMIENTO)\s+)?((?:OE|OA))[-\s]?(\d{4})[-\s]?(\d{1,6})\b/i;

export type OperationalIdKind = "OE" | "OA";

export interface ParsedOperationalId {
  kind: OperationalIdKind;
  year: string;
  sequence: string;
  /** Forma legal completa, p.ej. OE-2026-000015 */
  full: string;
  /** Forma corta de UI, p.ej. OE-000015 */
  compact: string;
}

function padSequence(seq: string): string {
  const digits = seq.replace(/\D/g, "");
  if (!digits) return seq;
  return digits.padStart(6, "0");
}

function buildParsed(kindRaw: string, year: string, seq: string): ParsedOperationalId {
  const kind = kindRaw.toUpperCase() as OperationalIdKind;
  const sequence = padSequence(seq);
  return {
    kind,
    year,
    sequence,
    full: `${kind}-${year}-${sequence}`,
    compact: `${kind}-${sequence}`,
  };
}

/** Extrae el primer OE/OA reconocible de un texto libre. */
export function parseOperationalId(
  value: string | null | undefined
): ParsedOperationalId | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  FULL_ID_RE.lastIndex = 0;
  const strict = FULL_ID_RE.exec(text);
  if (strict) {
    return buildParsed(strict[1], strict[2], strict[3]);
  }

  const loose = LOOSE_PREFIX_RE.exec(text);
  if (loose) {
    return buildParsed(loose[1], loose[2], loose[3]);
  }

  return null;
}

/**
 * Forma corta para UI. Si no hay ID reconocible, devuelve el texto original
 * (trim) o cadena vacía.
 */
export function formatOperationalIdCompact(
  value: string | null | undefined
): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const parsed = parseOperationalId(text);
  return parsed ? parsed.compact : text;
}

/** Forma legal completa si se reconoce; si no, el texto original. */
export function formatOperationalIdFull(
  value: string | null | undefined
): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const parsed = parseOperationalId(text);
  return parsed ? parsed.full : text;
}

/**
 * Reemplaza todos los IDs OE/OA embebidos en un mensaje por su forma corta.
 * Útil en notificaciones y comentarios de movimientos.
 */
export function compactOperationalIdsInText(
  value: string | null | undefined
): string {
  if (value == null) return "";
  const text = String(value);
  if (!text.trim()) return text;

  let out = text;

  // Normalizar frases largas antes de acortar el ID (el orden importa).
  out = out.replace(
    /Salida autom[aá]tica generada por Orden de Elaboraci[oó]n\s+/gi,
    "Salida automática · "
  );
  out = out.replace(/Salida autom[aá]tica OA\s+/gi, "Salida automática · ");
  out = out.replace(/Origen autom[aá]tico · OA\s+/gi, "Origen automático · ");
  out = out.replace(/Origen autom[aá]tico OA\s+/gi, "Origen automático · ");
  out = out.replace(
    /ORDEN\s+DE\s+ELABORACI[OÓ]N\s+/gi,
    ""
  );
  out = out.replace(
    /ORDEN\s+DE\s+ACONDICIONAMIENTO\s+/gi,
    ""
  );

  out = out.replace(FULL_ID_RE, (_m, kind: string, _year: string, seq: string) => {
    return `${String(kind).toUpperCase()}-${padSequence(seq)}`;
  });

  // Si quedó "Salida automática generada por OE-…" (sin el título legal).
  out = out.replace(
    /Salida autom[aá]tica generada por\s+/gi,
    "Salida automática · "
  );

  return out.replace(/\s{2,}/g, " ").trim();
}
