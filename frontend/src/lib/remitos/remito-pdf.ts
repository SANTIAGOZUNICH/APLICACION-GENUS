import PDFDocument from "pdfkit";
import type { RemitoRecord } from "./types";
import { buildRemitoXlsx } from "./remito-xlsx";
import { layoutRemitoFromXlsx, REMITO_PAGE_H, REMITO_PAGE_W, type RemitoLayout } from "./remito-layout";

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Dibuja la maquetación del remito (la misma de la vista previa) como PDF A4 vertical, una sola hoja: texto real, no imagen. */
export async function renderRemitoLayoutPdf(layout: RemitoLayout, title = "Remito"): Promise<Buffer> {
  const doc = new PDFDocument({ size: [REMITO_PAGE_W, REMITO_PAGE_H], margin: 0, autoFirstPage: false, info: { Title: title, Author: "Laboratorio Genus" } });
  const done = collectPdf(doc);
  for (const page of layout.pages) {
    doc.addPage({ size: [REMITO_PAGE_W, REMITO_PAGE_H], margin: 0 });
    // Sin cuadrícula: la maquetación solo aporta posiciones; no se dibuja ninguna línea de celda.
    for (const t of page.texts) {
      const font = t.bold ? (t.italic ? "Helvetica-BoldOblique" : "Helvetica-Bold") : t.italic ? "Helvetica-Oblique" : "Helvetica";
      const pad = 3;
      const maxW = Math.max(1, t.w - 2 * pad);
      let size = t.size;
      doc.font(font).fontSize(size);
      if (!t.wrap) while (size > 6 && doc.widthOfString(t.text) > maxW) doc.fontSize((size -= 0.5));
      const textH = doc.heightOfString(t.text, { width: maxW, align: t.align });
      const y = t.valign === "middle" ? t.y + (t.h - textH) / 2 : t.valign === "top" ? t.y + 1 : t.y + t.h - textH - 2;
      doc.fillColor("#000000").text(t.text, t.x + pad, y, { width: maxW, align: t.align, lineBreak: t.wrap, height: t.wrap ? t.h : undefined });
    }
  }
  doc.end();
  return done;
}

/** PDF del remito: sale del mismo XLSX (plantilla del laboratorio) que se descarga, con la misma estructura y datos. */
export async function buildRemitoPdf(remito: RemitoRecord): Promise<Buffer> {
  const layout = await layoutRemitoFromXlsx(await buildRemitoXlsx(remito));
  return renderRemitoLayoutPdf(layout, `Remito ${remito.remitoNumber ?? ""} ${remito.clientDisplay}`.trim());
}
