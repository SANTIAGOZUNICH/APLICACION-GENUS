import { beforeEach, describe, expect, it } from "vitest";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import {
  InventoryService,
  InventoryValidationError,
} from "@/lib/inventory/inventory-service";
import { normalizeMeCodigo } from "@/lib/inventory/me-codigo";
import { rebuildMeInventarioByCodigo } from "@/lib/inventory/me-inventario-rebuild";
import { applyOaDeliveryToMe } from "@/lib/inventory/me-oa-bridge";
import {
  createEmptyOaContent,
  emptyOaMaterial,
  normalizeOrderContent,
} from "@/lib/orders/content";
import type { OperationalOrderRecord } from "@/lib/orders/types";
import type { SectorId } from "@/types/operational/sector";

const deposito = {
  email: "deposito@laboratoriogenus.com.ar",
  sector: "DEPOSITO" as SectorId,
};
const produccion = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION" as SectorId,
  displayName: "Producción",
};

function makeOa(
  lines: Array<{ codigo: string; nombre: string; usados: string; materialId?: string | null }>,
  opts?: { id?: string; version?: number }
): OperationalOrderRecord {
  const content = createEmptyOaContent({ productName: "Crema", client: "Cliente X" });
  content.materials = lines.map((l, i) =>
    emptyOaMaterial(i + 1, {
      id: `line-${i + 1}`,
      codigo: l.codigo,
      nombreInsumo: l.nombre,
      usados: l.usados,
      materialId: l.materialId ?? null,
    })
  );
  const normalized = normalizeOrderContent(content);
  return {
    id: opts?.id ?? "oa-codigo-test",
    orderNumber: "OA-2026-009999",
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
    version: opts?.version ?? 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    completedBy: null,
    createdBy: produccion.email,
    updatedBy: produccion.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("ME Inventario — identidad exclusiva por CÓDIGO", () => {
  let repo: MemoryInventoryRepo;
  let svc: InventoryService;

  beforeEach(() => {
    repo = new MemoryInventoryRepo();
    svc = new InventoryService(repo);
  });

  it("1) nombres iguales y códigos distintos → filas separadas", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-001",
      descripcionInsumo: "Alcohol cetílico",
      bultos: 1,
      cantidad: 100,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-002",
      descripcionInsumo: "Alcohol cetílico",
      bultos: 1,
      cantidad: 50,
    });
    const inv = svc.listMeInventario(deposito);
    expect(inv).toHaveLength(2);
    expect(inv.find((r) => r.codigo === "ME-001")?.cantidadTotal).toBe(100);
    expect(inv.find((r) => r.codigo === "ME-002")?.cantidadTotal).toBe(50);
  });

  it("2) nombres similares y códigos distintos → no se unen", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-001",
      descripcionInsumo: "Alcohol cetílico",
      bultos: 1,
      cantidad: 100,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-002",
      descripcionInsumo: "Alcohol cetílico premium",
      bultos: 1,
      cantidad: 50,
    });
    const inv = svc.listMeInventario(deposito);
    expect(inv.map((r) => r.codigo).sort()).toEqual(["ME-001", "ME-002"]);
    expect(inv.find((r) => r.codigo === "ME-001")?.insumo).toMatch(/Alcohol cetílico$/);
    expect(inv.find((r) => r.codigo === "ME-002")?.cantidadTotal).toBe(50);
  });

  it("3) varios ingresos del mismo código se suman", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "CAJ-01",
      descripcionInsumo: "Cajas",
      bultos: 1,
      cantidad: 100,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "CAJ-01",
      descripcionInsumo: "Cajas blancas",
      bultos: 1,
      cantidad: 40,
    });
    expect(svc.listMeInventario(deposito)).toHaveLength(1);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(140);
  });

  it("4) varias salidas OA del mismo código se restan", () => {
    const ing = svc.upsertMeIngreso(deposito, {
      codigo: "TAP-01",
      descripcionInsumo: "Tapas",
      bultos: 1,
      cantidad: 200,
    });
    applyOaDeliveryToMe(
      svc,
      produccion,
      makeOa([{ codigo: "TAP-01", nombre: "Tapas", usados: "30", materialId: ing.materialId }], {
        id: "oa-s1",
        version: 1,
      })
    );
    applyOaDeliveryToMe(
      svc,
      produccion,
      makeOa([{ codigo: "TAP-01", nombre: "Tapas", usados: "20", materialId: ing.materialId }], {
        id: "oa-s2",
        version: 1,
      })
    );
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(150);
  });

  it("5) ingresos y salidas combinados por código", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-001",
      descripcionInsumo: "Alcohol cetílico",
      bultos: 1,
      cantidad: 100,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "ME-002",
      descripcionInsumo: "Alcohol cetílico premium",
      bultos: 1,
      cantidad: 50,
    });
    applyOaDeliveryToMe(
      svc,
      produccion,
      makeOa([
        { codigo: "ME-001", nombre: "Alcohol cetílico", usados: "20" },
        { codigo: "ME-002", nombre: "Alcohol cetílico premium", usados: "10" },
      ])
    );
    const inv = svc.listMeInventario(deposito);
    expect(inv.find((r) => r.codigo === "ME-001")?.cantidadTotal).toBe(80);
    expect(inv.find((r) => r.codigo === "ME-002")?.cantidadTotal).toBe(40);
  });

  it("6) espacios y capitalización no duplican código", () => {
    expect(normalizeMeCodigo(" mp-001 ")).toBe("MP-001");
    svc.upsertMeIngreso(deposito, {
      codigo: " mp-001 ",
      descripcionInsumo: "Alcohol",
      bultos: 1,
      cantidad: 10,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "Mp-001",
      descripcionInsumo: "Alcohol",
      bultos: 1,
      cantidad: 5,
    });
    const inv = svc.listMeInventario(deposito);
    expect(inv).toHaveLength(1);
    expect(inv[0]?.codigo).toBe("MP-001");
    expect(inv[0]?.cantidadTotal).toBe(15);
  });

  it("7) movimiento sin código se rechaza", () => {
    expect(() =>
      svc.upsertMeIngreso(deposito, {
        codigo: "   ",
        descripcionInsumo: "Alcohol cetílico",
        bultos: 1,
        cantidad: 10,
      })
    ).toThrow(InventoryValidationError);
    expect(repo.meIngresos).toHaveLength(0);
    expect(repo.meMaterials).toHaveLength(0);
  });

  it("8) reconstrucción separa histórico mal agrupado por materialId", () => {
    // Simula bug histórico: dos códigos distintos colgados del mismo materialId.
    const sharedId = "11111111-1111-4111-8111-111111111111";
    repo.upsertMeMaterial({
      id: sharedId,
      codigo: "ME-001",
      descripcion: "Alcohol cetílico",
      cliente: "",
      ubicacion: "",
      unidad: "u",
      cantidadPorBulto: null,
      stockActual: 150,
      stockMinimo: null,
      puntoReposicion: null,
      responsable: "",
      observacion: "",
      updatedAt: new Date().toISOString(),
    });
    repo.upsertMeIngreso({
      id: "ing-a",
      fecha: "2026-01-01",
      ingresoNro: "ME-I-00001",
      proveedor: "",
      cliente: "",
      remitoNro: "",
      codigo: "ME-001",
      descripcionInsumo: "Alcohol cetílico",
      bultos: 1,
      cantidad: 100,
      total: 100,
      ubicacion: "",
      materialId: sharedId,
      createdBy: "x",
      updatedBy: "x",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repo.upsertMeIngreso({
      id: "ing-b",
      fecha: "2026-01-02",
      ingresoNro: "ME-I-00002",
      proveedor: "",
      cliente: "",
      remitoNro: "",
      codigo: "ME-002",
      descripcionInsumo: "Alcohol cetílico premium",
      bultos: 1,
      cantidad: 50,
      total: 50,
      ubicacion: "",
      materialId: sharedId,
      createdBy: "x",
      updatedBy: "x",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const report = svc.rebuildMeInventario(deposito, { dryRun: false });
    expect(report.stocks).toHaveLength(2);
    expect(report.stocks.find((s) => s.codigo === "ME-001")?.stockActual).toBe(100);
    expect(report.stocks.find((s) => s.codigo === "ME-002")?.stockActual).toBe(50);

    const inv = svc.listMeInventario(deposito);
    expect(inv).toHaveLength(2);
    expect(inv.find((r) => r.codigo === "ME-001")?.cantidadTotal).toBe(100);
    expect(inv.find((r) => r.codigo === "ME-002")?.cantidadTotal).toBe(50);

    // Movimientos siguen existiendo, re-linkeados.
    expect(repo.meIngresos).toHaveLength(2);
    expect(repo.getMeIngreso("ing-a")?.materialId).not.toBe(
      repo.getMeIngreso("ing-b")?.materialId
    );
  });

  it("9) ejecutar rebuild dos veces es idempotente", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "IDEM-1",
      descripcionInsumo: "Cajas",
      bultos: 2,
      cantidad: 10,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "IDEM-2",
      descripcionInsumo: "Cajas",
      bultos: 1,
      cantidad: 5,
    });

    const first = rebuildMeInventarioByCodigo(repo, { dryRun: false });
    const snapshot = {
      materials: structuredClone(repo.meMaterials),
      ingresos: structuredClone(repo.meIngresos),
      stocks: first.stocks.map((s) => ({ codigo: s.codigo, stock: s.stockActual })),
    };

    const second = rebuildMeInventarioByCodigo(repo, { dryRun: false });
    expect(second.materialsCreated).toBe(0);
    expect(second.relinkedIngresos).toBe(0);
    expect(second.relinkedSalidas).toBe(0);
    expect(second.stocks.map((s) => ({ codigo: s.codigo, stock: s.stockActual }))).toEqual(
      snapshot.stocks
    );
    expect(repo.meMaterials.map((m) => m.id).sort()).toEqual(
      snapshot.materials.map((m) => m.id).sort()
    );
    expect(repo.meIngresos.map((r) => r.materialId).sort()).toEqual(
      snapshot.ingresos.map((r) => r.materialId).sort()
    );
  });

  it("10) inventario queda separado tras reparación + nuevos movimientos", () => {
    const sharedId = "22222222-2222-4222-8222-222222222222";
    repo.upsertMeMaterial({
      id: sharedId,
      codigo: "LEGACY",
      descripcion: "Envase genérico",
      cliente: "",
      ubicacion: "A1",
      unidad: "u",
      cantidadPorBulto: null,
      stockActual: 90,
      stockMinimo: null,
      puntoReposicion: null,
      responsable: "",
      observacion: "",
      updatedAt: new Date().toISOString(),
    });
    for (const [id, codigo, total, desc] of [
      ["i1", "ENV-A", 40, "Envase 250"],
      ["i2", "ENV-B", 50, "Envase 250"],
    ] as const) {
      repo.upsertMeIngreso({
        id,
        fecha: "2026-01-01",
        ingresoNro: id,
        proveedor: "",
        cliente: "",
        remitoNro: "",
        codigo,
        descripcionInsumo: desc,
        bultos: 1,
        cantidad: total,
        total,
        ubicacion: "A1",
        materialId: sharedId,
        createdBy: "x",
        updatedBy: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    }

    svc.rebuildMeInventario(deposito, { dryRun: false });
    svc.upsertMeIngreso(deposito, {
      codigo: "ENV-A",
      descripcionInsumo: "Envase 250",
      bultos: 1,
      cantidad: 10,
    });

    const inv = svc.listMeInventario(deposito);
    expect(inv.find((r) => r.codigo === "ENV-A")?.cantidadTotal).toBe(50);
    expect(inv.find((r) => r.codigo === "ENV-B")?.cantidadTotal).toBe(50);
    expect(inv.find((r) => r.codigo === "LEGACY")).toBeUndefined();
  });

  it("editar ingreso cambiando código mueve stock al material del nuevo código", () => {
    const a = svc.upsertMeIngreso(deposito, {
      codigo: "OLD-9",
      descripcionInsumo: "Frasco",
      bultos: 1,
      cantidad: 30,
    });
    svc.upsertMeIngreso(deposito, {
      id: a.id,
      codigo: "NEW-9",
      descripcionInsumo: "Frasco",
      bultos: 1,
      cantidad: 30,
    });
    const inv = svc.listMeInventario(deposito);
    expect(inv.find((r) => r.codigo === "OLD-9")?.cantidadTotal ?? 0).toBe(0);
    expect(inv.find((r) => r.codigo === "NEW-9")?.cantidadTotal).toBe(30);
  });

  it("OA con materialId de otro código no mezcla inventario", () => {
    const a = svc.upsertMeIngreso(deposito, {
      codigo: "OA-A",
      descripcionInsumo: "Tapa negra",
      bultos: 1,
      cantidad: 100,
    });
    svc.upsertMeIngreso(deposito, {
      codigo: "OA-B",
      descripcionInsumo: "Tapa negra",
      bultos: 1,
      cantidad: 80,
    });
    applyOaDeliveryToMe(
      svc,
      produccion,
      makeOa([
        {
          codigo: "OA-B",
          nombre: "Tapa negra",
          usados: "10",
          // materialId deliberadamente incorrecto (apunta a OA-A)
          materialId: a.materialId,
        },
      ])
    );
    const inv = svc.listMeInventario(deposito);
    expect(inv.find((r) => r.codigo === "OA-A")?.cantidadTotal).toBe(100);
    expect(inv.find((r) => r.codigo === "OA-B")?.cantidadTotal).toBe(70);
  });
});
