/**
 * Hotfix: INGRESO tardío de Material de Empaque.
 * El orden de CARGA no es el orden físico: consumo OA primero, ingreso después.
 * STOCK = Σ ingresos − Σ consumos OA ± ajustes (derivado del ledger persistido).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryService } from "@/lib/inventory/inventory-service";
import { applyOaDeliveryToMe, assertNoSilentNegative } from "@/lib/inventory/me-oa-bridge";
import { createEmptyOaContent, emptyOaMaterial, normalizeOrderContent } from "@/lib/orders/content";
import type { OperationalOrderRecord } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

const deposito = { email: "deposito@laboratoriogenus.com.ar", sector: "DEPOSITO" as SectorId };
const envasado = {
  email: "envasado@laboratoriogenus.com.ar",
  sector: "ENVASADO_MASIVO" as SectorId,
  displayName: "Envasado",
};
const produccion = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION" as SectorId,
  displayName: "Producción",
};

const CODIGO = "FRASCO-X";

function makeOa(id: string, number: string, usados: string): OperationalOrderRecord {
  const content = createEmptyOaContent({ productName: "Crema", client: "Cliente X" });
  content.materials = [
    emptyOaMaterial(1, { id: `${id}-line`, codigo: CODIGO, nombreInsumo: "FRASCO X", usados }),
  ];
  const normalized = normalizeOrderContent(content);
  const now = new Date().toISOString();
  return {
    id,
    orderNumber: number,
    type: "OA",
    templateId: "t",
    templateVersion: 1,
    templateSnapshot: normalized,
    product: "Crema",
    client: "Cliente X",
    code: "C1",
    lot: "L1",
    assignedSector: "ENVASADO_MASIVO",
    formulaProductId: null,
    formulaVersionId: null,
    formulaVersionHash: null,
    status: "COMPLETA",
    formData: normalized,
    completionPercentage: 100,
    revision: 1,
    version: 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    completedBy: null,
    createdBy: envasado.email,
    updatedBy: envasado.email,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
  };
}

let repo: MemoryInventoryRepo;
let svc: InventoryService;

beforeEach(() => {
  repo = new MemoryInventoryRepo();
  svc = new InventoryService(repo);
});

function consumir(usados: string, id = "oa-1", number = "OA-2026-000001") {
  // Envasado entrega la OA antes de que Depósito cargue el ingreso (stock temporal negativo).
  return applyOaDeliveryToMe(svc, produccion, makeOa(id, number, usados), {
    allowNegativeStock: true,
    negativeReason: "ingreso físico pendiente de carga",
  });
}

function ingresar(cantidad: number, extra: Record<string, unknown> = {}) {
  return svc.upsertMeIngresoWithSummary(deposito, {
    codigo: CODIGO,
    descripcionInsumo: "FRASCO X",
    bultos: 1,
    cantidad,
    ...extra,
  });
}

function stock() {
  return svc.listMeInventario(deposito).find((r) => r.codigo === CODIGO)?.cantidadTotal;
}

function consumos() {
  return svc.listMeSalidas(deposito).filter((s) => s.origen === "OA" && !s.reverted);
}

describe("Ingreso tardío ME", () => {
  it("caso 1: ingreso +1000 y consumo -600 → 400", () => {
    ingresar(1000);
    consumir("600");
    expect(stock()).toBe(400);
  });

  it("caso 2: consumo -600 primero, ingreso +1000 después → 400 (y se muestra como tardío)", () => {
    consumir("600");
    expect(stock()).toBe(-600);
    const res = ingresar(1000);
    expect(stock()).toBe(400);
    expect(res.stockSummary).toMatchObject({
      ingresoRegistrado: 1000,
      consumoAcumulado: 600,
      stockActual: 400,
      negativo: false,
      ingresoTardio: true,
    });
  });

  it("caso 3: consumo -600, ingreso +500 → -100 permitido con warning", () => {
    consumir("600");
    const res = ingresar(500);
    expect(res.id).toBeTruthy();
    expect(stock()).toBe(-100);
    expect(res.stockSummary.negativo).toBe(true);
    expect(res.stockSummary.stockActual).toBe(-100);
    expect(svc.listMeIngresos(deposito)).toHaveLength(1);
  });

  it("caso 4: ingreso tardío NO duplica ni toca el consumo de la OA", () => {
    consumir("600");
    const antes = consumos();
    expect(antes).toHaveLength(1);
    ingresar(1000);
    const despues = consumos();
    expect(despues).toHaveLength(1);
    expect(despues[0]).toEqual(antes[0]);
    expect(despues[0]!.total).toBe(600);
    expect(svc.listMeIngresos(deposito)).toHaveLength(1);
    expect(stock()).toBe(400);
    // Reintentar la entrega de la misma OA tampoco duplica (idempotencia por oaId+versión+línea).
    consumir("600");
    expect(consumos()).toHaveLength(1);
    expect(stock()).toBe(400);
  });

  it("caso 5: dos ingresos +500 +500 y consumo -600 → 400", () => {
    consumir("600");
    ingresar(500);
    expect(stock()).toBe(-100);
    ingresar(500);
    expect(stock()).toBe(400);
  });

  it("caso 6: ingreso tardío con fecha efectiva anterior → historial cronológico correcto", () => {
    consumir("600"); // consumo cargado "hoy"
    const hoy = consumos()[0]!.fecha;
    ingresar(1000, { fecha: "2000-01-05" }); // fecha real anterior al consumo
    const mat = svc.listMeMaterials(deposito)[0]!;
    const ledger = svc.getMeLedger(deposito, mat.id);
    expect(ledger.map((e) => [e.tipo, e.cantidad, e.saldo])).toEqual([
      ["INGRESO", 1000, 1000],
      ["CONSUMO", -600, 400],
    ]);
    expect(ledger[0]!.fecha).toBe("2000-01-05");
    expect(ledger[1]!.fecha).toBe(hoy);
    // La fecha efectiva se conserva aunque createdAt (carga) sea posterior al consumo.
    expect(ledger[0]!.createdAt >= ledger[1]!.createdAt).toBe(true);
    expect(ledger[0]!.usuario).toBe(deposito.email);
    expect(ledger[1]!.oaNumber).toBe("OA-2026-000001");
  });

  it("caso 7: operaciones concurrentes (snapshots hidratados del mismo estado) no pierden movimientos", () => {
    ingresar(100);
    const base = JSON.parse(JSON.stringify(repo)) as MemoryInventoryRepo;
    const load = () => {
      const r = new MemoryInventoryRepo();
      Object.assign(r, JSON.parse(JSON.stringify(base)));
      return { r, s: new InventoryService(r) };
    };
    // Request A: Depósito carga ingreso; Request B: Envasado registra consumo.
    const a = load();
    a.s.upsertMeIngreso(deposito, { codigo: CODIGO, descripcionInsumo: "FRASCO X", bultos: 1, cantidad: 1000 });
    const b = load();
    applyOaDeliveryToMe(b.s, produccion, makeOa("oa-2", "OA-2026-000002", "600"), {
      allowNegativeStock: true,
      negativeReason: "x",
    });
    // persistInventorySnapshot = upsert por id (sin wipe): unión de ambas escrituras.
    const merged = new MemoryInventoryRepo();
    const byId = <T extends { id: string }>(x: T[], y: T[]) => [
      ...new Map([...x, ...y].map((row) => [row.id, row])).values(),
    ];
    merged.meIngresos = byId(a.r.meIngresos, b.r.meIngresos);
    merged.meSalidas = byId(a.r.meSalidas, b.r.meSalidas);
    merged.meMaterials = byId(a.r.meMaterials, b.r.meMaterials);
    const s2 = new InventoryService(merged);
    const inv = s2.listMeInventario(deposito).find((r) => r.codigo === CODIGO);
    expect(merged.meIngresos).toHaveLength(2);
    expect(merged.meSalidas.filter((x) => x.origen === "OA")).toHaveLength(1);
    expect(inv?.cantidadTotal).toBe(100 + 1000 - 600);
  });

  it("caso 8: refrescar (re-hidratar desde filas persistidas) mantiene el mismo saldo", () => {
    consumir("600");
    ingresar(1000);
    const persisted = JSON.parse(JSON.stringify(repo)) as MemoryInventoryRepo;
    const fresh = new MemoryInventoryRepo();
    Object.assign(fresh, persisted);
    // Aunque el stockActual almacenado esté desactualizado, el saldo se deriva del ledger.
    fresh.meMaterials = fresh.meMaterials.map((m) => ({ ...m, stockActual: 12345 }));
    const s2 = new InventoryService(fresh);
    expect(s2.listMeInventario(deposito)[0]?.cantidadTotal).toBe(400);
    expect(s2.listMeMaterials(deposito)[0]?.stockActual).toBe(400);
  });

  it("anular un ingreso con consumo posterior no se bloquea: el negativo queda visible", () => {
    const ing = ingresar(1000);
    consumir("600");
    svc.anularMeIngreso(deposito, ing.id, "carga duplicada");
    expect(stock()).toBe(-600);
    expect(consumos()).toHaveLength(1);
  });

  it("editar un ingreso con consumo existente recalcula sin duplicar", () => {
    consumir("600");
    const ing = ingresar(500);
    expect(stock()).toBe(-100);
    svc.upsertMeIngreso(deposito, { id: ing.id, cantidad: 1000, bultos: 1 });
    expect(stock()).toBe(400);
    expect(svc.listMeIngresos(deposito)).toHaveLength(1);
    expect(consumos()).toHaveLength(1);
  });
});

describe("Consumo OA no bloqueante (ledger)", () => {
  it("A: stock 0 + consumo OA -600 se guarda sin flags ni motivo → -600", () => {
    // Sin allowNegativeStock/negativeReason: el movimiento real nunca se rechaza.
    const rows = applyOaDeliveryToMe(svc, produccion, makeOa("oa-1", "OA-2026-000001", "600"));
    expect(rows).toHaveLength(1);
    expect(stock()).toBe(-600);
    expect(consumos()).toHaveLength(1);
  });

  it("assertNoSilentNegative: confirmar alcanza; el motivo es opcional", () => {
    const shortage = [
      { codigo: CODIGO, material: "FRASCO X", materialId: null, stockDisponible: 0, cantidadSolicitada: 600, diferencia: 600 },
    ];
    expect(() => assertNoSilentNegative(shortage, {})).toThrow();
    expect(() => assertNoSilentNegative(shortage, { allowNegativeStock: true })).not.toThrow();
  });

  it("B/C: luego ingreso +1000 → 400, y reconsultar desde filas persistidas sigue en 400", () => {
    consumir("600");
    ingresar(1000);
    expect(stock()).toBe(400);
    const fresh = new MemoryInventoryRepo();
    Object.assign(fresh, JSON.parse(JSON.stringify(repo)));
    expect(new InventoryService(fresh).listMeInventario(deposito)[0]?.cantidadTotal).toBe(400);
  });

  it("D: reentregar la misma OA no genera un segundo -600", () => {
    consumir("600");
    consumir("600");
    consumir("600");
    expect(consumos()).toHaveLength(1);
    expect(stock()).toBe(-600);
  });

  it("E: dos OA distintas → ambos consumos persisten", () => {
    ingresar(1000);
    consumir("600", "oa-1", "OA-2026-000001");
    consumir("300", "oa-2", "OA-2026-000002");
    expect(consumos()).toHaveLength(2);
    expect(stock()).toBe(100);
  });

  it("G: editar ingreso +1000 → +1200 con consumo -600 → 600, consumo intacto", () => {
    const ing = ingresar(1000);
    consumir("600");
    const consumoAntes = consumos()[0]!;
    svc.upsertMeIngreso(deposito, { id: ing.id, bultos: 1, cantidad: 1200 });
    expect(stock()).toBe(600);
    expect(consumos()).toEqual([consumoAntes]);
  });

  it("H: anular ingreso +1000 con consumo -600 → -600 permitido", () => {
    const ing = ingresar(1000);
    consumir("600");
    svc.anularMeIngreso(deposito, ing.id, "carga errónea");
    expect(stock()).toBe(-600);
  });

  it("anular consumo (devolución OA) reintegra una sola vez", () => {
    ingresar(1000);
    consumir("600");
    const salida = consumos()[0]!;
    svc.anularMeSalida(deposito, salida.id, "OA anulada");
    svc.anularMeSalida(deposito, salida.id, "OA anulada");
    expect(stock()).toBe(1000);
  });

  it("ajuste manual es un movimiento del ledger y sobrevive a ingresos posteriores", () => {
    ingresar(1000);
    const mat = svc.listMeMaterials(deposito)[0]!;
    svc.adjustMeStock(deposito, mat.id, 900, "conteo físico");
    expect(stock()).toBe(900);
    ingresar(100);
    expect(stock()).toBe(1000);
  });
});
