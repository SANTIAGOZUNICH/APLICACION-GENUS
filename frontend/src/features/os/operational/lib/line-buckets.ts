/** Normaliza el campo `line` de un WorkItem a un bucket de línea de envasado. */

export type LineBucket = "1" | "2" | "3" | "opcional";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** Heurística tolerante: "LÍNEA 1", "L1", "PREMIUM A", "LINEA OPCIONAL" → bucket. */
export function resolveLineBucket(line: string | null | undefined): LineBucket | null {
  if (!line) return null;
  const n = normalize(line);

  if (/OPCIONAL|\bL4\b|\bLINEA\s*4\b|\bD\b/.test(n)) return "opcional";
  if (/\b1\b|\bA\b/.test(n)) return "1";
  if (/\b2\b|\bB\b/.test(n)) return "2";
  if (/\b3\b|\bC\b/.test(n)) return "3";
  return null;
}

export const LINE_TAB_LABELS: Record<LineBucket, string> = {
  "1": "Línea 1",
  "2": "Línea 2",
  "3": "Línea 3",
  opcional: "Línea opcional",
};
