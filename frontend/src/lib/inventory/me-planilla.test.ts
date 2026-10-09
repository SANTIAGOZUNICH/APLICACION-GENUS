/**
 * Etapa 2 — reglas de las planillas de Depósito ME (sin base): cálculo de stock, anti doble descuento de salidas
 * manuales, protección de celdas, validaciones y duplicados en el servicio en memoria.
 */
import { describe, expect, it } from "vitest";
import { InventoryService } from "./inventory-service";
import { MemoryInventoryRepo } from "./memory-repo";
import { manualSalidaStockError, meSheetProtection, validateMeSheetValue } from "./me-sheet-edit";
import { buildMeMovements, computeMeStock } from "./me-stock-calc";
import type { MeIngresoRow, MeSalidaRow } from "./types";

const deposito = { email: "dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: "Depósito" };
const produccion = { email: "prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "Producción" };
const ing = (over: Partial<MeIngresoRow>): MeIngresoRow => ({ id: "i1", fecha: "2026-10-01", ingresoNro: "ME-I-1", proveedor: "", cliente: "", remitoNro: "", codigo: "TAP-1", descripcionInsumo: "Tapas", bultos: 1, cantidad: 100, total: 100, ubicacion: "", materialId: "m1", createdBy: "", updatedBy: "", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:00Z", ...over });
const sal = (over: Partial<MeSalidaRow>): MeSalidaRow => ({ id: "s1", fecha: "2026-10-02", egresoNro: "ME-E-1", cliente: "", remitoNro: "", descripcion: "Tapas", bultos: null, cantidad: 30, total: 30, control: false, entregado: false, comentarios: "", materialId: "m1", codigo: "TAP-1", unidad: "u", origen: "MANUAL", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "", updatedBy: "", createdAt: "2026-10-02T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", ...over });

describe("stock ME calculado (regla única)", () => {
  it("ingresos − salidas OA − manuales que descuentan + ajustes de TODOS los materiales del código; manual histórica no descuenta", () => {
    const stock = computeMeStock("tap-1", {
      ingresos: [ing({}), ing({ id: "i2", total: 50 }), ing({ id: "i3", total: 999, anulado: true })],
      salidas: [
        sal({ id: "oa", origen: "OA", total: 20 }),
        sal({ id: "oa-rev", origen: "OA", total: 7, reverted: true }),
        sal({ id: "man-desc", descuentaStock: true, total: 10 }),
        sal({ id: "man-hist", total: 30 }), // histórica: no descuenta
        sal({ id: "man-oa", descuentaStock: false, motivoSalida: "ENTREGA_OA", total: 20 }),
      ],
      ajustes: [{ id: "a1", module: "ME", entityId: "m1", cantidadAnterior: 0, cantidadNueva: 0, diferencia: 5, motivo: "x", actor: "", actorSector: "", createdAt: "2026-10-03T00:00:00Z" }, { id: "a2", module: "ME", entityId: "m1-duplicado", cantidadAnterior: 0, cantidadNueva: 0, diferencia: -3, motivo: "x", actor: "", actorSector: "", createdAt: "2026-10-03T00:00:00Z" }],
      materialIds: new Set(["m1", "m1-duplicado"]),
    });
    expect(stock).toBe(100 + 50 - 20 - 10 + 5 - 3);
  });

  it("libro de movimientos: el último saldo es el stock; anulados se muestran pero no cuentan; negativos se ven", () => {
    const movs = buildMeMovements("TAP-1", { ingresos: [ing({ total: 10 })], salidas: [sal({ origen: "OA", total: 25 }), sal({ id: "x", total: 4, reverted: true, descuentaStock: true })], ajustes: [], materialIds: new Set(["m1"]) });
    expect(movs.map((m) => m.tipo)).toEqual(["INGRESO", "SALIDA_OA", "SALIDA_MANUAL"]);
    expect(movs.at(-1)!.saldo).toBe(-15);
    expect(movs[2]!.anulado).toBe(true);
  });
});

describe("salidas manuales: nunca descuentan dos veces el consumo de una OA", () => {
  it("rechaza «descuenta stock» si menciona una OA o si el motivo es entrega para OA", () => {
    expect(manualSalidaStockError({ origen: "MANUAL", descuentaStock: true, comentarios: "Entregado a envasado para OA-2026-000123", codigo: "X", total: 5 })).toMatch(/se descuenta solo al entregarla/);
    expect(manualSalidaStockError({ origen: "MANUAL", descuentaStock: true, oaNumber: "OA-2026-000123", codigo: "X", total: 5 })).toMatch(/OA/);
    expect(manualSalidaStockError({ origen: "MANUAL", descuentaStock: true, motivoSalida: "ENTREGA_OA", codigo: "X", total: 5 })).toMatch(/no descuenta/);
    expect(manualSalidaStockError({ origen: "MANUAL", descuentaStock: true, motivoSalida: "DEVOLUCION_CLIENTE", codigo: "X", total: 5 })).toBeNull();
    expect(manualSalidaStockError({ origen: "MANUAL", descuentaStock: true, codigo: "", total: 5 })).toMatch(/código/);
  });

  it("servicio: manual con motivo que descuenta resta; consumo de OA + entrega manual de la misma OA resta UNA sola vez", () => {
    const repo = new MemoryInventoryRepo();
    const svc = new InventoryService(repo);
    const i = svc.upsertMeIngreso(deposito, { codigo: "CAJ-1", descripcionInsumo: "Cajas", bultos: 1, cantidad: 100 });
    const mat = () => svc.listMeMaterials(deposito).find((m) => m.id === i.materialId)!;
    svc.upsertMeSalida(deposito, { codigo: "CAJ-1", descripcion: "Cajas", cantidad: 10, motivoSalida: "DEVOLUCION_CLIENTE" });
    expect(mat().stockActual).toBe(90);
    // La entrega física para una OA se registra a mano (no descuenta)…
    svc.upsertMeSalida(deposito, { codigo: "CAJ-1", descripcion: "Cajas", cantidad: 40, motivoSalida: "ENTREGA_OA", comentarios: "OA-2026-000555" });
    // …y la OA descuenta sola al entregarse.
    svc.createOaMeSalida(produccion, { codigo: "CAJ-1", descripcion: "Cajas", cliente: "", unidad: "u", cantidad: 40, materialId: i.materialId!, oaId: "oa-1", oaNumber: "OA-2026-000555", oaVersion: 1, materialLineId: "l1", idempotencyKey: "oa-1:1:l1" });
    expect(mat().stockActual).toBe(50);
    expect(() => svc.upsertMeSalida(deposito, { codigo: "CAJ-1", cantidad: 40, descuentaStock: true, comentarios: "para OA-2026-000555" })).toThrow(/dos veces/);
    expect(mat().stockActual).toBe(50);
  });

  it("pegar dos veces el mismo ingreso (remito, código, cantidad, fecha) no suma stock dos veces", () => {
    const svc = new InventoryService(new MemoryInventoryRepo());
    const row = { fecha: "2026-10-01", remitoNro: "R-77", codigo: "ETI-9", descripcionInsumo: "Etiquetas", bultos: 2, cantidad: 50 };
    svc.upsertMeIngreso(deposito, row);
    expect(() => svc.upsertMeIngreso(deposito, row)).toThrow(/Posible duplicado/);
    svc.upsertMeIngreso(deposito, { ...row, permitirDuplicado: true }); // confirmado explícitamente como otro ingreso
    expect(svc.listMeIngresos(deposito)).toHaveLength(2);
  });
});

describe("protección y validación de celdas", () => {
  it("OA, anulados y sectores sin permiso no se editan; stock no es una columna editable", () => {
    expect(meSheetProtection("me_salidas", { origen: "OA" }, "cantidad", "DEPOSITO")).toMatch(/OA/);
    expect(meSheetProtection("me_salidas", { origen: "MANUAL" }, "cantidad", "DEPOSITO")).toBeNull();
    expect(meSheetProtection("me_ingresos", { anulado: true }, "cantidad", "DEPOSITO")).toMatch(/anulado/);
    expect(meSheetProtection("me_ingresos", {}, "cantidad", "PRODUCCION")).toMatch(/Depósito/);
    expect(meSheetProtection("me_ingresos", {}, "total", "DEPOSITO")).toMatch(/calculada/);
    expect(meSheetProtection("me_inventario", {}, "stockActual", "DEPOSITO")).toMatch(/calculada/);
    expect(meSheetProtection("me_inventario", {}, "stockMinimo", "PRODUCCION")).toBeNull();
  });
  it("tipos: números, fechas, Sí/No, motivos", () => {
    expect(validateMeSheetValue("me_ingresos", "cantidad", "1.500,5")).toEqual({ ok: true, value: 1500.5 });
    expect(validateMeSheetValue("me_ingresos", "cantidad", "-3").ok).toBe(false);
    expect(validateMeSheetValue("me_ingresos", "fecha", "31/12/2026")).toEqual({ ok: true, value: "2026-12-31" });
    expect(validateMeSheetValue("me_salidas", "descuentaStock", "Sí")).toEqual({ ok: true, value: true });
    expect(validateMeSheetValue("me_salidas", "motivoSalida", "devolución")).toEqual({ ok: true, value: "DEVOLUCION_CLIENTE" });
    expect(validateMeSheetValue("me_ingresos", "codigo", "").ok).toBe(false);
  });
});
