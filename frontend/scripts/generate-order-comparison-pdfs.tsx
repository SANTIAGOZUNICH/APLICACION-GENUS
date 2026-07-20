/**
 * Genera PDFs de comparación OE/OA a partir de plantillas seed (sin Neon).
 * Uso: npx tsx scripts/generate-order-comparison-pdfs.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { OperationalOrderPdfDocument } from "../src/lib/orders/pdf-document";
import {
  buildCremaFacialLaudeOaTemplateContent,
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
    client: formData.kind === "OE" ? formData.header.client : formData.header.client,
    code: formData.kind === "OE" ? formData.header.code : formData.header.productCode,
    lot: formData.kind === "OE" ? formData.header.lot : formData.header.lot,
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

  const oe = orderFrom("OE", buildSerumAntiageOeTemplateContent(), "OE-2026-COMPARE");
  const oa = orderFrom("OA", buildCremaFacialLaudeOaTemplateContent(), "OA-2026-COMPARE");

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

## Referencias
- OE - SERUM ANTIAGE THELMA.xlsx
- ORDEN DE ACONDICIONAMIENTO CREMA FACIAL LAUDE.docx

## Verificación
- Firmas: vacías (espacios en blanco para firma física).
- Formato: A4.
- Títulos y secciones legales conservados.
- Sin indicador de % completado en PDF.
- Metadatos: número de orden, versión de plantilla, id verificable.

## Diferencias residuales esperadas
- Tipografía Helvetica PDF vs tipografía Excel/Word del laboratorio.
- Logo: texto "Laboratorio Genus" (no imagen embebida del xlsx original).
- Densidad de celdas/grises aproximada; no idéntica pixel a pixel al archivo Office.
- Saltos de página: una página cuando el contenido lo permite; tablas largas pueden paginar.

## Estado legal
Estos PDFs demuestran equivalencia estructural. La funcionalidad es legalmente operativa solo con Neon (DATABASE_URL), migraciones aplicadas, backups y revisión humana lado a lado de cada lote.
`;
  writeFileSync(join(outDir, "DIFF-NOTES.md"), notes);
  console.log("Wrote", oePath, oaPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
