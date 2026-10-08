import "server-only";

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import type { SheetGridGateway } from "@/lib/asignacion-lotes/writeback-gateway";
import { parseA1, type SheetMerge } from "./calendar-model";

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
  readonly writes: Array<{ tab: string; a1: string; value: string }> = [];

  constructor(file: string) {
    const wb = XLSX.read(readFileSync(file), { type: "buffer", cellDates: true });
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
  async readMerges(_s: string, tab: string) { return this.merges.get(tab) ?? []; }
  async readFormulaCells(_s: string, tab: string) { return new Set(this.formulas.get(tab) ?? []); }
}
