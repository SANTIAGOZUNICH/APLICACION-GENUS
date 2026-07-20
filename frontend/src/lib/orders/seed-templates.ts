/** Plantillas maestras seed — reproducen OE Serum Thelma y OA Crema Facial Laude. */

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

export function buildSerumAntiageOeTemplateContent(): OrderContent {
  const base = createEmptyOeContent({
    productName: "SERUM FACIAL ANTIAGE",
    code: "",
    date: "2026-07-20",
    quantityKg: 98,
    lot: "L26046",
    vigencia: "07-28",
    client: "THELMA Y LOUISE",
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
  return normalizeOrderContent(base);
}

export function buildCremaFacialLaudeOaTemplateContent(): OrderContent {
  const base = createEmptyOaContent({
    productName: "CREMA FACIAL",
    client: "LAUDE",
    lot: "J26003",
    analisis: "",
    productCode: "HIDRATANTE",
    vto: "2028-01-06",
    aprobo: "SANTIAGO",
    fechaEmision: "2026-06-04",
  });
  base.analisisGranel = { resultado: "APROBADO", aprobado: true };
  base.materials = [1, 2, 3, 4, 5].map((n) => emptyOaMaterial(n));
  return normalizeOrderContent(base);
}

export function seedTemplateRecords(now = new Date().toISOString()): OrderTemplateRecord[] {
  return [
    {
      id: "tmpl-oe-serum-antiage-v1",
      type: "OE",
      productId: SERUM_ANTIAGE_PRODUCT_ID,
      productName: "SERUM FACIAL ANTIAGE",
      productCode: "PT-SERUM-ANTIAGE",
      brandClient: "THELMA Y LOUISE",
      version: 1,
      status: "VIGENTE",
      content: buildSerumAntiageOeTemplateContent(),
      changeReason: "Plantilla inicial desde OE - SERUM ANTIAGE THELMA.xlsx",
      previousVersionId: null,
      createdBy: "system@laboratoriogenus.com.ar",
      updatedBy: "system@laboratoriogenus.com.ar",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "tmpl-oa-crema-facial-laude-v1",
      type: "OA",
      productId: CREMA_FACIAL_LAUDE_PRODUCT_ID,
      productName: "CREMA FACIAL",
      productCode: "HIDRATANTE",
      brandClient: "LAUDE",
      version: 1,
      status: "VIGENTE",
      content: buildCremaFacialLaudeOaTemplateContent(),
      changeReason:
        "Plantilla inicial desde ORDEN DE ACONDICIONAMIENTO CREMA FACIAL LAUDE.docx",
      previousVersionId: null,
      createdBy: "system@laboratoriogenus.com.ar",
      updatedBy: "system@laboratoriogenus.com.ar",
      createdAt: now,
      updatedAt: now,
    },
  ];
}
