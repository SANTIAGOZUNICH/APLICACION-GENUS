/**
 * Etapa 3 — Materias Primas: reglas puras de las planillas y del servicio (sin base de datos).
 * La atomicidad, concurrencia y persistencia se prueban contra Postgres real en
 * src/integration/mp-planilla.db.integration.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryService, InventoryValidationError } from "@/lib/inventory/inventory-service";
import {
  MP_COMPRA_ESTADOS,
  isMpSheetField,
  mpSheetNeedsReason,
  mpSheetProtection,
  validateMpSheetValue,
} from "@/lib/inventory/mp-sheet-edit";
import type { SectorId } from "@/types/operational/sector";

const mp = { email: "mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as SectorId };

describe("política de planillas MP (cliente y servidor)", () => {
  it("Ingresos: INGRESO Nº y TOTAL no se editan; los datos del documento sí", () => {
    expect(isMpSheetField("mp_ingresos", "ingresoNro")).toBe(false);
    expect(isMpSheetField("mp_ingresos", "total")).toBe(false);
    for (const f of ["fecha", "remitoNro", "codigo", "bultos", "cantidad", "lote", "vencimiento"]) {
      expect(isMpSheetField("mp_ingresos", f)).toBe(true);
    }
  });

  it("solo Materia Prima (y Dirección) editan; Producción y Depósito no", () => {
    expect(mpSheetProtection("mp_ingresos", { status: "BORRADOR" }, "cantidad", "MATERIA_PRIMA")).toBeNull();
    expect(mpSheetProtection("mp_ingresos", { status: "BORRADOR" }, "cantidad", "DIRECCION")).toBeNull();
    expect(mpSheetProtection("mp_ingresos", { status: "BORRADOR" }, "cantidad", "PRODUCCION")).toMatch(/Solo Materia Prima/);
    expect(mpSheetProtection("mp_compras", { estado: "" }, "nota", "DEPOSITO")).toMatch(/Solo Materia Prima/);
  });

  it("ingreso anulado: solo lectura; compra cancelada: solo estado y nota", () => {
    expect(mpSheetProtection("mp_ingresos", { status: "ANULADO" }, "lote", "MATERIA_PRIMA")).toMatch(/anulado/);
    expect(mpSheetProtection("mp_compras", { estado: "Cancelada" }, "cantidad", "MATERIA_PRIMA")).toMatch(/cancelada/i);
    expect(mpSheetProtection("mp_compras", { estado: "Cancelada" }, "estado", "MATERIA_PRIMA")).toBeNull();
    expect(mpSheetProtection("mp_compras", { estado: "Cancelada" }, "nota", "MATERIA_PRIMA")).toBeNull();
  });

  it("corregir código/bultos/cantidad/lote de un ingreso CONFIRMADO pide motivo; un borrador no", () => {
    expect(mpSheetNeedsReason("mp_ingresos", { status: "CONFIRMADO" }, "cantidad")).toBe(true);
    expect(mpSheetNeedsReason("mp_ingresos", { status: "CONFIRMADO" }, "lote")).toBe(true);
    expect(mpSheetNeedsReason("mp_ingresos", { status: "CONFIRMADO" }, "proveedor")).toBe(false);
    expect(mpSheetNeedsReason("mp_ingresos", { status: "BORRADOR" }, "cantidad")).toBe(false);
  });

  it("validación: números ≥ 0, fechas dd/mm/aaaa, estado de compra de la lista", () => {
    expect(validateMpSheetValue("mp_ingresos", "cantidad", "12,5")).toEqual({ ok: true, value: 12.5 });
    expect(validateMpSheetValue("mp_ingresos", "cantidad", "-3").ok).toBe(false);
    expect(validateMpSheetValue("mp_ingresos", "vencimiento", "31/12/2027")).toEqual({ ok: true, value: "2027-12-31" });
    expect(validateMpSheetValue("mp_ingresos", "fecha", "").ok).toBe(false);
    expect(validateMpSheetValue("mp_compras", "estado", "en camino")).toEqual({ ok: true, value: "En camino" });
    expect(validateMpSheetValue("mp_compras", "estado", "Inventado").ok).toBe(false);
    expect(MP_COMPRA_ESTADOS).toContain("En planta");
  });
});

describe("servicio MP — reglas nuevas", () => {
  let repo: MemoryInventoryRepo;
  let svc: InventoryService;
  beforeEach(() => {
    repo = new MemoryInventoryRepo();
    svc = new InventoryService(repo);
  });

  it("pegar dos veces el mismo ingreso (remito, código, lote, cantidad, fecha) se rechaza: no duplica stock", async () => {
    const base = { fecha: "2026-10-01", remitoNro: "R-100", codigo: "GLI-01", descripcion: "Glicerina", lote: "L1", bultos: 2, cantidad: 25 };
    await svc.upsertMpIngreso(mp, base);
    await expect(svc.upsertMpIngreso(mp, base)).rejects.toThrow(/Duplicado del ingreso/);
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(50);
    // Otra línea del mismo remito (otro lote) sí se carga.
    await svc.upsertMpIngreso(mp, { ...base, lote: "L2" });
    expect(svc.listMpIngresos(mp)).toHaveLength(2);
  });

  it("un ingreso anulado no cuenta como duplicado (se puede volver a cargar bien)", async () => {
    const base = { fecha: "2026-10-01", remitoNro: "R-200", codigo: "ALC-01", descripcion: "Alcohol", lote: "A1", cantidad: 10 };
    const first = await svc.upsertMpIngreso(mp, base);
    await svc.anularMpIngreso(mp, first.id, "cargado mal");
    await expect(svc.upsertMpIngreso(mp, base)).resolves.toBeTruthy();
  });

  it("Nº de ingreso: el mayor + 1 (no se repite tras anulaciones)", async () => {
    const a = await svc.upsertMpIngreso(mp, { codigo: "X1", descripcion: "x", cantidad: 1, remitoNro: "R1" });
    const b = await svc.upsertMpIngreso(mp, { codigo: "X2", descripcion: "x", cantidad: 1, remitoNro: "R2" });
    await svc.anularMpIngreso(mp, a.id, "x");
    repo.mpIngresos = repo.mpIngresos.filter((r) => r.id !== a.id); // aunque falte una fila, no se reutiliza el número
    const c = await svc.upsertMpIngreso(mp, { codigo: "X3", descripcion: "x", cantidad: 1, remitoNro: "R3" });
    expect(b.ingresoNro).toBe("MP-I-00002");
    expect(c.ingresoNro).toBe("MP-I-00003");
  });

  it("pegado en BORRADOR no mueve stock; editar el borrador tampoco; confirmar sí", async () => {
    const d = await svc.upsertMpIngreso(mp, { codigo: "COCO-1", descripcion: "Aceite coco", cantidad: 40, status: "BORRADOR" });
    expect(d.status).toBe("BORRADOR");
    expect(svc.listMpStock(mp)).toHaveLength(0);
    const e = await svc.upsertMpIngreso(mp, { id: d.id, cantidad: 45, status: "BORRADOR" });
    expect(e.status).toBe("BORRADOR");
    expect(svc.listMpStock(mp)).toHaveLength(0);
    await svc.upsertMpIngreso(mp, { id: d.id, status: "CONFIRMADO" });
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(45);
  });

  it("la corrección de un ingreso confirmado queda auditada con su motivo", async () => {
    const r = await svc.upsertMpIngreso(mp, { codigo: "GLI-02", descripcion: "Glicerina", cantidad: 30 });
    await svc.upsertMpIngreso(mp, { id: r.id, cantidad: 28, status: "CONFIRMADO", auditReason: "Remito corregido por el proveedor" });
    const audit = repo.audit.filter((a) => a.entityId === r.id && a.action === "update");
    expect(audit.at(-1)?.reason).toBe("Remito corregido por el proveedor");
    expect(svc.listMpStock(mp)[0]?.cantidadKg).toBe(28);
  });

  it("Stock MP: el formulario no pisa los kg de un lote existente (se corrige con «Ajustar stock»)", () => {
    const lot = svc.upsertMpStock(mp, { descripcion: "Vaselina", codigo: "VAS-1", cantidadKg: 10 });
    expect(() => svc.upsertMpStock(mp, { id: lot.id, descripcion: "Vaselina", cantidadKg: 99 })).toThrow(InventoryValidationError);
    // Mismo valor (formulario con el dato precargado) o sin kg: se guardan los demás datos.
    expect(svc.upsertMpStock(mp, { id: lot.id, descripcion: "Vaselina sólida", cantidadKg: 10 }).descripcion).toBe("Vaselina sólida");
    expect(svc.upsertMpStock(mp, { id: lot.id, ubicacion: "R2" }).cantidadKg).toBe(10);
  });

  it("alta manual de un lote con kg queda como ajuste (para el libro mayor)", () => {
    const lot = svc.upsertMpStock(mp, { descripcion: "Mentol", codigo: "MEN-1", cantidadKg: 3 });
    const aj = repo.ajustes.find((a) => a.entityId === lot.id);
    expect(aj).toMatchObject({ module: "MP", cantidadAnterior: 0, cantidadNueva: 3, diferencia: 3 });
  });
});
