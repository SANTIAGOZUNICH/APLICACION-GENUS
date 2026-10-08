import "server-only";

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import type { SheetGridGateway } from "@/lib/asignacion-lotes/writeback-gateway";
import { a1Of, parseA1, type SheetCellFormat, type SheetFormats, type SheetMerge } from "./calendar-model";
import { FORMAT_MAX_COL } from "./sheet-formats";

/**
 * Gateway de DESARROLLO/TEST: sirve una copia local .xlsx como si fuera la
 * Sheet (valores formateados, combinadas, fórmulas) y acepta escrituras SOLO en
 * memoria — jamás modifica el archivo ni toca Google. Se activa únicamente con
 * GENUS_SEMANAS_FIXTURE_XLSX y nunca en producción.
 */
export class XlsxFixtureGateway implements SheetGridGateway {
  private grids = new Map<string, string[][]>();
  private merges = new Map<string, SheetMerge[]>();
  private formulas = new Map<string, Set<string>>();
  private formats = new Map<string, SheetFormats>();
  readonly writes: Array<{ tab: string; a1: string; value: string }> = [];

  /** `source` = ruta de un .xlsx local o los bytes del libro (carga de Preview). */
  constructor(source: string | Uint8Array) {
    const wb = XLSX.read(typeof source === "string" ? readFileSync(source) : Buffer.from(source), { type: "buffer", cellDates: true, cellStyles: true });
    for (const tab of wb.SheetNames) {
      const ws = wb.Sheets[tab]!;
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const rows: string[][] = [];
      const f = new Set<string>();
      for (let r = 0; r <= range.e.r; r += 1) {
        const row: string[] = [];
        for (let c = 0; c <= range.e.c; c += 1) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = ws[addr];
          if (cell?.f) f.add(addr);
          row.push(
            !cell
              ? ""
              : cell.v instanceof Date
                ? `${String(cell.v.getUTCDate()).padStart(2, "0")}/${String(cell.v.getUTCMonth() + 1).padStart(2, "0")}/${cell.v.getUTCFullYear()}`
                : String(cell.v ?? "")
          );
        }
        rows.push(row);
      }
      const fmt: SheetFormats = { colWidths: (ws["!cols"] ?? []).map((c) => c?.wpx ?? 0), hiddenRows: [], rowHeights: {}, cells: {} };
      (ws["!rows"] ?? []).forEach((r, i) => {
        if (r?.hidden) fmt.hiddenRows.push(i + 1);
        else if (r?.hpt && Math.abs(r.hpt * (96 / 72) - 21) > 2) fmt.rowHeights![i + 1] = Math.round(r.hpt * (96 / 72));
      });
      for (let r = 0; r <= range.e.r; r += 1) {
        for (let c = 0; c <= Math.min(range.e.c, FORMAT_MAX_COL - 1); c += 1) {
          const st = ws[XLSX.utils.encode_cell({ r, c })]?.s as { fgColor?: { rgb?: string }; patternType?: string; bold?: boolean; color?: { rgb?: string } } | undefined;
          if (!st) continue;
          const f: SheetCellFormat = {};
          const bg = st.patternType === "solid" ? st.fgColor?.rgb?.toUpperCase() : undefined;
          if (bg && bg.length >= 6 && bg.slice(-6) !== "FFFFFF") f.bg = `#${bg.slice(-6)}`;
          const fg = st.color?.rgb?.toUpperCase();
          if (fg && fg.length >= 6 && fg.slice(-6) !== "000000") f.fg = `#${fg.slice(-6)}`;
          if (st.bold) f.bold = true;
          if (Object.keys(f).length) fmt.cells[a1Of(r + 1, c)] = f;
        }
      }
      this.formats.set(tab, fmt);
      this.grids.set(tab, rows);
      this.formulas.set(tab, f);
      this.merges.set(
        tab,
        (ws["!merges"] ?? []).map((m) => ({ startRow: m.s.r + 1, endRow: m.e.r + 1, startColumn: m.s.c + 1, endColumn: m.e.c + 1 }))
      );
    }
  }

  private grid(tab: string): string[][] {
    const g = this.grids.get(tab);
    if (!g) throw new Error(`Pestaña "${tab}" inexistente.`);
    return g;
  }
  async readTab(_s: string, tab: string) { return this.grid(tab).map((r) => [...r]); }
  async readCell(_s: string, tab: string, a1: string) {
    const p = parseA1(a1)!;
    return this.grid(tab)[p.row - 1]?.[p.col] ?? "";
  }
  async readFormula(_s: string, tab: string, a1: string) { return this.formulas.get(tab)?.has(a1) ? "=…" : null; }
  async writeCell(_s: string, tab: string, a1: string, value: string) {
    const p = parseA1(a1)!;
    const g = this.grid(tab);
    while (g.length < p.row) g.push([]);
    const row = g[p.row - 1]!;
    while (row.length <= p.col) row.push("");
    row[p.col] = value;
    this.writes.push({ tab, a1, value });
  }
  async readFormats(_s: string, tab: string) { return this.formats.get(tab) ?? { colWidths: [], hiddenRows: [], cells: {} }; }
  async readMerges(_s: string, tab: string) { return this.merges.get(tab) ?? []; }
  async readFormulaCells(_s: string, tab: string) { return new Set(this.formulas.get(tab) ?? []); }
}
