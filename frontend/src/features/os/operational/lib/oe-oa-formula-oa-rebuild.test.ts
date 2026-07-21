import { describe, expect, it, beforeEach } from "vitest";
import { MemoryOrdersRepository } from "@/lib/orders/memory-repository";
import { OrdersService } from "@/lib/orders/orders-service";
import { canEditOeFormula, canOrderAction } from "@/lib/orders/rbac";
import {
  computeKgRealUtilizado,
  createEmptyOaContent,
  createEmptyOeContent,
  emptyOeMaterial,
  normalizeOrderContent,
  rendimientoDentroDeRango,
  recomputeOaDerived,
} from "@/lib/orders/content";
import { applyElaboracionMaterialPatch, validateAjusteRows } from "@/lib/orders/oe-ajuste";
import { buildCremaFacialLaudeOaTemplateContent } from "@/lib/orders/seed-templates";
import { assertBlankSignatures } from "@/lib/orders/pdf-document";
import { validateDeliverOa } from "@/lib/orders/validators";
import type { OrdersActor, OeContent } from "@/lib/orders/types";

const calidad: OrdersActor = {
  email: "calidad@laboratoriogenus.com.ar",
  sector: "CALIDAD",
  displayName: "Calidad",
};
const produccion: OrdersActor = {
  email: "produccion@laboratoriogenus.com.ar",
  sector: "PRODUCCION",
  displayName: "Producción",
};
const elaboracion: OrdersActor = {
  email: "elaboracion@laboratoriogenus.com.ar",
  sector: "ELABORACION",
  displayName: "Elaboración",
};
const mp: OrdersActor = {
  email: "mp@laboratoriogenus.com.ar",
  sector: "MATERIA_PRIMA",
  displayName: "MP",
};
const masivo: OrdersActor = {
  email: "emasivo@laboratoriogenus.com.ar",
  sector: "ENVASADO_MASIVO",
  displayName: "Masivo",
};
const codificado: OrdersActor = {
  email: "codificado@laboratoriogenus.com.ar",
  sector: "CODIFICADO",
  displayName: "Codificado",
};

describe("plantillas desde cero", () => {
  let service: OrdersService;
  let repo: MemoryOrdersRepository;

  beforeEach(() => {
    repo = new MemoryOrdersRepository(false);
    service = new OrdersService(repo);
  });

  it("crea plantilla OE desde cero sin maestra previa", async () => {
    expect(await service.listTemplates("OE")).toHaveLength(0);
    const t = await service.createTemplate(
      {
        type: "OE",
        productName: "GEL NUEVO",
        productCode: "PT-GEL",
        content: createEmptyOeContent({ productName: "GEL NUEVO", code: "PT-GEL" }),
      },
      calidad
    );
    expect(t.version).toBe(1);
    expect(t.status).toBe("VIGENTE");
    expect(t.content.kind).toBe("OE");
    if (t.content.kind === "OE") {
      expect(t.content.materials).toHaveLength(0);
      expect(t.content.procedureSteps).toHaveLength(0);
    }
  });

  it("crea plantilla OA desde cero sin maestra previa", async () => {
    const t = await service.createTemplate(
      {
        type: "OA",
        productName: "CREMA NUEVA",
        productCode: "OA-01",
        content: createEmptyOaContent({ productName: "CREMA NUEVA", productCode: "OA-01" }),
      },
      produccion
    );
    expect(t.version).toBe(1);
    expect(t.status).toBe("VIGENTE");
  });

  it("crear orden desde cero con y sin maestra", async () => {
    const only = await service.createOrderFromScratch(
      {
        type: "OE",
        product: "SERUM X",
        code: "PT-X",
        client: "CLI",
        lot: "L1",
        assignedSector: "ELABORACION",
        alsoCreateMaster: false,
      },
      calidad
    );
    expect(only.order.lot).toBe("L1");
    expect(only.template).toBeNull();
    expect(await service.listTemplates("OE")).toHaveLength(0);

    const both = await service.createOrderFromScratch(
      {
        type: "OA",
        product: "CREMA Y",
        code: "OA-Y",
        client: "CLI",
        lot: "J1",
        assignedSector: "ENVASADO_MASIVO",
        alsoCreateMaster: true,
      },
      produccion
    );
    expect(both.template?.status).toBe("VIGENTE");
    expect(both.template?.version).toBe(1);
    expect(await service.listTemplates("OA")).toHaveLength(1);
  });
});

describe("permisos de fórmula y ajuste OE", () => {
  let service: OrdersService;

  beforeEach(async () => {
    const repo = new MemoryOrdersRepository(true);
    service = new OrdersService(repo);
  });

  it("Calidad, Producción y MP pueden editar fórmula; Elaboración no", () => {
    expect(canEditOeFormula("CALIDAD")).toBe(true);
    expect(canEditOeFormula("PRODUCCION")).toBe(true);
    expect(canEditOeFormula("MATERIA_PRIMA")).toBe(true);
    expect(canEditOeFormula("ELABORACION")).toBe(false);
    expect(canOrderAction("OE", "edit_formula", "ELABORACION")).toBe(false);
  });

  it("Elaboración no modifica fórmula teórica al guardar; sí ajuste y lote", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: t.id,
        assignedSector: "ELABORACION",
        product: "SERUM FACIAL ANTIAGE",
        code: "PT-SERUM-ANTIAGE",
        client: "THELMA Y LOUISE",
        lot: "L1",
      },
      calidad
    );
    const original = order.formData as OeContent;
    const tampered: OeContent = {
      ...original,
      materials: original.materials.map((m, i) =>
        i === 0
          ? {
              ...m,
              materiaPrima: "HACKED",
              formulaPct: 99,
              ajuste: 0.5,
              ajusteMotivo: "Corrección de pesada",
              lote: "LOTE-REAL",
            }
          : m
      ),
    };
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: tampered },
      elaboracion
    );
    expect(saved.formData.kind).toBe("OE");
    if (saved.formData.kind === "OE") {
      expect(saved.formData.materials[0]!.materiaPrima).toBe(original.materials[0]!.materiaPrima);
      expect(saved.formData.materials[0]!.formulaPct).toBe(original.materials[0]!.formulaPct);
      expect(saved.formData.materials[0]!.ajuste).toBe(0.5);
      expect(saved.formData.materials[0]!.lote).toBe("LOTE-REAL");
      expect(saved.formData.materials[0]!.ajusteMotivo).toBe("Corrección de pesada");
    }
  });

  it("ajuste calcula kg real y no modifica maestra; exige motivo si ≠ 0", async () => {
    expect(computeKgRealUtilizado(10, 0.5)).toBe(10.5);
    expect(computeKgRealUtilizado(10, -1)).toBe(9);
    const materials = [
      emptyOeMaterial({
        materiaPrima: "AGUA",
        kgAPesar: 10,
        ajuste: 1,
        ajusteMotivo: "",
      }),
    ];
    expect(validateAjusteRows(materials).length).toBeGreaterThan(0);
    materials[0]!.ajusteMotivo = "Merma de vaso";
    expect(validateAjusteRows(materials)).toHaveLength(0);

    const t = (await service.listTemplates("OE"))[0]!;
    const before = structuredClone(t.content);
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: t.id,
        assignedSector: "ELABORACION",
        product: "SERUM FACIAL ANTIAGE",
        code: "PT",
        client: "C",
        lot: "L",
      },
      calidad
    );
    const form = order.formData as OeContent;
    form.materials[0] = {
      ...form.materials[0]!,
      ajuste: 0.2,
      ajusteMotivo: "Ajuste proceso",
    };
    await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: form },
      elaboracion
    );
    const master = await service.getTemplate(t.id);
    expect(master.content).toEqual(before);
  });

  it("Calidad puede modificar fórmula en orden", async () => {
    const t = (await service.listTemplates("OE"))[0]!;
    const order = await service.createOrder(
      {
        type: "OE",
        templateId: t.id,
        assignedSector: "ELABORACION",
        product: "SERUM FACIAL ANTIAGE",
        code: "PT",
        client: "C",
        lot: "L",
      },
      calidad
    );
    const form = order.formData as OeContent;
    form.materials = [...form.materials, emptyOeMaterial({ materiaPrima: "NUEVA", formulaPct: 0.1 })];
    const saved = await service.saveProgress(
      order.id,
      { expectedVersion: order.version, formData: form },
      calidad
    );
    expect(saved.formData.kind).toBe("OE");
    if (saved.formData.kind === "OE") {
      expect(saved.formData.materials.some((m) => m.materiaPrima === "NUEVA")).toBe(true);
    }
  });

  it("applyElaboracionMaterialPatch conserva fórmula", () => {
    const current = createEmptyOeContent({ productName: "X" });
    current.materials = [
      emptyOeMaterial({ materiaPrima: "A", formulaPct: 50, kgAPesar: 5 }),
    ];
    const incoming = structuredClone(current);
    incoming.materials[0]!.materiaPrima = "B";
    incoming.materials[0]!.ajuste = -0.1;
    incoming.materials[0]!.ajusteMotivo = "ok";
    incoming.materials[0]!.lote = "L9";
    const patched = applyElaboracionMaterialPatch(current, incoming, "e@x.com");
    expect(patched.materials[0]!.materiaPrima).toBe("A");
    expect(patched.materials[0]!.ajuste).toBe(-0.1);
    expect(patched.materials[0]!.lote).toBe("L9");
  });
});

describe("OA completa según Word", () => {
  it("plantilla contiene todas las secciones estructurales", () => {
    const c = buildCremaFacialLaudeOaTemplateContent();
    expect(c.kind).toBe("OA");
    if (c.kind !== "OA") return;
    expect(c.title).toBe("ORDEN DE ACONDICIONAMIENTO");
    expect(c.header.productName).toBe("CREMA FACIAL");
    expect(c.analisisGranel).toBeTruthy();
    expect(c.materials.length).toBeGreaterThanOrEqual(5);
    expect(c.envasado.operariosList.length).toBeGreaterThan(0);
    expect(c.rendimientos.cargasParciales.length).toBeGreaterThan(0);
    expect(c.rendimientos.rangoTeorico).toBe("95-101%");
    expect(c.controlesPeso.filas.length).toBeGreaterThan(0);
    expect(c.etiquetadoCodificadoLegalText).toContain("Codificar en la hoja lote");
    expect(c.etiquetadoCodificado.loteCodificado).toBeDefined();
    expect(c.analisisProductoTerminado).toBeTruthy();
    expect(c.signatures.autorizacionProduccion).toBeNull();
  });

  it("calcula totales de unidades, aceptadas y rendimiento; protege división por cero", () => {
    let c = createEmptyOaContent({ productName: "CREMA" });
    c.rendimientos.produccionTeoricaUnidades = 1000;
    c.rendimientos.cargasParciales = [
      { id: "1", fecha: "2026-01-01", cantidadUnidades: 400 },
      { id: "2", fecha: "2026-01-02", cantidadUnidades: 500 },
    ];
    c.rendimientos.unidadesDesechadas = 20;
    c = recomputeOaDerived(c);
    expect(c.rendimientos.cantidadUnidades).toBe(900);
    expect(c.rendimientos.unidadesAceptadas).toBe(880);
    expect(c.rendimientos.rendimientoA).toBe(88);
    expect(rendimientoDentroDeRango(c.rendimientos.rendimientoA)).toBe(false);

    c.rendimientos.produccionTeoricaUnidades = 0;
    c = recomputeOaDerived(c);
    expect(c.rendimientos.rendimientoA).toBeNull();
  });

  it("guardar avance permite incompleto; entregar valida obligatorios", () => {
    const incomplete = createEmptyOaContent({ productName: "X" });
    expect(validateDeliverOa(incomplete).length).toBeGreaterThan(0);
  });

  it("firmas permanecen vacías", () => {
    const c = buildCremaFacialLaudeOaTemplateContent();
    assertBlankSignatures({
      id: "1",
      orderNumber: "OA-1",
      type: "OA",
      templateId: "t",
      templateVersion: 1,
      templateSnapshot: c,
      product: "CREMA FACIAL",
      client: "LAUDE",
      code: "HIDRATANTE",
      lot: "J1",
      assignedSector: "ENVASADO_MASIVO",
      status: "PENDIENTE",
      formData: c,
      completionPercentage: 0,
      revision: 1,
      version: 1,
      linkedWorkItemId: null,
      reviewedAt: null,
      reviewedBy: null,
      completedAt: null,
      completedBy: null,
      createdBy: "t",
      updatedBy: "t",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("Masivo edita OA; Codificado solo etiquetado", () => {
    expect(canOrderAction("OA", "edit", "ENVASADO_MASIVO")).toBe(true);
    expect(canOrderAction("OA", "edit_codificado", "CODIFICADO")).toBe(true);
    expect(canOrderAction("OA", "edit", "CODIFICADO")).toBe(false);
    expect(canOrderAction("OA", "manage_templates", "ENVASADO_MASIVO")).toBe(false);
  });
});

void normalizeOrderContent;
void masivo;
void codificado;
void mp;
void produccion;
