import { loteShape, normalizeText } from "./normalize";
import type { SmartPasteMasterData } from "./types";

export interface HistoricalRecordForMaster {
  lote?: string | null;
  cliente?: string | null;
  producto?: string | null;
  codigo?: string | null;
}

/**
 * Construye el "diccionario operativo" de Smart Paste a partir de registros
 * REALES ya cargados por la pantalla (nunca una lista manual hardcodeada).
 * Determinístico y barato: es un solo pase sobre los datos que la pantalla
 * ya tiene en memoria (sin requests nuevos — ver auditoría de performance).
 */
export function buildMasterData(records: HistoricalRecordForMaster[]): SmartPasteMasterData {
  const lotes = new Set<string>();
  const loteShapes = new Set<string>();
  const clientesByNormalized = new Map<string, string>();
  const productosByNormalized = new Map<string, string>();
  const codigosByNormalized = new Map<string, string>();
  const productoClientePairs = new Set<string>();

  for (const record of records) {
    const lote = record.lote?.trim();
    if (lote) {
      lotes.add(normalizeText(lote).replace(/\s+/g, ""));
      loteShapes.add(loteShape(lote));
    }
    const cliente = record.cliente?.trim();
    if (cliente) clientesByNormalized.set(normalizeText(cliente), cliente);
    const producto = record.producto?.trim();
    if (producto) productosByNormalized.set(normalizeText(producto), producto);
    const codigo = record.codigo?.trim();
    if (codigo) codigosByNormalized.set(normalizeText(codigo), codigo);
    if (cliente && producto) {
      productoClientePairs.add(`${normalizeText(producto)}::${normalizeText(cliente)}`);
    }
  }

  return {
    lotes,
    loteShapes,
    clientesByNormalized,
    productosByNormalized,
    codigosByNormalized,
    productoClientePairs,
  };
}

/** Une varias fuentes (ej. asignación de lotes + work items) en un solo master-data. */
export function mergeMasterData(...sources: SmartPasteMasterData[]): SmartPasteMasterData {
  const merged = buildMasterData([]);
  for (const src of sources) {
    for (const l of src.lotes) (merged.lotes as Set<string>).add(l);
    for (const s of src.loteShapes) (merged.loteShapes as Set<string>).add(s);
    for (const [k, v] of src.clientesByNormalized) (merged.clientesByNormalized as Map<string, string>).set(k, v);
    for (const [k, v] of src.productosByNormalized) (merged.productosByNormalized as Map<string, string>).set(k, v);
    for (const [k, v] of src.codigosByNormalized) (merged.codigosByNormalized as Map<string, string>).set(k, v);
    for (const p of src.productoClientePairs) (merged.productoClientePairs as Set<string>).add(p);
  }
  return merged;
}
