/**
 * Reglas PURAS de la identidad de cliente del portal (sin E/S). Un cliente es un NOMBRE de GENUS OS (no hay tabla de clientes:
 * es texto en pedidos, trabajos y entregas). La identidad del portal vincula ese nombre normalizado con un código estable.
 */
import { clientKey } from "@/lib/entregas/rules";

const PLACEHOLDERS = new Set(["", "-", "--", "---", "—", "?", "??", "s/d", "sd", "n/a", "na", "s/n", "sin cliente", "sin definir", "a definir", "ninguno", "null", "undefined"]);

export type NormalizedClientName = { label: string; key: string };

/** Nombre limpio (espacios colapsados) y su clave de comparación; null si no es un nombre de cliente real. */
export function normalizeClientName(raw: unknown): NormalizedClientName | null {
  if (typeof raw !== "string") return null;
  const label = raw.replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > 120) return null;
  if (PLACEHOLDERS.has(label.toLowerCase())) return null;
  const key = clientKey(label);
  if (!key || key.length < 2 || /^[\d\W_]+$/.test(key)) return null;
  return { label, key };
}

const LEGAL_SUFFIX = /\b(s\.?\s?a\.?\s?s?|s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?|sociedad anonima|srl|sas|sa|ltda|inc|llc|cia|y cia|hnos|hermanos)\b\.?$/;

/** Clave "aproximada" para avisar posibles duplicados (mismo nombre sin sufijo societario). NO se usa para asignar códigos. */
export function similarityKey(key: string): string {
  let k = key.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) k = k.replace(LEGAL_SUFFIX, "").trim();
  return k;
}

export type NameStat = { key: string; labels: Map<string, number>; works: number; pedidos: number; entregas: number };

/** Nombre a mostrar: la escritura más frecuente (empate: la más corta, luego alfabética). */
export function pickDisplayName(labels: ReadonlyMap<string, number>): string {
  return [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))[0]![0];
}
