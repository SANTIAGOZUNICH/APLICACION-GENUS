/**
 * @mock-temp Repositorio demo de Stock de Materias Primas — localStorage.
 * Capa de adapter aislada de la UI; reemplazable por MATERIAS_PRIMAS/SALDOS reales
 * (docss/03-modelo-de-datos.md) sin tocar los componentes visuales.
 */

export interface MateriaPrimaLot {
  id: string;
  codigo: string;
  nombre: string;
  lote: string;
  stock: number;
  unidad: string;
  /** ISO YYYY-MM-DD — null si no se pudo interpretar la fecha pegada. */
  vencimiento: string | null;
  updatedAt: string;
  updatedBy?: string;
}

export type MateriaPrimaEstado = "disponible" | "por_vencer" | "vencido" | "agotado";

const STORAGE_KEY = "genus_os_mp_stock";
const POR_VENCER_DAYS = 60;

function readAll(): MateriaPrimaLot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedDemoStock();
    return JSON.parse(raw) as MateriaPrimaLot[];
  } catch {
    return [];
  }
}

function writeAll(items: MateriaPrimaLot[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function seedDemoStock(): MateriaPrimaLot[] {
  const now = new Date().toISOString();
  const seed: MateriaPrimaLot[] = [
    { id: "seed-1", codigo: "MP-010", nombre: "Agua desmineralizada", lote: "L-701", stock: 850, unidad: "kg", vencimiento: null, updatedAt: now },
    { id: "seed-2", codigo: "MP-035", nombre: "Glicerina", lote: "L-902", stock: 45, unidad: "kg", vencimiento: "2028-08-31", updatedAt: now },
    { id: "seed-3", codigo: "MP-118", nombre: "Ácido cítrico", lote: "L-450", stock: 12, unidad: "kg", vencimiento: "2026-09-30", updatedAt: now },
    { id: "seed-4", codigo: "MP-204", nombre: "Fragancia Vitamin Shock", lote: "L-330", stock: 0, unidad: "kg", vencimiento: "2027-01-31", updatedAt: now },
  ];
  writeAll(seed);
  return seed;
}

export function getAllMateriasPrimas(): MateriaPrimaLot[] {
  return [...readAll()].sort((a, b) => a.codigo.localeCompare(b.codigo, "es"));
}

export function getStockByCodigo(codigo: string): MateriaPrimaLot[] {
  return readAll().filter((mp) => mp.codigo.trim().toLowerCase() === codigo.trim().toLowerCase());
}

export function getTotalStockByCodigo(codigo: string): number {
  return getStockByCodigo(codigo).reduce((sum, mp) => sum + mp.stock, 0);
}

export function resolveEstado(mp: MateriaPrimaLot): MateriaPrimaEstado {
  if (mp.stock <= 0) return "agotado";
  if (mp.vencimiento) {
    const venceEn = new Date(mp.vencimiento).getTime();
    const now = Date.now();
    if (venceEn < now) return "vencido";
    if (venceEn - now < POR_VENCER_DAYS * 24 * 60 * 60 * 1000) return "por_vencer";
  }
  return "disponible";
}

export function upsertMateriaPrima(
  input: Omit<MateriaPrimaLot, "id" | "updatedAt"> & { id?: string }
): MateriaPrimaLot {
  const items = readAll();
  const record: MateriaPrimaLot = {
    id: input.id ?? `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    codigo: input.codigo.trim(),
    nombre: input.nombre.trim(),
    lote: input.lote.trim(),
    stock: input.stock,
    unidad: input.unidad.trim(),
    vencimiento: input.vencimiento,
    updatedAt: new Date().toISOString(),
    updatedBy: input.updatedBy,
  };
  const idx = items.findIndex((i) => i.id === record.id);
  if (idx >= 0) items[idx] = record;
  else items.push(record);
  writeAll(items);
  return record;
}

export function removeMateriaPrima(id: string): void {
  writeAll(readAll().filter((i) => i.id !== id));
}

/** Parsea texto pegado desde Excel: Código \t Materia prima \t Lote \t Stock \t Unidad \t Vencimiento. */
export function parseClipboardRows(
  text: string
): Array<Omit<MateriaPrimaLot, "id" | "updatedAt">> {
  return text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cols = line.split("\t").map((c) => c.trim());
      const [codigo = "", nombre = "", lote = "", stockRaw = "", unidad = "kg", vencimientoRaw = ""] = cols;
      return {
        codigo,
        nombre,
        lote,
        stock: parseStockValue(stockRaw),
        unidad: unidad || "kg",
        vencimiento: parseVencimiento(vencimientoRaw),
      };
    })
    .filter((row) => row.codigo && row.nombre);
}

function parseStockValue(raw: string): number {
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

/** Acepta MM/AAAA (fin de mes) o DD/MM/AAAA. */
function parseVencimiento(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const mmYyyy = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYyyy) {
    const month = Number(mmYyyy[1]);
    const year = Number(mmYyyy[2]);
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }

  const ddMmYyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddMmYyyy) {
    const day = Number(ddMmYyyy[1]);
    const month = Number(ddMmYyyy[2]);
    const year = Number(ddMmYyyy[3]);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const isoLike = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoLike) return trimmed;

  return null;
}
