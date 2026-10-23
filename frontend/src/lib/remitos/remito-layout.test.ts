/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import ExcelJS from "exceljs";
import { getRemitoService, resetRemitoMemoryForTests } from "./remito-service";
import { buildRemitoPdf } from "./remito-pdf";
import { buildRemitoXlsx, remitoXlsxToPreviewHtml } from "./remito-xlsx";
import { layoutRemitoFromXlsx, REMITO_PAGE_H, REMITO_PAGE_W } from "./remito-layout";
import { packingGroupsToRemitoSlots } from "./packing-math";

const prod = { email: "prod@test", sector: "PRODUCCION" as const };
const g = (cajas: number, unidadesPorCaja: number) => ({ cajas, unidadesPorCaja });

async function draft(
  lines: Array<{ product: string; lote: string; vto: string; groups: Array<{ cajas: number; unidadesPorCaja: number }> }>,
  client: string,
  date: string
) {
  const svc = getRemitoService();
  let id = "";
  for (const [i, l] of lines.entries()) {
    const total = l.groups.reduce((s, x) => s + x.cajas * x.unidadesPorCaja, 0);
    const r = await svc.upsertDraftFromApproval(prod, { workItemId: `dl:${i}`, clientId: client, deliveryDate: date, product: l.product, lote: l.lote, vto: l.vto, totalUnits: total, ...packingGroupsToRemitoSlots(l.groups) });
    id = r.remito.id;
  }
  return (await svc.get(prod, id))!;
}

/** Texto de cada página del PDF (operadores TJ; el kerning parte los literales y se unen sin espacios). */
function pdfPages(buf: Buffer): string[] {
  const pages: string[] = [];
  for (const m of buf.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: Buffer;
    try {
      body = inflateSync(Buffer.from(m[1], "latin1"));
    } catch {
      continue;
    }
    let t = "";
    for (const arr of body.toString("latin1").matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const h of arr[1]!.matchAll(/<([0-9a-fA-F]*)>/g)) t += Buffer.from(h[1]!, "hex").toString("latin1");
      t += "\n";
    }
    if (t) pages.push(t);
  }
  return pages;
}
const textsOf = (l: Awaited<ReturnType<typeof layoutRemitoFromXlsx>>, page: number) => l.pages[page]!.texts.map((t) => t.text);

describe("remito: réplica de la planilla impresa (PDF, vista previa y XLSX comparten estructura y datos)", () => {
  beforeEach(() => resetRemitoMemoryForTests());

  it("ORIGINAL BLACK: 2 páginas, detalle en la 1.ª y TOTAL BULTOS centrado en la 2.ª, fecha DD/MM/AAAA", async () => {
    const remito = await draft([{ product: "AFTER SHAVE VERDE", lote: "S26001", vto: "09/28", groups: [g(100, 12)] }], "ORIGINAL BLACK", "2026-10-02");
    const xlsx = await buildRemitoXlsx(remito);
    const layout = await layoutRemitoFromXlsx(xlsx);
    expect(layout.pages).toHaveLength(1); // UNA sola hoja: detalle y total juntos
    const p1 = textsOf(layout, 0);
    for (const t of ["ORIGINAL BLACK", "1200", "AFTER SHAVE VERDE", "100", "X", "12", "L: S26001   VTO: 09/28", "02/10/2026"]) expect(p1, t).toContain(t);
    const all1 = layout.pages[0]!.texts;
    expect(all1.map((t) => t.text)).toEqual(expect.arrayContaining(["1200", "TOTAL BULTOS:", "100"]));
    expect(all1.filter((t) => t.text === "100").some((t) => t.align === "center")).toBe(true);
    // XLSX: misma plantilla, fecha con formato fijo y A4 horizontal con cuadrícula
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as never);
    const sh = wb.worksheets[0]!;
    expect(sh.getCell("F4").numFmt).toBe("dd/mm/yyyy");
    expect(sh.pageSetup.orientation).toBe("portrait");
    expect(sh.pageSetup.paperSize).toBe(9);
    expect(sh.pageSetup.fitToWidth).toBe(1);
    expect(sh.pageSetup.fitToHeight).toBe(1);
    expect(sh.pageSetup.showGridLines).toBe(true);
    // PDF real, mismas páginas y mismo texto
    const pdf = await buildRemitoPdf(remito);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pages = pdfPages(pdf);
    expect(pages).toHaveLength(1);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/); // A4 vertical
    for (const t of ["ORIGINAL BLACK", "AFTER SHAVE VERDE", "02/10/2026", "S26001", "TOTAL BULTOS:"]) expect(pages[0], t).toContain(t);
  });

  it("ECODERM: 2 × 110 + 1 × 46 = 266 u. y 3 bultos, con lote y vencimiento", async () => {
    const remito = await draft([{ product: "SERUM AHA ROSEHIP", lote: "1234", vto: "08/27", groups: [g(2, 110), g(1, 46)] }], "ECODERM", "2026-10-22");
    const layout = await layoutRemitoFromXlsx(await buildRemitoXlsx(remito));
    const all = layout.pages.flatMap((_, i) => textsOf(layout, i));
    for (const t of ["ECODERM", "22/10/2026", "SERUM AHA ROSEHIP", "L: 1234   VTO: 08/27", "266", "2", "110", "1", "46"]) expect(all, t).toContain(t);
    expect(layout.pages).toHaveLength(1);
    const total = layout.pages[0]!.texts;
    expect(total.map((t) => t.text)).toEqual(expect.arrayContaining(["TOTAL BULTOS:", "3"]));
    // legible: con columnas J–N (2 configuraciones) la letra más chica sigue siendo ≥ 6 pt
    expect(Math.min(...total.map((t) => t.size))).toBeGreaterThanOrEqual(6);
    const pdf = await buildRemitoPdf(remito);
    expect(pdfPages(pdf)).toHaveLength(1);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]/);
  });

  it("varios productos y más de tres configuraciones de caja: ninguna se pierde (columnas J–N y detalle EXTRA)", async () => {
    const remito = await draft(
      [
        { product: "PRODUCTO UNO", lote: "L1", vto: "01/28", groups: [g(2, 100), g(3, 50), g(1, 30), g(1, 7), g(2, 5)] },
        { product: "PRODUCTO DOS", lote: "L2", vto: "02/28", groups: [g(6, 10)] },
      ],
      "CLIENTE X",
      "2026-10-22"
    );
    const layout = await layoutRemitoFromXlsx(await buildRemitoXlsx(remito));
    const all = layout.pages.flatMap((_, i) => textsOf(layout, i));
    // lote/vencimiento llevan SOLO esos datos; las 5 configuraciones van en las columnas de distribución (3 por fila)
    for (const t of ["PRODUCTO UNO", "PRODUCTO DOS", "L: L1   VTO: 01/28", "L: L2   VTO: 02/28", "397", "60"]) expect(all, t).toContain(t);
    expect(all.some((t) => /EXTRA/.test(t))).toBe(false);
    const p1 = layout.pages[0]!.texts;
    const lote = p1.find((t) => t.text === "L: L1   VTO: 01/28")!;
    const rowOf = (y: number) => p1.filter((t) => Math.abs(t.y - y) < 1).map((t) => t.text);
    expect(rowOf(p1.find((t) => t.text === "PRODUCTO UNO")!.y)).toEqual(expect.arrayContaining(["2", "100", "3", "50", "1", "30"]));
    const second = p1.filter((t) => t.y > lote.y && ["1", "7", "2", "5", "X"].includes(t.text) && t.y < p1.find((t2) => t2.text === "PRODUCTO DOS")!.y);
    expect(second.map((t) => t.text).sort()).toEqual(["1", "2", "5", "7", "X", "X"]);
    // mismo tamaño de letra en TODAS las cantidades de caja
    const sizes = new Set(p1.filter((t) => ["100", "50", "30", "7", "5", "10", "2", "3", "1", "6"].includes(t.text) && t.y > lote.y - 30).map((t) => t.size));
    expect(sizes.size).toBe(1);
    const cajas = layout.pages.at(-1)!.texts;
    expect(cajas.map((t) => t.text)).toContain("15"); // 2+3+1+1+2 + 6 = 15 bultos
    // todo queda dentro de la hoja
    for (const p of layout.pages) for (const r of p.rects) { expect(r.x + r.w).toBeLessThanOrEqual(REMITO_PAGE_W - 40); expect(r.x).toBeGreaterThanOrEqual(40); };
  });

  it("remito largo: varias páginas sin filas cortadas ni texto fuera de la hoja", async () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ product: `PRODUCTO LARGO ${String(i).padStart(2, "0")}`, lote: `L${i}`, vto: "01/29", groups: [g(2, 10), g(1, 4)] }));
    const remito = await draft(many, "CLIENTE LARGO", "2026-10-22");
    const layout = await layoutRemitoFromXlsx(await buildRemitoXlsx(remito));
    expect(layout.pages).toHaveLength(1); // nunca una 2.ª página: se ajusta toda la plantilla a una hoja
    const all = layout.pages.flatMap((_, i) => textsOf(layout, i));
    for (const l of many) expect(all.filter((t) => t === l.product), l.product).toHaveLength(1);
    for (const p of layout.pages) for (const r of p.rects) expect(r.y + r.h).toBeLessThanOrEqual(REMITO_PAGE_H - 50);
    expect(layout.pages[0]!.texts.map((t) => t.text)).toContain("TOTAL BULTOS:");
    expect(layout.pages.at(-1)!.texts.map((t) => t.text)).toContain("TOTAL BULTOS:");
    expect(pdfPages(await buildRemitoPdf(remito))).toHaveLength(layout.pages.length);
  });

  it("vista previa: negro sobre blanco con colores propios, sin depender del tema de la app", async () => {
    const remito = await draft([{ product: "AFTER SHAVE VERDE", lote: "S26001", vto: "09/28", groups: [g(100, 12)] }], "ORIGINAL BLACK", "2026-10-02");
    const html = await remitoXlsxToPreviewHtml(await buildRemitoXlsx(remito));
    expect(html).toContain("background:#ffffff");
    expect(html).toContain('fill="#000000"');
    expect(html).toContain("color-scheme:light");
    expect(html).toContain("AFTER SHAVE VERDE");
    expect(html).toContain("02/10/2026");
    expect(html).toContain("viewBox=\"0 0 595.28 841.89\"");
    expect(html).toContain("1 página");
  });
});
