/**
 * HTML imprimible de las hojas de elaboración de una OE (una hoja, todas o el resumen general). Documento autónomo:
 * las descripciones largas de MP se imprimen COMPLETAS (la celda crece en alto; nada se corta ni usa «…»).
 */
import type { OeContent, OeSheet } from "@/lib/orders/types";
import { SHEET_KIND_LABEL, SHEET_STATUS_LABEL, sheetLabel, summarizeSheets } from "@/lib/orders/oe-sheets";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const kg = (n: number | null | undefined) => (n == null ? "—" : String(Number(n.toFixed(4))).replace(".", ","));

export const SHEETS_PRINT_CSS = `
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:16px}
h1{font-size:15px;margin:0 0 4px} h2{font-size:13px;margin:14px 0 4px;background:#e5e5e5;padding:2px 4px}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:8px}
th,td{border:1px solid #555;padding:3px 4px;text-align:left;vertical-align:top;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
th{background:#f0f0f0} td.num{text-align:right;font-variant-numeric:tabular-nums}
tr{page-break-inside:avoid} .sheet{page-break-after:always} .sheet:last-child{page-break-after:auto}
.meta span{margin-right:14px}`;

function header(c: OeContent) {
  return `<h1>OE ${esc(c.header.code)} — ${esc(c.header.productName)}</h1><p class="meta"><span>Cliente: ${esc(c.header.client)}</span><span>Lote: ${esc(c.header.lot)}</span><span>Cantidad OE: ${kg(c.header.quantityKg)} kg</span></p>`;
}
const MAT_HEAD = `<colgroup><col style="width:34%"><col style="width:10%"><col style="width:10%"><col style="width:7%"><col style="width:10%"><col style="width:10%"><col style="width:19%"></colgroup><thead><tr><th>Materia prima</th><th>Código</th><th>Código MP</th><th>%</th><th>Kg teórico</th><th>Kg real</th><th>Lote MP</th></tr></thead>`;

function sheetHtml(c: OeContent, s: OeSheet) {
  const rows = s.materials
    .map((m) => `<tr><td>${m.parentRowId ? "↳ lote adicional" : esc(m.materiaPrima)}</td><td>${esc(m.codigo)}</td><td>${esc(m.codigoMp)}</td><td class="num">${m.parentRowId ? "" : kg(m.formulaPct)}</td><td class="num">${m.parentRowId ? "" : kg(m.kgAPesar)}</td><td class="num">${kg(m.kgReal)}</td><td>${esc(m.lote)}</td></tr>`)
    .join("");
  return `<section class="sheet">${header(c)}<h2>${esc(sheetLabel(s))} (${esc(SHEET_KIND_LABEL[s.kind])}) — ${kg(s.kgPlanificados)} kg planificados · ${esc(SHEET_STATUS_LABEL[s.status])}</h2>
<p class="meta"><span>Responsable: ${esc(s.operario) || "—"}</span><span>Inicio: ${esc(s.inicioAt) || "—"}</span><span>Fin: ${esc(s.finAt) || "—"}</span><span>Kg elaborados: ${kg(s.kgElaborados)}</span></p>
<table>${MAT_HEAD}<tbody>${rows}</tbody></table>
<p><b>Incidencias:</b> ${esc(s.incidencias) || "—"}</p><p><b>Observaciones:</b> ${esc(s.observaciones) || "—"}</p></section>`;
}

function summaryHtml(c: OeContent) {
  const sm = summarizeSheets(c);
  const sheets = (c.sheets ?? []).map((s) => `<tr><td>${esc(sheetLabel(s))}</td><td class="num">${kg(s.kgPlanificados)}</td><td class="num">${kg(s.kgElaborados)}</td><td>${esc(SHEET_STATUS_LABEL[s.status])}</td><td>${esc(s.operario)}</td><td>${esc(s.incidencias)}</td></tr>`).join("");
  const cons = sm.consolidated.map((e) => `<tr><td>${esc(e.materiaPrima)}</td><td>${esc(e.codigoMp)}</td><td class="num">${kg(e.kgTeorico)}</td><td class="num">${kg(e.kgReal)}</td><td>${e.lots.map((l) => `${esc(l.lote)}: ${kg(l.kg)} kg`).join("<br>")}</td></tr>`).join("");
  return `<section class="sheet">${header(c)}<h2>RESUMEN GENERAL</h2>
<p>Total solicitado: <b>${kg(sm.requestedKg)} kg</b> · Planificado: <b>${kg(sm.plannedKg)} kg</b> · Elaborado: <b>${kg(sm.elaboratedKg)} kg</b> · Pendiente: <b>${kg(sm.pendingKg)} kg</b>${sm.exceedsKg ? ` · <b>EXCEDE en ${kg(sm.exceedsKg)} kg</b>` : ""}</p>
<table><thead><tr><th>Hoja</th><th>Kg plan.</th><th>Kg elab.</th><th>Estado</th><th>Responsable</th><th>Incidencias</th></tr></thead><tbody>${sheets}</tbody></table>
<h2>MATERIAS PRIMAS CONSOLIDADAS</h2><table><thead><tr><th>Materia prima</th><th>Código MP</th><th>Kg teórico</th><th>Kg real</th><th>Lotes</th></tr></thead><tbody>${cons}</tbody></table></section>`;
}

export function buildSheetsPrintHtml(content: OeContent, scope: "all" | "summary" | { sheetId: string }): string {
  const sheets = content.sheets ?? [];
  const body =
    scope === "summary"
      ? summaryHtml(content)
      : scope === "all"
        ? summaryHtml(content) + sheets.map((s) => sheetHtml(content, s)).join("")
        : sheets.filter((s) => s.id === scope.sheetId).map((s) => sheetHtml(content, s)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>OE ${esc(content.header.code)}</title><style>${SHEETS_PRINT_CSS}</style></head><body>${body}</body></html>`;
}
