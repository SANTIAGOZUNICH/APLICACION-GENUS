/**
 * One-off: genera remito-muestra.pdf + remito-muestra.xlsx (demo UNICA).
 * Uso: npx tsx scripts/generate-remito-muestra.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRemitoPdf } from "../src/lib/remitos/remito-pdf";
import { buildRemitoXlsx } from "../src/lib/remitos/remito-xlsx";
import type { RemitoRecord } from "../src/lib/remitos/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "assets", "remitos", "samples");

const now = new Date().toISOString();

const remito: RemitoRecord = {
  id: "remito-muestra-demo",
  remitoNumber: "MUESTRA-001",
  displayName: "Remito muestra UNICA",
  clientIdNormalized: "unica",
  clientDisplay: "UNICA",
  deliveryDate: "2026-07-30",
  status: "GENERADO",
  version: 1,
  totalUnits: 0,
  totalCajas: 0,
  totalBultos: 0,
  snapshot: {},
  createdBy: "demo@genus",
  createdBySector: "PRODUCCION",
  updatedBy: "demo@genus",
  generatedBy: "demo@genus",
  createdAt: now,
  updatedAt: now,
  generatedAt: now,
  lines: [
    {
      id: "line-1",
      remitoId: "remito-muestra-demo",
      workItemId: "wi-demo-1",
      product: "Shampoo sólido 250g",
      lote: "L-2607-A",
      vto: "2027-07",
      totalUnits: 240,
      cajas1: 20,
      unidades1: 12,
      cajas2: 0,
      unidades2: 0,
      sortOrder: 0,
    },
    {
      id: "line-2",
      remitoId: "remito-muestra-demo",
      workItemId: "wi-demo-2",
      product: "Crema facial 50ml",
      lote: "L-2607-B",
      vto: "2027-01",
      totalUnits: 120,
      cajas1: 10,
      unidades1: 12,
      cajas2: 0,
      unidades2: 0,
      sortOrder: 1,
    },
    {
      id: "line-3",
      remitoId: "remito-muestra-demo",
      workItemId: "wi-demo-3",
      product: "Gel limpiador 200ml",
      lote: "L-2607-C",
      vto: "2027-03",
      totalUnits: 96,
      cajas1: 8,
      unidades1: 12,
      cajas2: 0,
      unidades2: 0,
      sortOrder: 2,
    },
  ],
  versions: [
    {
      version: 1,
      motivo: null,
      createdBy: "demo@genus",
      createdAt: now,
      downloadable: true,
    },
  ],
};

remito.totalUnits = remito.lines.reduce((s, l) => s + l.totalUnits, 0);
remito.totalCajas = remito.lines.reduce((s, l) => s + l.cajas1 + l.cajas2, 0);
remito.totalBultos = remito.totalCajas;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const xlsxPath = path.join(outDir, "remito-muestra.xlsx");
  const pdfPath = path.join(outDir, "remito-muestra.pdf");

  const [xlsx, pdf] = await Promise.all([
    buildRemitoXlsx(remito),
    buildRemitoPdf(remito),
  ]);

  fs.writeFileSync(xlsxPath, xlsx);
  fs.writeFileSync(pdfPath, pdf);

  console.log(`[remito-muestra] wrote ${xlsxPath} (${xlsx.length} bytes)`);
  console.log(`[remito-muestra] wrote ${pdfPath} (${pdf.length} bytes)`);
}

main().catch((err) => {
  console.error("[remito-muestra] FALLÓ:", err);
  process.exit(1);
});
