import { describe, expect, it } from "vitest";
import {
  createEmptyOaContent,
  recomputeOaDerived,
} from "@/lib/orders/content";
import {
  computeDesechadosAuto,
  computeRendimientoA,
  computeUnidadesAceptadas,
  createEmptyOaSimpleForm,
  deriveOaSimpleForm,
  initOaSimpleFormFromLegal,
  mapOASimpleFormToLegalDocument,
  resolveOaDate,
  resolveResponsableGeneral,
  sanitizeLegalPrintValue,
  summarizeOaSimpleDerived,
} from "@/lib/orders/oa-simple-form";
import { validateDeliverOa } from "@/lib/orders/validators";
import { buildCremaFacialLaudeOaSampleOrderContent } from "@/lib/orders/seed-templates";
import { assertBlankSignatures } from "@/lib/orders/pdf-document";
import type { OaContent, OperationalOrderRecord } from "@/lib/orders/types";

describe("OA carga simple → documento legal", () => {
  it("abre en modo simple con cuatro pasos lógicos (modelo)", () => {
    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    expect(simple.todoMismoDia).toBe(true);
    expect(simple.fechaJornada).toBe("2026-07-21");
    // Pasos: generales, materiales, producción/controles, revisar — cubiertos por wizard UI.
    expect(["Datos generales", "Materiales", "Producción", "Revisar"].length).toBe(4);
  });

  it("fecha de jornada completa todas las fechas del PDF", () => {
    const simple = createEmptyOaSimpleForm({
      fechaJornada: "2026-07-21",
      productName: "CREMA FACIAL",
    });
    simple.todoMismoDia = true;
    simple.operarios = [{ id: "1", nombre: "Ana", sector: "Masivo" }];
    simple.totalUnidadesLlenadas = 1000;
    simple.produccionTeoricaUnidades = 1000;
    simple.materials[0].nombreInsumo = "ENVASE";
    simple.materials[0].recibidos = "100";
    simple.materials[0].usados = "95";

    const legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.header.fechaEmision).toBe("2026-07-21");
    expect(legal.materialsFecha).toBe("2026-07-21");
    expect(legal.envasado.fechaInicio).toBe("2026-07-21");
    expect(legal.envasado.fechaTerminacion).toBe("2026-07-21");
    expect(legal.rendimientos.fecha).toBe("2026-07-21");
    expect(legal.controlesPeso.fecha).toBe("2026-07-21");
    expect(legal.etiquetadoCodificado.fechaControl).toBe("2026-07-21");
    expect(legal.materials[0].fecha).toBe("2026-07-21");
    expect(legal.rendimientos.cargasParciales[0].fecha).toBe("2026-07-21");
  });

  it("todo el mismo día usa jornada; fecha específica reemplaza solo su sección", () => {
    expect(resolveOaDate("", "2026-07-21", true)).toBe("2026-07-21");
    expect(resolveOaDate("2026-07-22", "2026-07-21", true)).toBe("2026-07-21");
    expect(resolveOaDate("2026-07-22", "2026-07-21", false)).toBe("2026-07-22");
    expect(resolveOaDate("", "2026-07-21", false)).toBe("2026-07-21");

    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    simple.todoMismoDia = false;
    simple.fechas.controles = "2026-07-22";
    simple.productName = "X";
    simple.operarios = [{ id: "1", nombre: "Ana", sector: "" }];
    simple.materials[0].nombreInsumo = "ENVASE";
    simple.totalUnidadesLlenadas = 10;
    simple.produccionTeoricaUnidades = 10;
    const legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.header.fechaEmision).toBe("2026-07-21");
    expect(legal.controlesPeso.fecha).toBe("2026-07-22");
  });

  it("operarios se reutilizan como responsables; específico tiene prioridad", () => {
    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    simple.operarios = [{ id: "1", nombre: "Lucia", sector: "Masivo" }];
    simple.materials[0].nombreInsumo = "TAPA";
    simple.materials[0].responsableOverride = "Pedro";
    simple.productName = "X";
    simple.totalUnidadesLlenadas = 1;
    simple.produccionTeoricaUnidades = 1;
    expect(resolveResponsableGeneral(simple)).toBe("Lucia");
    const legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.materials[0].responsable).toBe("Pedro");
    expect(legal.etiquetadoCodificado.responsable).toBe("Lucia");
  });

  it("total de unidades genera una fila automática; tandas son opcionales", () => {
    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    simple.productName = "X";
    simple.operarios = [{ id: "1", nombre: "A", sector: "" }];
    simple.materials[0].nombreInsumo = "E";
    simple.registrarPorTandas = false;
    simple.totalUnidadesLlenadas = 850;
    simple.produccionTeoricaUnidades = 900;
    let legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.rendimientos.cargasParciales[0].cantidadUnidades).toBe(850);
    expect(legal.rendimientos.cargasParciales[0].fecha).toBe("2026-07-21");

    simple.registrarPorTandas = true;
    simple.tandas = [
      { id: "a", fecha: "2026-07-21", cantidadUnidades: 400 },
      { id: "b", fecha: "2026-07-21", cantidadUnidades: 450 },
    ];
    legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.rendimientos.cargasParciales[0].cantidadUnidades).toBe(400);
    expect(legal.rendimientos.cargasParciales[1].cantidadUnidades).toBe(450);
  });

  it("rendimiento y desechados se calculan automáticamente", () => {
    expect(computeDesechadosAuto("100", "92")).toBe("8");
    expect(computeUnidadesAceptadas(1000, 20)).toBe(980);
    expect(computeRendimientoA(980, 1000)).toBe(98);
    expect(computeRendimientoA(980, 0)).toBeNull();

    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    simple.totalUnidadesLlenadas = 1000;
    simple.unidadesDesechadas = 20;
    simple.produccionTeoricaUnidades = 1000;
    const s = summarizeOaSimpleDerived(simple);
    expect(s.aceptadas).toBe(980);
    expect(s.rendimientoA).toBe(98);
    expect(s.enRango).toBe(true);
  });

  it("código/lote/VTO/cliente opcionales no bloquean entregar si hay datos operativos", () => {
    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21", productName: "CREMA" });
    simple.operarios = [{ id: "1", nombre: "Ana", sector: "" }];
    simple.materials[0].nombreInsumo = "ENVASE";
    simple.materials[0].recibidos = "10";
    simple.materials[0].usados = "10";
    simple.totalUnidadesLlenadas = 100;
    simple.produccionTeoricaUnidades = 100;
    simple.client = "";
    simple.lot = "";
    simple.vto = "";
    simple.productCode = "";
    const legal = mapOASimpleFormToLegalDocument(simple);
    const missing = validateDeliverOa(legal);
    expect(missing).not.toContain("Cliente");
    expect(missing).not.toContain("Lote");
    expect(missing).not.toContain("VTO");
    expect(missing).not.toContain("Código");
    expect(missing).toEqual([]);
  });

  it("PDF legal mantiene secciones, firmas vacías y sin undefined/null/N/A", () => {
    const sample = buildCremaFacialLaudeOaSampleOrderContent();
    expect(sample.kind).toBe("OA");
    const simple = initOaSimpleFormFromLegal(sample as OaContent, {
      fechaJornada: "2026-07-21",
    });
    simple.fechaJornada = "2026-07-21";
    simple.todoMismoDia = true;
    simple.operarios = [{ id: "1", nombre: "Operario 1", sector: "Masivo" }];
    simple.totalUnidadesLlenadas = 1000;
    simple.produccionTeoricaUnidades = 1000;
    simple.unidadesDesechadas = 0;
    const legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.title).toBe("ORDEN DE ACONDICIONAMIENTO");
    expect(legal.materials.length).toBeGreaterThan(0);
    expect(legal.controlesPeso.filas.length).toBeGreaterThan(0);
    expect(legal.etiquetadoCodificadoLegalText).toContain("Codificar");
    expect(Object.values(legal.signatures).every((v) => v === null)).toBe(true);
    expect(sanitizeLegalPrintValue(undefined)).toBe("");
    expect(sanitizeLegalPrintValue(null)).toBe("");
    expect(sanitizeLegalPrintValue("N/A")).toBe("");
    expect(sanitizeLegalPrintValue("HIDRATANTE")).toBe("HIDRATANTE");

    assertBlankSignatures({
      id: "1",
      orderNumber: "OA-1",
      type: "OA",
      templateId: "t",
      templateVersion: 1,
      templateSnapshot: legal,
      product: legal.header.productName,
      client: legal.header.client,
      code: legal.header.productCode,
      lot: legal.header.lot,
      assignedSector: "ENVASADO_MASIVO",
      formulaProductId: null,
      formulaVersionId: null,
      formulaVersionHash: null,
      status: "PENDIENTE",
      formData: legal,
      completionPercentage: 50,
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
    } satisfies OperationalOrderRecord);
  });

  it("derive ↔ map preserva producto y permite overrides", () => {
    const base = recomputeOaDerived(
      createEmptyOaContent({ productName: "CREMA FACIAL", client: "LAUDE" })
    );
    base.header.fechaEmision = "2026-06-04";
    base.materialsFecha = "2026-06-04";
    base.envasado.fechaInicio = "2026-06-04";
    base.envasado.fechaTerminacion = "2026-06-04";
    const simple = deriveOaSimpleForm(base);
    expect(simple.todoMismoDia).toBe(true);
    expect(simple.productName).toBe("CREMA FACIAL");
    simple.totalUnidadesLlenadas = 500;
    simple.produccionTeoricaUnidades = 500;
    simple.operarios = [{ id: "1", nombre: "Beto", sector: "" }];
    simple.materials[0].nombreInsumo = "ENVASE";
    const again = mapOASimpleFormToLegalDocument(simple, base);
    expect(again.header.productName).toBe("CREMA FACIAL");
    expect(again.header.client).toBe("LAUDE");
    expect(again.rendimientos.cantidadUnidades).toBe(500);
  });

  it("controles adicionales son opcionales; un bloque alcanza", () => {
    const simple = createEmptyOaSimpleForm({ fechaJornada: "2026-07-21" });
    simple.productName = "X";
    simple.operarios = [{ id: "1", nombre: "A", sector: "" }];
    simple.materials[0].nombreInsumo = "E";
    simple.totalUnidadesLlenadas = 10;
    simple.produccionTeoricaUnidades = 10;
    simple.controles[0].inicio = "10";
    simple.controles[0].medio = "10.1";
    simple.controles[0].final = "9.9";
    const legal = mapOASimpleFormToLegalDocument(simple);
    expect(legal.controlesPeso.filas[0].inicio).toBe("10");
    expect(legal.controlesPeso.filas.length).toBeGreaterThanOrEqual(2);
  });
});

void createEmptyOaContent;
