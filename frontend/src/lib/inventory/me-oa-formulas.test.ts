import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { MemoryInventoryRepo } from "@/lib/inventory/memory-repo";
import { InventoryService } from "@/lib/inventory/inventory-service";
import {
  applyOaDeliveryToMe,
  previewOaMeShortages,
  reverseOaMeSalidas,
  buildOaMeIdempotencyKey,
} from "@/lib/inventory/me-oa-bridge";
import { ME_INVENTARIO_COLUMNS } from "@/lib/inventory/types";
import { formatMeBultosDisplay } from "@/lib/inventory/calcs";
import { createEmptyOaContent, emptyOaMaterial, normalizeOrderContent } from "@/lib/orders/content";
import type { OperationalOrderRecord, OrdersActor } from "@/lib/orders/types";
import { parseWorkbookBuffer } from "@/lib/formulas/parse-workbook";
import {
  FormulaBankService,
  MemoryFormulaBank,
  resetFormulaBankForTests,
} from "@/lib/formulas/formula-bank-service";
import {
  looksLikeCopyName,
  normalizeSearchKey,
  shouldIgnoreArchiveEntry,
  type ParsedFormulaDraft,
} from "@/lib/formulas/types";
import { resolveSectorHome } from "@/lib/role-engine/role-engine";
import type { SectorId } from "@/types/operational/sector";
import { recomputeOeDerived, emptyOeMaterial, createEmptyOeContent } from "@/lib/orders/content";

const deposito: { email: string; sector: SectorId; displayName: string } = {
  email: "deposito@laboratoriogenus.com.ar",
  sector: "DEPOSITO",
  displayName: "Depósito",
};
const emasivo: OrdersActor = {
  email: "emasivo@laboratoriogenus.com.ar",
  sector: "ENVASADO_MASIVO",
  displayName: "Masivo",
};

function makeOaOrder(partial: {
  id?: string;
  version?: number;
  materials: ReturnType<typeof emptyOaMaterial>[];
}): OperationalOrderRecord {
  const content = createEmptyOaContent({ productName: "Crema", client: "Cliente X" });
  content.materials = partial.materials;
  const normalized = normalizeOrderContent(content);
  return {
    id: partial.id ?? "oa-1",
    orderNumber: "OA-2026-000099",
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
    status: "PENDIENTE",
    formData: normalized,
    completionPercentage: 50,
    revision: partial.version ?? 1,
    version: partial.version ?? 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    completedBy: null,
    createdBy: emasivo.email,
    updatedBy: emasivo.email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Inventario ME automático (OA)", () => {
  let repo: MemoryInventoryRepo;
  let svc: InventoryService;

  beforeEach(() => {
    repo = new MemoryInventoryRepo();
    svc = new InventoryService(repo);
  });

  it("sidebar incluye Inventario ME y columnas exactas", () => {
    expect(resolveSectorHome("DEPOSITO").sidebarItems).toContain("inventario_me");
    expect([...ME_INVENTARIO_COLUMNS]).toEqual([
      "CLIENTE",
      "INSUMO",
      "BULTOS",
      "CANTIDAD TOTAL",
      "UBICACIÓN",
    ]);
  });

  it("ingreso aumenta stock; salidas manuales no descuentan", () => {
    const ing = svc.upsertMeIngreso(deposito, {
      codigo: "CAJ-01",
      descripcionInsumo: "Cajas",
      cliente: "Cliente X",
      bultos: 10,
      cantidad: 100,
    });
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(1000);

    svc.upsertMeSalida(deposito, {
      codigo: "CAJ-01",
      materialId: ing.materialId,
      descripcion: "Cajas",
      bultos: 1,
      cantidad: 100,
      origen: "MANUAL",
    });
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(1000);
  });

  it("OA borrador no descuenta; entrega descuenta; segunda no duplica", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "TAP-01",
      descripcionInsumo: "Tapas",
      cliente: "Cliente X",
      bultos: 1,
      cantidad: 500,
    });
    const line = emptyOaMaterial(1, {
      codigo: "TAP-01",
      nombreInsumo: "Tapas",
      usados: "120",
      cliente: "Cliente X",
    });
    const draft = makeOaOrder({ materials: [line] });
    expect(previewOaMeShortages(svc, emasivo, draft)).toEqual([]);
    // Sin apply → stock intacto
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(500);

    applyOaDeliveryToMe(svc, emasivo, draft);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(380);
    expect(svc.listMeSalidas(deposito).filter((s) => s.origen === "OA")).toHaveLength(1);

    applyOaDeliveryToMe(svc, emasivo, draft);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(380);
    expect(svc.listMeSalidas(deposito).filter((s) => s.origen === "OA" && !s.reverted)).toHaveLength(
      1
    );
  });

  it("corrección aplica diferencia; anulación devuelve stock", () => {
    svc.upsertMeIngreso(deposito, {
      codigo: "ETQ-01",
      descripcionInsumo: "Etiquetas",
      bultos: 1,
      cantidad: 1000,
    });
    const lineId = "line-etq";
    const line = emptyOaMaterial(1, {
      id: lineId,
      codigo: "ETQ-01",
      nombreInsumo: "Etiquetas",
      usados: "100",
    });
    const v1 = makeOaOrder({ id: "oa-corr", version: 1, materials: [line] });
    applyOaDeliveryToMe(svc, emasivo, v1);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(900);

    const line2 = emptyOaMaterial(1, {
      id: lineId,
      codigo: "ETQ-01",
      nombreInsumo: "Etiquetas",
      usados: "150",
    });
    const v2 = makeOaOrder({ id: "oa-corr", version: 2, materials: [line2] });
    applyOaDeliveryToMe(svc, emasivo, v2);
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(850);

    reverseOaMeSalidas(svc, emasivo, "oa-corr", "anulación prueba");
    expect(svc.listMeInventario(deposito)[0]?.cantidadTotal).toBe(1000);
  });

  it("código identifica material; bultos display; stock insuficiente", () => {
    expect(formatMeBultosDisplay(2500, 1000)).toBe("2 completos + 500 unidades");
    expect(formatMeBultosDisplay(100, null)).toBe("");

    svc.upsertMeIngreso(deposito, {
      codigo: "CAJ-99",
      descripcionInsumo: "Cajas",
      bultos: 1,
      cantidad: 10,
    });
    const line = emptyOaMaterial(1, { codigo: "CAJ-99", nombreInsumo: "Cajas", usados: "50" });
    const order = makeOaOrder({ materials: [line] });
    const shortages = previewOaMeShortages(svc, emasivo, order);
    expect(shortages[0]?.diferencia).toBe(40);
    expect(buildOaMeIdempotencyKey("a", 1, "b")).toBe("a:1:b");
  });
});

describe("Banco privado de fórmulas (sintético)", () => {
  function syntheticXlsx(sheets: Record<string, (string | number)[][]>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const [name, aoa] of Object.entries(sheets)) {
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  it("ignora temporales y no-excel", () => {
    expect(shouldIgnoreArchiveEntry("~$tmp.xlsx")).toBe(true);
    expect(shouldIgnoreArchiveEntry("foto.png")).toBe(true);
    expect(shouldIgnoreArchiveEntry("aux.docx")).toBe(true);
    expect(shouldIgnoreArchiveEntry("Cliente/Prod.xlsx")).toBe(false);
  });

  it("lee xlsx con varias hojas → varias fórmulas; no importa kg fijos", () => {
    const buf = syntheticXlsx({
      Serum: [
        ["Cliente", "Cliente Alpha"],
        ["Producto", "Serum Test"],
        ["MATERIA PRIMA", "Código", "Fórmula %"],
        ["Agua", "A", 70],
        ["Glicerina", "B", 30],
        ["PROCEDIMIENTO DE ELABORACIÓN"],
        ["Mezclar en frío"],
        ["Cantidad Kg", 100],
        ["Kg a pesar", 70],
      ],
      Crema: [
        ["Cliente", "Cliente Alpha"],
        ["Producto", "Crema Test"],
        ["MATERIA PRIMA", "Fase", "Fórmula %"],
        ["Base", "F1", 80],
        ["Activo", "F2", 20],
        ["PROCEDIMIENTO DE ELABORACIÓN"],
        ["Calentar"],
      ],
    });
    const drafts = parseWorkbookBuffer(buf, {
      sourceFile: "Alpha/formulas.xlsx",
      sourceModifiedAt: "2026-01-10T10:00:00.000Z",
      folderClient: "Alpha",
    });
    expect(drafts.length).toBe(2);
    expect(drafts.every((d) => d.ingredients.every((i) => i.percentage != null))).toBe(true);
    // Ingredientes no deben incluir kilos; procedimiento tampoco debe persistir kg fijos como datos maestros de %
    expect(drafts[0]!.ingredients.map((i) => i.materialName).join(",")).not.toMatch(/Kg|Cantidad/i);
    expect(drafts[0]!.percentageTotal).toBe(100);
  });

  it("dedupe hash/semántica; más reciente vigente; copia histórica; empate", () => {
    const bank = resetFormulaBankForTests();
    const baseIng = [
      { position: 1, materialName: "Agua", materialCodeOrPhase: "A", percentage: 100, notes: "" },
    ];
    const mk = (over: Partial<ParsedFormulaDraft>): ParsedFormulaDraft => ({
      displayClient: "Cliente Beta",
      displayProduct: "Producto Y",
      productCode: "PY",
      sourceFile: "Beta/Y.xlsx",
      sourceSheet: "OE",
      sourceModifiedAt: "2026-02-01T00:00:00.000Z",
      sourceHash: "h1",
      semanticHash: "sem-y",
      ingredients: baseIng,
      procedureSteps: [{ position: 1, instruction: "Paso" }],
      specifications: [],
      percentageTotal: 100,
      warnings: [],
      altSourcePaths: [],
      ...over,
    });

    const r1 = bank.ingestDrafts([
      mk({ sourceFile: "Copia de Y.xlsx", sourceModifiedAt: "2026-01-01T00:00:00.000Z", sourceHash: "old" }),
      mk({ sourceFile: "Y.xlsx", sourceModifiedAt: "2026-03-01T00:00:00.000Z", sourceHash: "new" }),
    ]);
    expect(r1.inserted).toBeGreaterThanOrEqual(1);
    const snap = bank.resolveVigente("Cliente Beta", "Producto Y");
    expect(snap).not.toBeNull();

    // Empate ambiguo
    const bank2 = new FormulaBankService(new MemoryFormulaBank());
    const tied = bank2.ingestDrafts([
      mk({
        displayProduct: "Producto Z",
        semanticHash: "sem-z1",
        sourceHash: "z1",
        sourceFile: "Z-a.xlsx",
        sourceModifiedAt: "2026-05-01T00:00:00.000Z",
        ingredients: [
          { position: 1, materialName: "X", materialCodeOrPhase: "", percentage: 50, notes: "" },
          { position: 2, materialName: "Y", materialCodeOrPhase: "", percentage: 50, notes: "" },
        ],
      }),
      mk({
        displayProduct: "Producto Z",
        semanticHash: "sem-z2",
        sourceHash: "z2",
        sourceFile: "Z-b.xlsx",
        sourceModifiedAt: "2026-05-01T00:00:00.000Z",
        ingredients: [
          { position: 1, materialName: "X", materialCodeOrPhase: "", percentage: 40, notes: "" },
          { position: 2, materialName: "Y", materialCodeOrPhase: "", percentage: 60, notes: "" },
        ],
      }),
    ]);
    expect(tied.conflicts).toBeGreaterThanOrEqual(1);
    expect(bank2.resolveVigente("Cliente Beta", "Producto Z")).toBeNull();
  });

  it("advierte total ≠ 100; import idempotente; otro cliente no recibe fórmula", () => {
    const bank = resetFormulaBankForTests();
    const draft: ParsedFormulaDraft = {
      displayClient: "Cliente Gamma",
      displayProduct: "Serum G",
      productCode: "",
      sourceFile: "g.xlsx",
      sourceSheet: "OE",
      sourceModifiedAt: "2026-04-01T00:00:00.000Z",
      sourceHash: "g1",
      semanticHash: "sem-g",
      ingredients: [
        { position: 1, materialName: "A", materialCodeOrPhase: "", percentage: 40, notes: "" },
        { position: 2, materialName: "B", materialCodeOrPhase: "", percentage: 40, notes: "" },
      ],
      procedureSteps: [{ position: 1, instruction: "Mezclar" }],
      specifications: [],
      percentageTotal: 80,
      warnings: ["Total porcentual 80 ≠ 100 (sin corregir)"],
      altSourcePaths: [],
    };
    const once = bank.ingestDrafts([draft], { archiveHash: "arch-1" });
    const twice = bank.ingestDrafts([draft], { archiveHash: "arch-1" });
    expect(once.inserted).toBe(1);
    expect(twice.duplicated).toBeGreaterThanOrEqual(1);
    expect(bank.resolveVigente("Cliente Gamma", "Serum G")?.percentageTotal).toBe(80);
    expect(bank.resolveVigente("Otro Cliente", "Serum G")).toBeNull();
  });

  it("OE calcula kg según cantidad; snapshot no cambia al actualizar maestra", () => {
    const bank = resetFormulaBankForTests();
    bank.ingestDrafts([
      {
        displayClient: "Cliente Delta",
        displayProduct: "Locion D",
        productCode: "LD",
        sourceFile: "d.xlsx",
        sourceSheet: "OE",
        sourceModifiedAt: "2026-06-01T00:00:00.000Z",
        sourceHash: "d1",
        semanticHash: "sem-d",
        ingredients: [
          {
            position: 1,
            materialName: "Agua",
            materialCodeOrPhase: "A",
            percentage: 50,
            notes: "",
          },
          {
            position: 2,
            materialName: "Activo",
            materialCodeOrPhase: "B",
            percentage: 50,
            notes: "",
          },
        ],
        procedureSteps: [{ position: 1, instruction: "Procedimiento" }],
        specifications: [],
        percentageTotal: 100,
        warnings: [],
        altSourcePaths: [],
      },
    ]);
    const snap = bank.resolveVigente("cliente delta", "locion d")!;
    const oe = createEmptyOeContent({
      productName: "Locion D",
      client: "Cliente Delta",
      quantityKg: 200,
    });
    oe.materials = snap.ingredients.map((i) =>
      emptyOeMaterial({
        materiaPrima: i.materialName,
        codigo: i.materialCodeOrPhase,
        formulaPct: i.percentage,
      })
    );
    const recomputed = recomputeOeDerived(oe);
    expect(recomputed.materials[0]?.kgAPesar).toBe(100);
    expect(recomputed.materials[1]?.kgAPesar).toBe(100);

    const frozenHash = snap.versionHash;
    // Nueva versión vigente
    bank.ingestDrafts([
      {
        displayClient: "Cliente Delta",
        displayProduct: "Locion D",
        productCode: "LD",
        sourceFile: "d2.xlsx",
        sourceSheet: "OE",
        sourceModifiedAt: "2026-07-01T00:00:00.000Z",
        sourceHash: "d2",
        semanticHash: "sem-d-new",
        ingredients: [
          {
            position: 1,
            materialName: "Agua",
            materialCodeOrPhase: "A",
            percentage: 60,
            notes: "",
          },
          {
            position: 2,
            materialName: "Activo",
            materialCodeOrPhase: "B",
            percentage: 40,
            notes: "",
          },
        ],
        procedureSteps: [{ position: 1, instruction: "Nuevo proc" }],
        specifications: [],
        percentageTotal: 100,
        warnings: [],
        altSourcePaths: [],
      },
    ]);
    // Snapshot previo (hash) sigue siendo recuperable por versionId
    const old = bank.getVersionForAuthorizedOrder(snap.formulaVersionId);
    expect(old?.versionHash).toBe(frozenHash);
    expect(old?.ingredients[0]?.percentage).toBe(50);
  });

  it("no existe endpoint público de listado del banco (solo resolve/by-version/proposals/options)", async () => {
    const routes = [
      "src/app/api/v1/formulas/resolve/route.ts",
      "src/app/api/v1/formulas/by-version/route.ts",
      "src/app/api/v1/formulas/proposals/route.ts",
      "src/app/api/v1/formulas/options/route.ts",
      "src/app/api/v1/formulas/drive-diagnose/route.ts",
    ];
    const fs = await import("node:fs");
    expect(fs.existsSync("src/app/api/v1/formulas/route.ts")).toBe(false);
    for (const r of routes) expect(fs.existsSync(r)).toBe(true);
    expect(normalizeSearchKey("Cliente  Á")).toBe("cliente a");
    expect(looksLikeCopyName("Copia de X.xlsx")).toBe(true);
    void createHash;
  });
});
