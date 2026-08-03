import PDFDocument from "pdfkit";
import { PDFDocument as PdfLibDocument, degrees } from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MP_LABEL_CONTENT_SCALE,
  MP_LABEL_HEIGHT_PT,
  MP_LABEL_MARGIN_X_PT,
  MP_LABEL_PRINT_OFFSET_X_MM,
  MP_LABEL_PRINT_OFFSET_Y_MM,
  MP_LABEL_SAFE_WIDTH_PT,
  MP_LABEL_WIDTH_PT,
  mmToPt,
  type MpAprobadoLabelData,
} from "@/lib/inventory/mp-aprobado-label";

/**
 * Genera etiqueta 75×50 mm con PDFKit (1 página, sin React-PDF).
 * Luego normaliza MediaBox/CropBox/TrimBox/BleedBox y Rotate=0 con pdf-lib.
 */

function collectPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function loadThermalLogo(): Buffer | null {
  try {
    const logoPath = path.join(
      process.cwd(),
      "public",
      "brand",
      "laboratorio-genus-logo-thermal.png"
    );
    return readFileSync(logoPath);
  } catch {
    return null;
  }
}

function drawCell(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  opts?: { borderRight?: boolean; valueSize?: number }
) {
  const labelSize = 4.2;
  const valueSize = opts?.valueSize ?? 8.2;
  doc.font("Helvetica-Bold").fontSize(labelSize).fillColor("#000000");
  doc.text(label, x + 4, y + 2, { width: w - 7, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(valueSize);
  const valueTop = y + 8.5;
  doc.text((value || " ").toUpperCase(), x + 3.5, valueTop, {
    width: w - 7,
    height: h - 11,
    align: "center",
    ellipsis: true,
  });
  if (opts?.borderRight) {
    doc
      .moveTo(x + w, y)
      .lineTo(x + w, y + h)
      .lineWidth(0.5)
      .strokeColor("#000000")
      .stroke();
  }
}

/**
 * Dibuja el formulario completo dentro de [0,0]–[W,H] sin overflow ni 2ª página.
 * Aplica calibración de impresión (offset + escala) para adhesivo físico SP320.
 */
function drawLabel(doc: PDFKit.PDFDocument, data: MpAprobadoLabelData) {
  const W = MP_LABEL_WIDTH_PT;
  const H = MP_LABEL_HEIGHT_PT;
  const mx = MP_LABEL_MARGIN_X_PT;
  const my = mmToPt(1.8);
  const footerH = mmToPt(3.2);
  const frameX = mx;
  const frameY = my;
  const frameW = MP_LABEL_SAFE_WIDTH_PT;
  const frameH = H - my - footerH - mmToPt(0.8);
  const border = 1.15;
  const cellPadX = 4;
  const ox = mmToPt(MP_LABEL_PRINT_OFFSET_X_MM);
  const oy = mmToPt(MP_LABEL_PRINT_OFFSET_Y_MM);
  const scale = MP_LABEL_CONTENT_SCALE;

  // Fondo blanco de página completa (sin transformar)
  doc.rect(0, 0, W, H).fill("#ffffff");

  doc.save();
  doc.translate(ox, oy);
  doc.scale(scale);

  // Marco
  doc.lineWidth(border).strokeColor("#000000");
  doc.rect(frameX, frameY, frameW, frameH).stroke();

  let y = frameY;
  const headerH = mmToPt(9);
  const barH = mmToPt(5.2);
  const inner = frameH - headerH - barH;
  const rowH = inner / 4;

  // Header
  const logo = loadThermalLogo();
  const logoW = mmToPt(26);
  const logoH = mmToPt(8.5);
  if (logo) {
    doc.image(logo, frameX + cellPadX, y + (headerH - logoH) / 2, {
      width: logoW,
      height: logoH,
      fit: [logoW, logoH],
    });
  }
  doc
    .font("Helvetica-Bold")
    .fontSize(13.5)
    .fillColor("#000000")
    .text("APROBADO", frameX + logoW + 4, y + headerH / 2 - 7, {
      width: frameW - logoW - 8,
      align: "right",
      lineBreak: false,
    });
  y += headerH;

  // Barra MATERIA PRIMA
  doc.rect(frameX, y, frameW, barH).fill("#000000");
  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor("#ffffff")
    .text("MATERIA PRIMA", frameX, y + barH / 2 - 4, {
      width: frameW,
      align: "center",
      lineBreak: false,
    });
  y += barH;

  // Separador superior de grilla
  doc
    .moveTo(frameX, y)
    .lineTo(frameX + frameW, y)
    .lineWidth(0.5)
    .strokeColor("#000000")
    .stroke();

  // Row 1: PRODUCTO | PCC-ME
  const r1y = y;
  const prodW = frameW * (1.85 / 2.85);
  const pccW = frameW - prodW;
  drawCell(doc, frameX, r1y, prodW, rowH, "PRODUCTO:", data.producto, {
    borderRight: true,
    valueSize: 8.5,
  });
  drawCell(doc, frameX + prodW, r1y, pccW, rowH, "PCC-ME Nº:", data.pccMeNro, {
    valueSize: 7.2,
  });
  doc
    .moveTo(frameX, r1y + rowH)
    .lineTo(frameX + frameW, r1y + rowH)
    .lineWidth(0.5)
    .stroke();
  y += rowH;

  // Row 2: INGRESO | REMITO | CANTIDAD
  const r2y = y;
  const cW = frameW / 3;
  drawCell(doc, frameX, r2y, cW, rowH, "INGRESO:", data.ingreso, {
    borderRight: true,
  });
  drawCell(doc, frameX + cW, r2y, cW, rowH, "Nº DE REMITO:", data.remitoNro, {
    borderRight: true,
    valueSize: 7.2,
  });
  drawCell(doc, frameX + 2 * cW, r2y, cW, rowH, "CANTIDAD:", data.cantidad);
  doc
    .moveTo(frameX, r2y + rowH)
    .lineTo(frameX + frameW, r2y + rowH)
    .lineWidth(0.5)
    .stroke();
  y += rowH;

  // Row 3: PROVEEDOR
  const r3y = y;
  drawCell(doc, frameX, r3y, frameW, rowH, "PROVEEDOR:", data.proveedor, {
    valueSize: 8,
  });
  doc
    .moveTo(frameX, r3y + rowH)
    .lineTo(frameX + frameW, r3y + rowH)
    .lineWidth(0.5)
    .stroke();
  y += rowH;

  // Row 4: BULTOS | LOTE
  const r4y = y;
  const half = frameW / 2;
  drawCell(doc, frameX, r4y, half, rowH, "Nº DE BULTOS:", data.bultos, {
    borderRight: true,
  });
  drawCell(
    doc,
    frameX + half,
    r4y,
    half,
    rowH,
    "Nº DE LOTE PROVEEDOR:",
    data.loteProveedor,
    { valueSize: 7.2 }
  );

  // Footer fuera del marco, dentro de la página
  doc
    .font("Helvetica")
    .fontSize(4.2)
    .fillColor("#000000")
    .text("FORM. APROBADO MATERIA PRIMA", mx, H - footerH + 0.5, {
      width: frameW,
      align: "center",
      lineBreak: false,
    });

  doc.restore();
}

/**
 * Asegura cajas de página idénticas y Rotate=0 (HereLabel / SP320).
 */
export async function normalizeMpLabelPdfBoxes(pdfBytes: Buffer): Promise<Buffer> {
  const W = MP_LABEL_WIDTH_PT;
  const H = MP_LABEL_HEIGHT_PT;
  const pdf = await PdfLibDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  if (pages.length !== 1) {
    throw new Error(`La etiqueta debe tener exactamente 1 página (tiene ${pages.length}).`);
  }
  const page = pages[0];
  page.setSize(W, H);
  page.setMediaBox(0, 0, W, H);
  page.setCropBox(0, 0, W, H);
  page.setTrimBox(0, 0, W, H);
  page.setBleedBox(0, 0, W, H);
  page.setRotation(degrees(0));
  const out = await pdf.save({ useObjectStreams: false });
  return Buffer.from(out);
}

/** Inspección estructural mínima del PDF de etiqueta. */
export function inspectMpLabelPdfStructure(pdfBytes: Buffer): {
  pages: number;
  mediaBox: string | null;
  cropBox: string | null;
  trimBox: string | null;
  bleedBox: string | null;
  rotate: string | null;
} {
  const text = pdfBytes.toString("latin1");
  const pages = (text.match(/\/Type\s*\/Page(?![sA-Za-z])/g) || []).length;
  const pick = (key: string) => {
    const m = text.match(new RegExp(`/${key}\\s*(\\[[^\\]]+\\]|\\d+)`));
    return m ? m[0].replace(/^\//, "") : null;
  };
  return {
    pages,
    mediaBox: pick("MediaBox"),
    cropBox: pick("CropBox"),
    trimBox: pick("TrimBox"),
    bleedBox: pick("BleedBox"),
    rotate: pick("Rotate"),
  };
}

export async function buildMpAprobadoLabelPdfBufferPdfKit(
  data: MpAprobadoLabelData
): Promise<Buffer> {
  const W = MP_LABEL_WIDTH_PT;
  const H = MP_LABEL_HEIGHT_PT;
  const doc = new PDFDocument({
    size: [W, H],
    margin: 0,
    autoFirstPage: true,
    compress: true,
    info: {
      Title: `APROBADO MATERIA PRIMA — ${data.producto || data.sourceId}`,
      Author: "Laboratorio Genus",
      Subject: "Etiqueta HereLabel 75x50 mm",
      Creator: "Genus OS",
    },
  });
  const done = collectPdf(doc);
  drawLabel(doc, data);
  // Nunca agregar segunda página
  doc.end();
  const raw = await done;
  return normalizeMpLabelPdfBoxes(raw);
}
