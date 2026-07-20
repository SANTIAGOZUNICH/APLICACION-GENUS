/** Plantillas maestras seed — OE Serum Thelma y OA Crema Facial Laude. */

import {
  createEmptyOaContent,
  createEmptyOeContent,
  emptyOeMaterial,
  emptyOaMaterial,
  normalizeOrderContent,
  stepsFromTexts,
} from "@/lib/orders/content";
import type { OrderContent, OrderTemplateRecord } from "@/lib/orders/types";

export const SERUM_ANTIAGE_PRODUCT_ID = "serum-facial-antiage-thelma";
export const CREMA_FACIAL_LAUDE_PRODUCT_ID = "crema-facial-laude";

/** UUIDs fijos válidos — idempotencia del seed en Neon (columna uuid). */
export const SEED_OE_SERUM_TEMPLATE_ID = "11111111-1111-4111-8111-111111111101";
export const SEED_OA_LAUDE_TEMPLATE_ID = "11111111-1111-4111-8111-111111111102";

export const SEED_OE_SOURCE_FILE = "OE - SERUM ANTIAGE THELMA.xlsx";
export const SEED_OA_SOURCE_FILE = "ORDEN DE ACONDICIONAMIENTO CREMA FACIAL LAUDE.docx";

/**
 * OE plantilla: estructura + fórmula + procedimiento + specs.
 * Sin datos variables de orden (lote, fecha, cantidad, cliente, resultados).
 */
export function buildSerumAntiageOeTemplateContent(): OrderContent {
  const base = createEmptyOeContent({
    productName: "SERUM FACIAL ANTIAGE",
    code: "PT-SERUM-ANTIAGE",
    date: "",
    quantityKg: null,
    lot: "",
    vigencia: "",
    client: "",
    envaseCubica: "",
    equipoCalefactor: "",
  });
  base.materials = [
    emptyOeMaterial({ materiaPrima: "AGUA", formulaPct: 95 }),
    emptyOeMaterial({ materiaPrima: "CARBOPOL", formulaPct: 0.3 }),
    emptyOeMaterial({ materiaPrima: "GLICERINA", formulaPct: 3 }),
    emptyOeMaterial({
      materiaPrima: "COLAGENO HIDROLIZADO",
      formulaPct: 0.01,
    }),
    emptyOeMaterial({
      materiaPrima: "AC- HIALURONICO LIQUIDO",
      formulaPct: 0.001,
    }),
    emptyOeMaterial({ materiaPrima: "BACTERKILL", formulaPct: 1 }),
    emptyOeMaterial({ materiaPrima: "TWEEN 20", formulaPct: 1 }),
    emptyOeMaterial({ materiaPrima: "TRIETA", formulaPct: 0.15 }),
  ];
  base.procedureSteps = stepsFromTexts([
    "1- Pesar cada componente y registrar",
    "2- Mezclar todos los componentes excepto tween, retinol y trieta",
    "3- Un vez todo bien integrado agregar lentamente tween + retinol previamente mezclados",
    "4- Ultimo agregar trieta hasta lograr viscosidad",
    "5- Preparar muestras para Control de Calidad",
    "6- Mantener tapado hasta recibir los resultados del Laboratorio de C. C.",
  ]);
  base.processControl.aspectoSpec = "Homogéneo";
  base.processControl.olorSpec = "Caracteristico";
  base.processControl.viscosidadSpec = "Viscosidad S64, 6 RPM, 25ºC (cPs)";
  base.processControl.aspecto = "";
  base.processControl.olor = "";
  base.processControl.color = "";
  base.processControl.ph = "";
  base.processControl.viscosidad = "";
  base.processControl.cantidadReal = null;
  base.processControl.mermaPct = null;
  base.processControl.cantidadObtenida = null;
  base.processControl.fechaFin = "";
  base.qualityControl.resultado = "";
  base.qualityControl.fecha = "";
  return normalizeOrderContent(base);
}

/**
 * OA plantilla: estructura de insumos/envasado/rendimiento/controles + texto legal.
 * Sin datos variables (cliente, lote, VTO, fechas, responsables, resultados).
 */
export function buildCremaFacialLaudeOaTemplateContent(): OrderContent {
  const base = createEmptyOaContent({
    productName: "CREMA FACIAL",
    client: "",
    lot: "",
    analisis: "",
    productCode: "HIDRATANTE",
    vto: "",
    aprobo: "",
    fechaEmision: "",
  });
  base.analisisGranel = { resultado: "", aprobado: null };
  base.materials = [
    emptyOaMaterial(1, { nombreInsumo: "ENVASE", codigo: "" }),
    emptyOaMaterial(2, { nombreInsumo: "TAPA / CIERRE", codigo: "" }),
    emptyOaMaterial(3, { nombreInsumo: "ETIQUETA", codigo: "" }),
    emptyOaMaterial(4, { nombreInsumo: "PROSPECTO", codigo: "" }),
    emptyOaMaterial(5, { nombreInsumo: "CAJA / ESTUCHE", codigo: "" }),
  ];
  base.materialsFecha = "";
  base.envasado = { fechaInicio: "", fechaTerminacion: "", operarios: "" };
  base.rendimientos = {
    produccionTeoricaUnidades: null,
    contenidoTeorico: "",
    fecha: "",
    cantidadUnidades: null,
    rendimientoA: null,
    rangoTeorico: "95-101%",
  };
  base.observaciones = "";
  base.controlesPeso = {
    limiteTexto: "Limite inferior/ superior: +/- 5 %",
    fecha: "",
    inicio: "",
    medio: "",
    final: "",
  };
  base.analisisProductoTerminado = { resultado: "" };
  return normalizeOrderContent(base);
}

export type SeedTemplateMeta = {
  sourceFile: string;
  exampleClient: string;
};

export const SEED_TEMPLATE_META: Record<string, SeedTemplateMeta> = {
  [SEED_OE_SERUM_TEMPLATE_ID]: {
    sourceFile: SEED_OE_SOURCE_FILE,
    exampleClient: "THELMA Y LOUISE",
  },
  [SEED_OA_LAUDE_TEMPLATE_ID]: {
    sourceFile: SEED_OA_SOURCE_FILE,
    exampleClient: "LAUDE",
  },
};

export function seedTemplateRecords(now = new Date().toISOString()): OrderTemplateRecord[] {
  return [
    {
      id: SEED_OE_SERUM_TEMPLATE_ID,
      type: "OE",
      productId: SERUM_ANTIAGE_PRODUCT_ID,
      productName: "SERUM FACIAL ANTIAGE",
      productCode: "PT-SERUM-ANTIAGE",
      brandClient: "THELMA Y LOUISE",
      version: 1,
      status: "VIGENTE",
      content: buildSerumAntiageOeTemplateContent(),
      changeReason: `Plantilla inicial v1 — origen: ${SEED_OE_SOURCE_FILE}`,
      sourceFile: SEED_OE_SOURCE_FILE,
      previousVersionId: null,
      createdBy: "system@laboratoriogenus.com.ar",
      updatedBy: "system@laboratoriogenus.com.ar",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SEED_OA_LAUDE_TEMPLATE_ID,
      type: "OA",
      productId: CREMA_FACIAL_LAUDE_PRODUCT_ID,
      productName: "CREMA FACIAL",
      productCode: "HIDRATANTE",
      brandClient: "LAUDE",
      version: 1,
      status: "VIGENTE",
      content: buildCremaFacialLaudeOaTemplateContent(),
      changeReason: `Plantilla inicial v1 — origen: ${SEED_OA_SOURCE_FILE}`,
      sourceFile: SEED_OA_SOURCE_FILE,
      previousVersionId: null,
      createdBy: "system@laboratoriogenus.com.ar",
      updatedBy: "system@laboratoriogenus.com.ar",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Catálogo builtin (preview sin Neon). No implica persistencia legal. */
export function listBuiltinTemplates(type?: "OE" | "OA"): OrderTemplateRecord[] {
  const all = seedTemplateRecords();
  return type ? all.filter((t) => t.type === type) : all;
}

export function getBuiltinTemplate(id: string): OrderTemplateRecord | null {
  return seedTemplateRecords().find((t) => t.id === id) ?? null;
}
