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
