import ExcelJS from "exceljs";
import type { OeContent, OperationalOrderRecord } from "@/lib/orders/types";

/** Export editable OE (.xlsx) — no muta la orden guardada. */
export async function buildOeXlsxBuffer(order: OperationalOrderRecord): Promise<Buffer> {
  if (order.formData.kind !== "OE") {
    throw new Error("Solo OE se exporta a xlsx.");
  }
  const c = order.formData as OeContent;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("OE");
  ws.getCell("D1").value = "OE";
  ws.getCell("F1").value = "PT";
  ws.getCell("B6").value = c.header.productName;
  ws.getCell("C6").value = "Código";
  ws.getCell("D6").value = "Fecha";
  ws.getCell("E6").value = "Cant. Kg";
  ws.getCell("F6").value = "N° de Lote";
  ws.getCell("G6").value = "VIGENCIA";
  ws.getCell("C7").value = c.header.code;
  ws.getCell("D7").value = c.header.date;
  ws.getCell("E7").value = c.header.quantityKg;
  ws.getCell("F7").value = c.header.lot;
  ws.getCell("G7").value = c.header.vigencia;
  ws.getCell("B8").value = `Cliente: ${c.header.client}`;
  ws.getCell("D8").value = `Equipo calefactor N°: ${c.header.equipoCalefactor}`;
  ws.getCell("B9").value = `Envase cubica: ${c.header.envaseCubica}`;
  const headers = ["MATERIA PRIMA", "CÓDIGO", "Fórmula %", "kg a pesar", "AJUSTE", "LOTE Nº"];
  headers.forEach((h, i) => {
    ws.getCell(12, i + 2).value = h;
  });
  c.materials.forEach((m, idx) => {
    const row = 13 + idx;
    ws.getCell(row, 2).value = m.materiaPrima;
    ws.getCell(row, 3).value = m.codigo;
    ws.getCell(row, 4).value = m.formulaPct;
    ws.getCell(row, 5).value = m.kgAPesar;
    ws.getCell(row, 6).value = m.ajuste;
    ws.getCell(row, 7).value = m.lote;
  });
  const totalRow = 13 + c.materials.length;
  ws.getCell(totalRow, 2).value = "Total expresado en kg";
  ws.getCell(totalRow, 4).value = c.totals.formulaPctSum;
  ws.getCell(totalRow, 5).value = c.totals.kgSum;
  ws.getCell(totalRow, 7).value = "Firma:";
  let procRow = totalRow + 4;
  ws.getCell(procRow, 2).value = "PROCEDIMIENTO DE ELABORACIÓN";
  c.procedureSteps.forEach((s) => {
    procRow += 1;
    ws.getCell(procRow, 2).value = s.text;
  });
  ws.getCell(procRow + 2, 2).value = "Firma Producción";
  ws.getCell(procRow + 2, 3).value = "Firma Control de Calidad";
  ws.getCell(procRow + 2, 6).value = "Firma Dirección Técnica";
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
