import { buildMasterData, type HistoricalRecordForMaster } from "@/lib/smart-paste/master-data";
import type { SmartPasteMasterData, SmartPasteRow } from "@/lib/smart-paste/types";
import type { AsignacionLote, AsignacionLoteUpsertInput } from "@/lib/asignacion-lotes/types";

/**
 * Diccionario operativo de Asignación de Lotes: se construye desde los
 * registros YA cargados por la pantalla (sin requests nuevos — ver
 * auditoría de performance del informe Smart Paste).
 */
export function buildAsignacionLotesMasterData(existing: AsignacionLote[]): SmartPasteMasterData {
  const records: HistoricalRecordForMaster[] = existing.map((item) => ({
    lote: item.lote,
    cliente: item.marca,
    producto: item.producto,
    codigo: item.codigo,
  }));
  return buildMasterData(records);
}

function duplicateKey(lote: string, codigo: string, producto: string): string {
  return `${lote.trim().toLowerCase()}::${codigo.trim().toLowerCase()}::${producto.trim().toLowerCase()}`;
}

/**
 * Clave de duplicado real de este dominio: lote + código + PRODUCTO
 * (ampliada 0038, idéntica a findDuplicateAsignacionLote /
 * asignacion-lotes-service.ts#duplicateKey — no se inventa una regla
 * nueva). Antes solo lote+código: dos productos distintos con el mismo
 * lote y código vacío se marcaban como "duplicado" entre sí aunque fueran
 * asignaciones reales distintas (causa demostrada con datos reales — ver
 * lote G26042 en asignacion-lotes-sync-service.ts). Revisa tanto contra lo
 * YA guardado como contra otras filas del MISMO pegado (para no crear
 * duplicados internos).
 */
export function makeAsignacionLotesDuplicateChecker(
  existing: AsignacionLote[]
): (row: SmartPasteRow) => string | undefined {
  const existingKeys = new Set(existing.map((item) => duplicateKey(item.lote, item.codigo, item.producto)));
  const seenInBatch = new Set<string>();
  return (row: SmartPasteRow) => {
    const lote = row.assignments.lote?.value?.trim();
    const codigo = row.assignments.codigo?.value?.trim() ?? "";
    const producto = row.assignments.producto?.value?.trim() ?? "";
    if (!lote) return undefined;
    const key = duplicateKey(lote, codigo, producto);
    if (existingKeys.has(key)) return `Ya existe una asignación para el lote ${lote}, código "${codigo || "—"}" y producto "${producto || "—"}".`;
    if (seenInBatch.has(key))
      return `Lote ${lote}, código "${codigo || "—"}" y producto "${producto || "—"}" repetido dentro de este mismo pegado.`;
    seenInBatch.add(key);
    return undefined;
  };
}

export function smartPasteRowToAsignacionLoteInput(
  row: SmartPasteRow,
  updatedBy: string,
  fecha: string
): AsignacionLoteUpsertInput {
  return {
    lote: row.assignments.lote?.value ?? "",
    fecha,
    producto: row.assignments.producto?.value ?? "",
    codigo: row.assignments.codigo?.value ?? "",
    marca: row.assignments.cliente?.value ?? "",
    cantidades: row.assignments.cantidad?.value ? Number(row.assignments.cantidad.value) : 0,
    vto: row.assignments.vto?.value ?? null,
    createdBy: updatedBy,
    updatedBy,
  };
}
