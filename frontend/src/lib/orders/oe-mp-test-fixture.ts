/**
 * SOLO PRUEBAS: Stock MP en memoria (lotes + libro mayor por código) para entregar OE en tests unitarios.
 * No se importa desde código de la app.
 */
import { resetInventoryServiceForTests } from "@/lib/inventory/get-inventory-service";
import type { InventoryActor } from "@/lib/inventory/inventory-service";
import { getMpStockLedger, resetMpStockMemoryForTests } from "@/lib/mp-stock/mp-stock-ledger";
import type { OeMaterialRow } from "@/lib/orders/types";

export const MP_TEST_ACTOR: InventoryActor = {
  email: "mp@laboratoriogenus.com.ar",
  sector: "MATERIA_PRIMA",
  displayName: "MP",
  isSuperadmin: true,
};

export type MpTestLot = { codigo: string; lote: string; kg: number; descripcion?: string; codigoKg?: number };

/** Limpia inventario + libro mayor en memoria y carga los lotes (y el saldo por código = suma de sus lotes). */
export async function seedMpStockForTests(lots: MpTestLot[]) {
  resetMpStockMemoryForTests();
  const inventory = resetInventoryServiceForTests();
  const ids: Record<string, string> = {};
  const byCode = new Map<string, { kg: number; descripcion: string; override?: number }>();
  for (const l of lots) {
    const row = inventory.upsertMpStock(MP_TEST_ACTOR, {
      codigo: l.codigo,
      lote: l.lote,
      cantidadKg: l.kg,
      descripcion: l.descripcion ?? l.codigo,
    });
    ids[`${l.codigo}|${l.lote}`] = row.id;
    const prev = byCode.get(l.codigo) ?? { kg: 0, descripcion: l.descripcion ?? l.codigo };
    prev.kg += l.kg;
    if (l.codigoKg !== undefined) prev.override = l.codigoKg;
    byCode.set(l.codigo, prev);
  }
  const ledger = getMpStockLedger();
  for (const [codigo, v] of byCode) {
    await ledger.seedSaldoInicialOnce({ email: MP_TEST_ACTOR.email, sector: "MATERIA_PRIMA" }, codigo, v.override ?? v.kg, v.descripcion);
  }
  return { inventory, ids };
}

/** Código/lote de prueba para la fila i (sin consumo real cargado: eso lo decide cada test). */
export const testCodigoMp = (i: number) => `MP-TEST-${i + 1}`;
export const TEST_LOTE = "L-TEST";

/** Completa CÓDIGO MP, LOTE y KG REAL (= kg a pesar, o 1) en las filas con MP. */
export function fillMaterialsForConsumption(materials: OeMaterialRow[]): OeMaterialRow[] {
  return materials.map((m, i) =>
    m.materiaPrima.trim()
      ? { ...m, codigoMp: m.codigoMp || testCodigoMp(i), lote: m.lote || TEST_LOTE, kgReal: m.kgReal ?? m.kgAPesar ?? 1 }
      : m
  );
}

/** Lotes amplios para todas las filas de prueba (hasta `n`). */
export const ampleTestLots = (n = 30, kg = 100000): MpTestLot[] =>
  Array.from({ length: n }, (_, i) => ({ codigo: testCodigoMp(i), lote: TEST_LOTE, kg }));
