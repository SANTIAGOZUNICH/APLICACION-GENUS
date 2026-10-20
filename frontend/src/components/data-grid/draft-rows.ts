/**
 * Filas en blanco al final de la planilla (como Excel): se escribe directo en ellas y recién cuando la fila está
 * COMPLETA se crea el registro en el servidor. Mientras está incompleta vive solo en el navegador (nunca se guarda una
 * fila a medias en la base) y se conserva en el almacenamiento local para no perder lo escrito ante un corte de conexión.
 */
export type DraftRow = {
  /** Identificador estable: también es el id del registro que se crea, así un reintento NUNCA duplica. */
  id: string;
  values: Record<string, string>;
  status: "editing" | "saving" | "error";
  error?: string;
};

export const DRAFT_PREFIX = "__draft:";
export const isDraftRowId = (id: string) => id.startsWith(DRAFT_PREFIX);
export const draftIdOf = (rowId: string) => rowId.slice(DRAFT_PREFIX.length);

const hasAnyValue = (d: DraftRow) => Object.values(d.values).some((v) => v.trim() !== "");

export function newDraft(makeId: () => string): DraftRow {
  return { id: makeId(), values: {}, status: "editing" };
}

/** Claves obligatorias que todavía están vacías (en el orden dado). */
export function missingRequired(d: DraftRow, requiredKeys: readonly string[]): string[] {
  return requiredKeys.filter((k) => (d.values[k] ?? "").trim() === "");
}

export const isDraftComplete = (d: DraftRow, requiredKeys: readonly string[]) => missingRequired(d, requiredKeys).length === 0;

/** Mantiene SIEMPRE `minBlank` filas totalmente vacías al final (las usadas quedan arriba, en el orden en que se escribieron). */
export function topUpDrafts(drafts: DraftRow[], minBlank: number, makeId: () => string): DraftRow[] {
  const used = drafts.filter((d) => hasAnyValue(d) || d.status !== "editing");
  const blanks = drafts.filter((d) => !(hasAnyValue(d) || d.status !== "editing"));
  const out = [...used, ...blanks.slice(0, minBlank)];
  while (out.length - used.length < minBlank) out.push(newDraft(makeId));
  return out;
}

/** Serializa solo lo que vale la pena conservar (filas con contenido). */
export function serializeDrafts(drafts: DraftRow[]): string {
  return JSON.stringify(drafts.filter(hasAnyValue).map((d) => ({ id: d.id, values: d.values })));
}

export function parseDrafts(raw: string | null): DraftRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: DraftRow[] = [];
    for (const it of parsed as Array<{ id?: unknown; values?: unknown }>) {
      if (typeof it?.id !== "string" || !it.values || typeof it.values !== "object") continue;
      const values: Record<string, string> = {};
      for (const [k, v] of Object.entries(it.values as Record<string, unknown>)) if (typeof v === "string") values[k] = v;
      out.push({ id: it.id, values, status: "editing" });
    }
    return out;
  } catch {
    return [];
  }
}

export type PasteCol = { key: string; title: string; editable: boolean };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Texto del portapapeles (Excel/Sheets: tabulaciones y saltos de línea) → matriz de celdas. */
export function parseClipboardMatrix(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.map((l) => l.split("\t").map((c) => c.trim().replace(/^"([\s\S]*)"$/, "$1")));
}

/**
 * Pegado en filas en blanco: devuelve un registro por fila pegada.
 * - Si la primera fila trae encabezados que coinciden con ≥ 2 columnas (p. ej. «Lote», «Cantidad»), se mapea POR NOMBRE
 *   y esa fila no se carga.
 * - Si no, los valores se reparten en las columnas EDITABLES consecutivas desde la columna activa (se saltean las
 *   columnas calculadas/protegidas, así «Fecha, Descripción, Proveedor…» no cae en «Ingreso Nº»).
 */
export function mapPastedToDrafts(matrix: string[][], columns: PasteCol[], startCol: number): Array<Record<string, string>> {
  if (matrix.length === 0) return [];
  const byTitle = new Map(columns.filter((c) => c.editable).map((c) => [norm(c.title), c.key] as const));
  const head = matrix[0]!.map((c) => byTitle.get(norm(c)) ?? null);
  if (head.filter(Boolean).length >= 2 && matrix.length > 1) {
    return matrix.slice(1).map((cells) => {
      const rec: Record<string, string> = {};
      cells.forEach((v, i) => {
        const key = head[i];
        if (key && v !== "") rec[key] = v;
      });
      return rec;
    });
  }
  const editable = columns.slice(startCol).filter((c) => c.editable);
  return matrix.map((cells) => {
    const rec: Record<string, string> = {};
    cells.forEach((v, i) => {
      const c = editable[i];
      if (c && v !== "") rec[c.key] = v;
    });
    return rec;
  });
}

/** Aplica los registros pegados sobre las filas en blanco desde `startIndex`, agregando filas libres si hacen falta. */
export function applyPastedToDrafts(drafts: DraftRow[], startIndex: number, records: Array<Record<string, string>>, makeId: () => string): { drafts: DraftRow[]; touchedIds: string[] } {
  const out = [...drafts];
  while (out.length < startIndex + records.length) out.push(newDraft(makeId));
  const touchedIds: string[] = [];
  records.forEach((rec, k) => {
    if (Object.keys(rec).length === 0) return;
    const d = out[startIndex + k]!;
    out[startIndex + k] = { ...d, values: { ...d.values, ...rec }, status: "editing", error: undefined };
    touchedIds.push(d.id);
  });
  return { drafts: out, touchedIds };
}
