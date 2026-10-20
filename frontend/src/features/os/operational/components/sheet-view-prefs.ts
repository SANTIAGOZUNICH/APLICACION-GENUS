/**
 * Preferencias de vista de una planilla (columnas visibles, anchos, orden y filtros). Lógica pura: se guardan en el
 * navegador por usuario y tabla; nunca tocan los datos ni lo que se guarda en el servidor.
 */
export type SheetViewPrefs = {
  hidden: string[];
  widths: Record<string, number>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  filters: Record<string, string>;
};

export const EMPTY_PREFS: SheetViewPrefs = { hidden: [], widths: {}, sortKey: null, sortDir: "asc", filters: {} };
export const MIN_COL_WIDTH = 60;
export const MAX_COL_WIDTH = 600;

export const prefsKey = (email: string | null | undefined, tableId: string) => `genus-sheet:${email ?? "anon"}:${tableId}`;

export function parsePrefs(raw: string | null): SheetViewPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const p = JSON.parse(raw) as Partial<SheetViewPrefs>;
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((x): x is string => typeof x === "string") : [],
      widths: p.widths && typeof p.widths === "object" ? Object.fromEntries(Object.entries(p.widths).filter(([, v]) => typeof v === "number" && v >= MIN_COL_WIDTH && v <= MAX_COL_WIDTH)) : {},
      sortKey: typeof p.sortKey === "string" ? p.sortKey : null,
      sortDir: p.sortDir === "desc" ? "desc" : "asc",
      filters: p.filters && typeof p.filters === "object" ? Object.fromEntries(Object.entries(p.filters).filter(([, v]) => typeof v === "string" && v.trim() !== "")) : {},
    };
  } catch {
    return EMPTY_PREFS;
  }
}

export function hasActiveFilters(p: SheetViewPrefs): boolean {
  return Object.values(p.filters).some((v) => v.trim() !== "");
}

/** Normaliza para comparar: sin tildes ni mayúsculas. */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Aplica filtros por columna («contiene», sin tildes/mayúsculas) y el orden elegido (números y fechas por valor). */
export function applySheetView<T>(rows: T[], textOf: (key: string, row: T) => string, prefs: SheetViewPrefs): T[] {
  let out = rows;
  const active = Object.entries(prefs.filters).filter(([, v]) => v.trim() !== "");
  if (active.length > 0) {
    out = out.filter((r) => active.every(([key, needle]) => norm(textOf(key, r)).includes(norm(needle.trim()))));
  }
  if (prefs.sortKey) {
    const key = prefs.sortKey;
    const dir = prefs.sortDir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const ta = textOf(key, a).trim();
      const tb = textOf(key, b).trim();
      if (ta === "" && tb !== "") return 1; // vacíos siempre al final
      if (tb === "" && ta !== "") return -1;
      const na = Number(ta.replace(/\./g, "").replace(",", "."));
      const nb = Number(tb.replace(/\./g, "").replace(",", "."));
      if (ta !== "" && tb !== "" && Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
      return ta.localeCompare(tb, "es", { numeric: true, sensitivity: "base" }) * dir;
    });
  }
  return out;
}

/** Cambia el ancho de una columna dentro de los límites. */
export function withWidth(p: SheetViewPrefs, key: string, width: number): SheetViewPrefs {
  const w = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(width)));
  return { ...p, widths: { ...p.widths, [key]: w } };
}

/** Oculta/muestra una columna. Las columnas bloqueadas (obligatorias para crear filas) nunca se ocultan. */
export function toggleHidden(p: SheetViewPrefs, key: string, locked: readonly string[]): SheetViewPrefs {
  if (locked.includes(key)) return p;
  return { ...p, hidden: p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key] };
}
