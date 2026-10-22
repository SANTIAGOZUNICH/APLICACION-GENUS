import PDFDocument from "pdfkit";
import type { RemitoRecord } from "./types";
import { consolidateLinesByProductLoteVto } from "./grouping";
import { lineCajaCombos, lineTotalCajas } from "./line-qty";

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * PDF portrait data-accurate (no pixel-perfect vs Excel).
 */
export async function buildRemitoPdf(remito: RemitoRecord): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: true });
  const done = collectPdf(doc);
  const lines = consolidateLinesByProductLoteVto(remito.lines);

  doc.fontSize(16).text("REMITO", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10);
  if (remito.remitoNumber) {
    doc.text(`Nº: ${remito.remitoNumber}`);
  }
  doc.text(`Versión: ${remito.version}`);
  doc.text(`Fecha: ${remito.deliveryDate}`);
  doc.text(`Cliente: ${remito.clientDisplay}`);
  doc.moveDown();

  doc.fontSize(9).text("TOTAL  |  PRODUCTO / L / VTO  |  CAJAS x UNIDADES POR CAJA");
  doc.moveDown(0.3);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.4);

  for (const line of lines) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    const label = `${line.product}  L: ${line.lote || "—"}   VTO: ${line.vto || "—"}`;
    // Todas las configuraciones de caja del renglón (1.ª, 2.ª, 3.ª y adicionales): antes solo se imprimían las dos primeras.
    const combos = lineCajaCombos(line)
      .filter((c) => (c.cajas || 0) > 0 || (c.unidades || 0) > 0)
      .map((c) => `${c.cajas} x ${c.unidades}`)
      .join("  +  ");
    doc.fontSize(9).text(
      `${line.totalUnits}  |  ${label}  |  ${combos || "sin cajas"}`,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
    );
    doc.moveDown(0.25);
  }

  const totalUnits = lines.reduce((s, l) => s + l.totalUnits, 0);
  const totalCajas = lines.reduce((s, l) => s + lineTotalCajas(l), 0);
  doc.moveDown();
  doc.fontSize(11).text(`TOTAL DE TODOS LOS PRODUCTOS: ${totalUnits}`);
  doc.text(`TOTAL BULTOS / CAJAS: ${totalCajas}`);
  doc.text(`Estado: ${remito.status}`);

  doc.end();
  return done;
}

export const REMITO_PDF_MIME = "application/pdf";
