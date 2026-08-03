/**
 * Genera PDFs de comparación OE/OA a partir de plantillas seed (sin Neon).
 * Uso: npx tsx scripts/generate-order-comparison-pdfs.tsx
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { OperationalOrderPdfDocument } from "../src/lib/orders/pdf-document";
import { normalizeOrderContent } from "../src/lib/orders/content";
import {
  buildCremaFacialLaudeOaSampleOrderContent,
  buildSerumAntiageOeTemplateContent,
} from "../src/lib/orders/seed-templates";
import type { OperationalOrderRecord } from "../src/lib/orders/types";

function orderFrom(
  type: "OE" | "OA",
  formData: OperationalOrderRecord["formData"],
  number: string
): OperationalOrderRecord {
  return {
    id: type === "OE" ? "oe-compare-serum" : "oa-compare-laude",
    orderNumber: number,
    type,
    templateId: "seed",
    templateVersion: 1,
    templateSnapshot: formData,
    product: formData.header.productName,
    client: formData.header.client,
    code: formData.kind === "OE" ? formData.header.code : formData.header.productCode,
    lot: formData.header.lot,
    assignedSector: type === "OE" ? "ELABORACION" : "ENVASADO_MASIVO",
    status: "COMPLETA",
    formData,
    completionPercentage: 100,
    revision: 1,
    version: 1,
    linkedWorkItemId: null,
    reviewedAt: null,
    reviewedBy: null,
    completedAt: new Date().toISOString(),
    completedBy: "comparacion@laboratoriogenus.com.ar",
    createdBy: "comparacion@laboratoriogenus.com.ar",
    updatedBy: "comparacion@laboratoriogenus.com.ar",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const outDir =
    process.env.COMPARISON_OUT_DIR ||
    "/opt/cursor/artifacts/oe-oa-pdf-comparison";
  mkdirSync(outDir, { recursive: true });

  const oeContent = buildSerumAntiageOeTemplateContent();
  if (oeContent.kind === "OE") {
    oeContent.header.client = "THELMA Y LOUISE";
    oeContent.header.lot = "L26046";
    oeContent.header.date = "2026-07-20";
    oeContent.header.quantityKg = 98;
  }
  const oe = orderFrom("OE", normalizeOrderContent(oeContent), "OE-2026-COMPARE");
  const oa = orderFrom(
    "OA",
    buildCremaFacialLaudeOaSampleOrderContent(),
    "OA-2026-COMPARE"
  );

  const oeBuf = await renderToBuffer(<OperationalOrderPdfDocument order={oe} />);
  const oaBuf = await renderToBuffer(<OperationalOrderPdfDocument order={oa} />);

  const oePath = join(outDir, "OE-SERUM-ANTIAGE-THELMA-genus.pdf");
  const oaPath = join(outDir, "OA-CREMA-FACIAL-LAUDE-genus.pdf");
  writeFileSync(oePath, oeBuf);
  writeFileSync(oaPath, oaBuf);

  const notes = `# Comparación visual OE/OA

## Archivos
- ${oePath}
- ${oaPath}
- Referencia Word: ORDEN DE ACONDICIONAMIENTO CREMA FACIAL LAUDE.docx

## OA — secciones verificadas vs Word
1. Encabezado LABORATORIO GENUS + ORDEN DE ACONDICIONAMIENTO
2. PRODUCTO / CLIENTE
3. LOTE | ANÁLISIS | CÓDIGO PRODUCTO | VTO
4. APROBÓ | FECHA DE EMISIÓN
5. ANÁLISIS DE GRANEL (RESULTADO + FIRMA vacía)
6. SUMINISTRO DE MATERIALES (tabla 8 columnas, filas variables)
7. ENVASADO (inicio / terminación / operarios)
8. RENDIMIENTOS + OBSERVACIONES (cargas parciales, totales, 95–101%)
9. CONTROLES peso/volumen (FECHA INICIO FIRMA MEDIO FIRMA FINAL FIRMA)
10. Etiquetado/Codificado (texto legal + campos)
11. ANÁLISIS PRODUCTO TERMINADO + FIRMA vacía
12. Autorizaciones PRODUCCIÓN / CC / DT vacías

## Diferencias conocidas
- Tipografía Helvetica vs fuente Office del .docx
- Márgenes/espaciado aproximados (no pixel-perfect)
- Logo: imagen brand si existe; si no, texto LABORATORIO GENUS
- Firmas: espacios vacíos intencionales

## Veredicto
Estructura alineada al Word. No se afirma coincidencia pixel-perfect.
`;
  writeFileSync(join(outDir, "DIFF-NOTES.md"), notes);
  console.log("Wrote", oePath, oaPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
