/**
 * Módulo INSUMOS — agregaciones y filtros PUROS (cliente y servidor). Los días/semanas/meses se calculan en hora de
 * Buenos Aires (UTC-3 fijo, sin horario de verano). Los retiros ANULADOS nunca suman en los totales.
 */
import { SECTOR_LABELS, type SectorId } from "@/types/operational/sector";
import type { InsumoFilters, Retiro } from "./types";

const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** AAAA-MM-DD del instante en Buenos Aires. */
export function arDayKey(input: string | number | Date): string {
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : new Date(input).getTime();
  return new Date(ms - AR_OFFSET_MS).toISOString().slice(0, 10);
}
/** HH:MM del instante en Buenos Aires. */
export function arTime(input: string | number | Date): string {
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : new Date(input).getTime();
  return new Date(ms - AR_OFFSET_MS).toISOString().slice(11, 16);
}

const addDays = (day: string, n: number): string => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Lunes de la semana del día dado. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}
export const monthKey = (day: string): string => day.slice(0, 7);

export type Granularity = "day" | "week" | "month";
export function bucketKey(day: string, g: Granularity): string {
  return g === "day" ? day : g === "week" ? weekStart(day) : monthKey(day);
}

export type PeriodPreset = "hoy" | "semana" | "mes";
/** Rango (desde/hasta inclusivos, AAAA-MM-DD) de los atajos Hoy / Esta semana / Este mes. */
export function presetRange(preset: PeriodPreset, now: Date | number = Date.now()): { from: string; to: string } {
  const today = arDayKey(now);
  if (preset === "hoy") return { from: today, to: today };
  if (preset === "semana") {
    const from = weekStart(today);
    return { from, to: addDays(from, 6) };
  }
  const from = `${monthKey(today)}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

/** Instante de inicio / fin (UTC) de un día de Buenos Aires, para filtrar en SQL. */
export const dayStartInstant = (day: string): Date => new Date(`${day}T00:00:00-03:00`);
export const dayEndInstant = (day: string): Date => new Date(`${day}T23:59:59.999-03:00`);

/** Filtra retiros (incluye anulados: el historial los muestra). Con filtro de insumo solo quedan los retiros que lo contienen. */
export function filterRetiros(retiros: Retiro[], f: InsumoFilters): Retiro[] {
  return retiros.filter((r) => {
    const day = arDayKey(r.createdAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.sector && r.sector !== f.sector) return false;
    if (f.responsableId && r.responsableId !== f.responsableId) return false;
    if (f.insumoId && !r.lines.some((l) => l.insumoId === f.insumoId && l.cantidad > 0)) return false;
    return true;
  });
}

export type InsumoTotal = { insumoId: string; insumoName: string; cantidad: number; retiros: number };
export type SectorTotal = { sector: SectorId; retiros: number; unidades: number; porInsumo: Record<string, number> };
export type ResponsableTotal = { responsableId: string; responsableName: string; sector: SectorId; retiros: number; unidades: number };
export type SeriesPoint = { key: string; label: string; total: number; porInsumo: Record<string, number> };

export type Aggregation = {
  retiros: number;
  unidades: number;
  porInsumo: InsumoTotal[];
  porSector: SectorTotal[];
  porResponsable: ResponsableTotal[];
  serie: SeriesPoint[];
};

const keyLabel = (key: string, g: Granularity): string => {
  if (g === "month") {
    const [y, m] = key.split("-");
    return `${m}/${y}`;
  }
  const [, m, d] = key.split("-");
  return g === "week" ? `Sem. ${d}/${m}` : `${d}/${m}`;
};

/**
 * Totales del período. Con `insumoId` solo se cuentan los renglones de ESE insumo (y los retiros que lo contienen).
 * Los retiros ANULADOS se excluyen siempre.
 */
export function aggregateRetiros(retiros: Retiro[], f: InsumoFilters = {}, granularity: Granularity = "day"): Aggregation {
  const active = filterRetiros(retiros, f).filter((r) => r.status === "ACTIVO");
  const insumos = new Map<string, InsumoTotal>();
  const sectores = new Map<string, SectorTotal>();
  const responsables = new Map<string, ResponsableTotal>();
  const serie = new Map<string, SeriesPoint>();
  let unidades = 0;
  let count = 0;

  for (const r of active) {
    const lines = r.lines.filter((l) => l.cantidad > 0 && (!f.insumoId || l.insumoId === f.insumoId));
    if (lines.length === 0) continue;
    count += 1;
    const sub = lines.reduce((s, l) => s + l.cantidad, 0);
    unidades += sub;

    const sec = sectores.get(r.sector) ?? { sector: r.sector, retiros: 0, unidades: 0, porInsumo: {} };
    sec.retiros += 1;
    sec.unidades += sub;
    sectores.set(r.sector, sec);

    const resp = responsables.get(r.responsableId) ?? { responsableId: r.responsableId, responsableName: r.responsableName, sector: r.sector, retiros: 0, unidades: 0 };
    resp.retiros += 1;
    resp.unidades += sub;
    responsables.set(r.responsableId, resp);

    const bucket = bucketKey(arDayKey(r.createdAt), granularity);
    const point = serie.get(bucket) ?? { key: bucket, label: keyLabel(bucket, granularity), total: 0, porInsumo: {} };
    point.total += sub;
    serie.set(bucket, point);

    for (const l of lines) {
      const it = insumos.get(l.insumoId) ?? { insumoId: l.insumoId, insumoName: l.insumoName, cantidad: 0, retiros: 0 };
      it.cantidad += l.cantidad;
      it.retiros += 1;
      insumos.set(l.insumoId, it);
      sec.porInsumo[l.insumoId] = (sec.porInsumo[l.insumoId] ?? 0) + l.cantidad;
      point.porInsumo[l.insumoId] = (point.porInsumo[l.insumoId] ?? 0) + l.cantidad;
    }
  }

  return {
    retiros: count,
    unidades,
    porInsumo: [...insumos.values()].sort((a, b) => b.cantidad - a.cantidad || a.insumoName.localeCompare(b.insumoName, "es")),
    porSector: [...sectores.values()].sort((a, b) => b.unidades - a.unidades),
    porResponsable: [...responsables.values()].sort((a, b) => b.unidades - a.unidades || a.responsableName.localeCompare(b.responsableName, "es")),
    serie: [...serie.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export const INSUMO_EXPORT_HEADERS = ["FECHA", "HORA", "SECTOR", "RESPONSABLE", "INSUMO", "CANTIDAD", "REGISTRADO POR", "ESTADO", "MOTIVO DE ANULACIÓN"];

/** Filas del Excel del historial (un renglón por insumo). Respeta los filtros; con filtro de insumo, solo ese insumo. Los anulados salen marcados. */
export function retirosToRows(retiros: Retiro[], f: InsumoFilters = {}): string[][] {
  const rows: string[][] = [];
  for (const r of filterRetiros(retiros, f).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const day = arDayKey(r.createdAt);
    const [y, m, d] = day.split("-");
    for (const l of r.lines) {
      if (f.insumoId && l.insumoId !== f.insumoId) continue;
      rows.push([`${d}/${m}/${y}`, arTime(r.createdAt), SECTOR_LABELS[r.sector] ?? r.sector, r.responsableName, l.insumoName, String(l.cantidad), r.registradoPorName || r.registradoPorEmail, r.status === "ANULADO" ? "ANULADO" : "ACTIVO", r.anuladoMotivo ?? ""]);
    }
  }
  return rows;
}
