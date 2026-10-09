import { beforeEach, describe, expect, it } from "vitest";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryForbiddenError, InventoryService } from "@/lib/inventory/inventory-service";
import { inventoryCellProtection, validateInventoryValue } from "@/lib/inventory/cell-edit";
import type { SectorId } from "@/types/operational/sector";

const deposito = { email: "deposito@laboratoriogenus.com.ar", sector: "DEPOSITO" as SectorId };
const mp = { email: "mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as SectorId };

describe("inventario — edición por celda", () => {
  let repo: MemoryInventoryRepo;
  let svc: InventoryService;
  beforeEach(() => {
    repo = new MemoryInventoryRepo();
    svc = new InventoryService(repo);
  });

  it("ME: edita ubicación sin tocar stock ni código ni vecinas; versión cambia; audita", () => {
    svc.upsertMeIngreso(deposito, { codigo: "CAJ-01", descripcionInsumo: "Cajas", bultos: 10, cantidad: 25, ingresoNro: "X1" });
    const m = svc.listMeMaterials(deposito)[0]!;
    const [r] = svc.patchInventoryCells(deposito, "me_inventario", [{ id: m.id, field: "ubicacion", value: "Rack 9", expectedVersion: m.updatedAt }]);
    expect(r!.ok).toBe(true);
    const after = svc.listMeMaterials(deposito)[0]!;
    expect(after.ubicacion).toBe("Rack 9");
    expect(after.stockActual).toBe(250);
    expect(after.codigo).toBe(m.codigo);
    expect(after.descripcion).toBe(m.descripcion);
    expect(after.updatedAt).not.toBe(m.updatedAt);
    expect(repo.audit.some((a) => a.action === "cell_edit" && a.entityId === m.id)).toBe(true);
  });

  it("ME: código y stock NO son editables; conflicto de versión; sector sin permiso", () => {
    svc.upsertMeIngreso(deposito, { codigo: "CAJ-02", descripcionInsumo: "Tapas", bultos: 1, cantidad: 5, ingresoNro: "X2" });
    const m = svc.listMeMaterials(deposito)[0]!;
    for (const field of ["codigo", "stockActual"]) {
      const [r] = svc.patchInventoryCells(deposito, "me_inventario", [{ id: m.id, field, value: "1", expectedVersion: m.updatedAt }]);
      expect(r).toMatchObject({ ok: false, code: "INVALID" });
    }
    svc.patchInventoryCells(deposito, "me_inventario", [{ id: m.id, field: "cliente", value: "A", expectedVersion: m.updatedAt }]);
    const [stale] = svc.patchInventoryCells(deposito, "me_inventario", [{ id: m.id, field: "cliente", value: "B", expectedVersion: m.updatedAt }]);
    expect(stale).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(() =>
      svc.patchInventoryCells({ email: "c@x", sector: "CALIDAD" as SectorId }, "me_inventario", [{ id: m.id, field: "cliente", value: "Z", expectedVersion: m.updatedAt }])
    ).toThrow(InventoryForbiddenError);
  });

  it("MP: ubicación manual se edita; kg exige motivo y queda en ajustes; todo-o-nada", () => {
    const lot = svc.upsertMpStock(mp, { descripcion: "Agua", cantidadKg: 40, lote: "A", ubicacion: "R1" });
    const [bad] = svc.patchInventoryCells(mp, "mp_stock", [{ id: lot.id, field: "cantidadKg", value: "30", expectedVersion: lot.updatedAt }]);
    expect(bad).toMatchObject({ ok: false, code: "INVALID" });
    expect(repo.getMpStock(lot.id)!.cantidadKg).toBe(40);
    const mixed = svc.patchInventoryCells(mp, "mp_stock", [
      { id: lot.id, field: "ubicacion", value: "R7", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "vencimiento", value: "no-fecha", expectedVersion: lot.updatedAt },
    ]);
    expect(mixed.some((x) => !x.ok)).toBe(true);
    expect(repo.getMpStock(lot.id)!.ubicacion).toBe("R1");
    const ok = svc.patchInventoryCells(mp, "mp_stock", [
      { id: lot.id, field: "ubicacion", value: "R7", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "cantidadKg", value: "30,5", expectedVersion: lot.updatedAt, reason: "Conteo físico del 08/10" },
    ]);
    expect(ok.every((x) => x.ok)).toBe(true);
    const after = repo.getMpStock(lot.id)!;
    expect(after.ubicacion).toBe("R7");
    expect(after.cantidadKg).toBe(30.5);
    expect(after.lote).toBe("A");
    expect(repo.ajustes.some((a) => a.entityId === lot.id && a.cantidadAnterior === 40 && a.cantidadNueva === 30.5)).toBe(true);
  });

  it("MP: en lotes creados por un ingreso solo los kg quedan protegidos (con motivo específico)", () => {
    for (const field of ["producto", "proveedor", "cliente", "descripcion", "ubicacion", "lote", "vencimiento"]) {
      expect(inventoryCellProtection("mp_stock", { origen: "ingreso" }, field, true)).toBeNull();
    }
    expect(inventoryCellProtection("mp_stock", { origen: "ingreso" }, "cantidadKg", true)).toMatch(/Ajustar stock/);
    expect(inventoryCellProtection("mp_stock", { origen: "ingreso" }, "ubicacion", false)).toMatch(/sector/);
    expect(inventoryCellProtection("mp_stock", { origen: "manual", archived: true }, "ubicacion", true)).toMatch(/archivado/);
    expect(validateInventoryValue("vencimiento", "31/12/2026")).toEqual({ ok: true, value: "2026-12-31" });
  });

  it("MP: PRODUCTO, proveedor y descripción de un lote existente creado por un ingreso se editan en la celda (usuario Materia Prima)", async () => {
    await svc.upsertMpIngreso(mp, { codigo: "MP-77", producto: "CREMA X", descripcion: "Mentol", proveedor: "P1", lote: "L1", bultos: 1, cantidad: 10, confirm: true } as never);
    const lot = svc.listMpStock(mp).find((r) => r.codigo === "MP-77")!;
    expect(lot.origen).toBe("ingreso");
    expect(lot.productosAsociados).toBe("CREMA X");
    const res = svc.patchInventoryCells(mp, "mp_stock", [
      { id: lot.id, field: "producto", value: "CREMA X · GEL Y", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "proveedor", value: "P2", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "descripcion", value: "Mentol cristal", expectedVersion: lot.updatedAt },
    ]);
    expect(res.every((x) => x.ok)).toBe(true);
    const after = svc.listMpStock(mp).find((r) => r.id === lot.id)!;
    expect(after).toMatchObject({ producto: "CREMA X · GEL Y", proveedor: "P2", descripcion: "Mentol cristal", cantidadKg: lot.cantidadKg, codigo: "MP-77" });
    expect(repo.audit.filter((a) => a.action === "cell_edit" && a.entityId === lot.id)).toHaveLength(3);
    const [kg] = svc.patchInventoryCells(mp, "mp_stock", [{ id: lot.id, field: "cantidadKg", value: "1", expectedVersion: after.updatedAt, reason: "Conteo físico de prueba" }]);
    expect(kg).toMatchObject({ ok: false, code: "PROTECTED" });
  });

  it("Stock = dato vigente que usan vencimientos (días/estado); el ingreso original conserva lo recibido; código/kg intactos", async () => {
    await svc.upsertMpIngreso(mp, { codigo: "MP-88", producto: "CREMA Y", descripcion: "Urea", proveedor: "P1", lote: "L1", vencimiento: "2020-01-31", bultos: 1, cantidad: 4, confirm: true } as never);
    const lot = svc.listMpStock(mp).find((r) => r.codigo === "MP-88")!;
    const ing = repo.listMpIngresos().find((i) => i.codigo === "MP-88")!;
    expect(lot.estadoVencimiento).not.toBe(""); // vencido según el dato recibido
    const venceAntes = lot.diasAlVence;
    const res = svc.patchInventoryCells(mp, "mp_stock", [
      { id: lot.id, field: "vencimiento", value: "31/12/2099", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "lote", value: "L1-CORREGIDO", expectedVersion: lot.updatedAt },
      { id: lot.id, field: "proveedor", value: "P2", expectedVersion: lot.updatedAt },
    ]);
    expect(res.every((x) => x.ok)).toBe(true);
    const after = svc.listMpStock(mp).find((r) => r.id === lot.id)!;
    expect(after.vencimiento).toBe("2099-12-31");
    expect(after.diasAlVence).toBeGreaterThan(venceAntes ?? 0); // vencimientos usan el dato vigente de Stock
    expect(after.lote).toBe("L1-CORREGIDO");
    expect(after).toMatchObject({ codigo: "MP-88", cantidadKg: lot.cantidadKg });
    // Trazabilidad: el ingreso original queda como se recibió.
    expect(repo.getMpIngreso(ing.id)).toMatchObject({ lote: "L1", vencimiento: "2020-01-31", proveedor: "P1", producto: "CREMA Y", status: "CONFIRMADO" });
    // La auditoría guarda antes/después de cada cambio en Stock.
    const audits = repo.audit.filter((a) => a.action === "cell_edit" && a.entityId === lot.id);
    expect(audits.map((a) => a.before)).toEqual(expect.arrayContaining([{ vencimiento: "2020-01-31" }, { lote: "L1" }, { proveedor: "P1" }]));
  });
});

