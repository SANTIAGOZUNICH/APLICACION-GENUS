#!/usr/bin/env node
/**
 * Diagnóstico: WorkItems de envasado sin línea.
 * Usa API preview si BASE_URL está configurado, o parser local sobre SEMANAS 2026.xlsx.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkItemRegistry } from "../src/lib/domain/work-item/work-item-registry.js";
import { workItemAssembler } from "../src/lib/domain/work-item/work-item-assembler.js";
import { projectDomainWorkItems } from "../src/lib/domain/work-item/work-item-projector.js";
import { parsePlannerTab } from "../src/lib/parsers/planner/planner-parser.js";
import {
  detectLineHeader,
  detectPackagingSectorHeader,
  extractDayColumns,
  isWeekAnchorRow,
  normalizeCellText,
  normalizeKey,
} from "../src/lib/parsers/planner/planner-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const XLSX_PATH = join(ROOT, "SEMANAS 2026.xlsx");

const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ?? "";

function headers(extra = {}) {
  const h = { Accept: "application/json", ...extra };
  if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
  return h;
}

async function fetchWorkItems(sector) {
  const res = await fetch(`${BASE}/api/v1/work-items?sector=${sector}`, { headers: headers() });
  const body = await res.json();
  return body.workItems ?? [];
}

function parseSourceRange(range) {
  if (!range) return null;
  const m = range.match(/^([^!]+)!(\d+):(\d+)$/);
  if (!m) return { raw: range };
  return { sheet: m[1], row: Number(m[2]), col: Number(m[3]) };
}

async function loadLocalAcondicionamientoRows() {
  const { execSync } = await import("node:child_process");
  const script = `
import json, openpyxl
wb = openpyxl.load_workbook("${XLSX_PATH.replace(/\\/g, "/")}", data_only=True, read_only=True)
ws = wb["ACONDICIONAMIENTO"]
rows = []
for row in ws.iter_rows(values_only=True):
    rows.append([str(c) if c is not None else "" for c in row])
print(json.dumps(rows))
`;
  const out = execSync(`python3 -c ${JSON.stringify(script)}`, { maxBuffer: 50 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function buildRowContext(rows, targetRow, targetCol) {
  const ctx = {
    sectorHeader: null,
    sectorHeaderRow: null,
    lineHeader: null,
    lineHeaderRow: null,
    weekLabel: null,
    dayLabel: null,
    nearby: [],
  };

  let currentSector = null;
  let currentLine = null;
  let dayColumns = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNum = i + 1;

    if (isWeekAnchorRow(row)) {
      dayColumns = extractDayColumns(row);
      ctx.weekLabel = `fila ${rowNum}`;
      continue;
    }

    const packaging = detectPackagingSectorHeader(row);
    if (packaging) {
      currentSector = packaging;
      const line = detectLineHeader(row);
      if (line) {
        currentLine = line;
        if (rowNum <= targetRow) {
          ctx.sectorHeader = row.filter((c) => c.trim()).join(" | ");
          ctx.sectorHeaderRow = rowNum;
          ctx.lineHeader = line;
          ctx.lineHeaderRow = rowNum;
        }
      } else if (rowNum <= targetRow) {
        ctx.sectorHeader = row.filter((c) => c.trim()).join(" | ");
        ctx.sectorHeaderRow = rowNum;
      }
      continue;
    }

    const line = detectLineHeader(row);
    if (line) {
      currentLine = line;
      if (rowNum <= targetRow) {
        ctx.lineHeader = line;
        ctx.lineHeaderRow = rowNum;
      }
      continue;
    }

    if (rowNum === targetRow) {
      for (const [colIdx, day] of dayColumns) {
        if (colIdx + 1 === targetCol) ctx.dayLabel = day;
      }
      for (let c = 0; c < row.length; c++) {
        const cell = normalizeCellText(row[c] ?? "");
        if (cell) ctx.nearby.push(`${colLetter(c + 1)}${rowNum}=${cell.slice(0, 40)}`);
      }
      for (let back = 1; back <= 5; back++) {
        const prev = rows[i - back];
        if (!prev) break;
        const cells = prev.map((c, ci) => (c.trim() ? `${colLetter(ci + 1)}=${c.trim().slice(0, 30)}` : null)).filter(Boolean);
        if (cells.length) ctx.nearby.unshift(`fila${rowNum - back}: ${cells.slice(0, 4).join(", ")}`);
      }
    }
  }

  ctx.activeSectorAtRow = currentSector;
  ctx.activeLineAtRow = currentLine;
  return ctx;
}

function diagnoseLocal(rows, items) {
  const missing = items.filter(
    (i) =>
      (i.sector === "ENVASADO_MASIVO" || i.sector === "ENVASADO_PREMIUM") && !i.line
  );

  const samples = [];
  const masivo = missing.filter((i) => i.sector === "ENVASADO_MASIVO");
  const premium = missing.filter((i) => i.sector === "ENVASADO_PREMIUM");

  const pick = (arr, n) => {
    if (arr.length <= n) return arr;
    const step = Math.floor(arr.length / n);
    return Array.from({ length: n }, (_, i) => arr[Math.min(i * step, arr.length - 1)]);
  };

  const selected = [
    ...pick(masivo, 12),
    ...pick(premium, 8),
  ].slice(0, 25);

  for (const item of selected) {
    const loc = parseSourceRange(item.sourceRange);
    const ctx = loc?.row
      ? buildRowContext(rows, loc.row, loc.col ?? 1)
      : { nearby: [] };

    samples.push({
      sector: item.sector,
      product: item.product ?? item.plannedProduct ?? "—",
      sourceRange: item.sourceRange,
      tab: item.sourceSheet ?? loc?.sheet,
      row: loc?.row,
      col: loc?.col ? colLetter(loc.col) : null,
      weekLabel: item.weekLabel ?? ctx.weekLabel,
      sectorHeader: ctx.sectorHeader,
      sectorHeaderRow: ctx.sectorHeaderRow,
      lineHeader: ctx.lineHeader,
      lineHeaderRow: ctx.lineHeaderRow,
      activeLineAtRow: ctx.activeLineAtRow,
      dayLabel: item.dayLabel ?? ctx.dayLabel,
      nearby: ctx.nearby?.slice(0, 6),
      parserWouldDetectLine: ctx.lineHeader ?? ctx.activeLineAtRow,
    });
  }

  return { missing: missing.length, masivo: masivo.length, premium: premium.length, samples };
}

async function main() {
  let items = [];
  let rows = null;

  if (BASE) {
    const masivo = await fetchWorkItems("ENVASADO_MASIVO");
    const premium = await fetchWorkItems("ENVASADO_PREMIUM");
    items = [...masivo, ...premium];
    console.log(`API: ${masivo.length} Masivo + ${premium.length} Premium`);
  }

  if (existsSync(XLSX_PATH)) {
    console.log(`Parseando local: ${XLSX_PATH}`);
    rows = await loadLocalAcondicionamientoRows();
    const registry = createWorkItemRegistry();
    parsePlannerTab({
      fileId: "local-semanas",
      tab: "ACONDICIONAMIENTO",
      rows,
      registry,
      assembler: workItemAssembler,
    });
    const localItems = projectDomainWorkItems(registry.list());
    if (!items.length) items = localItems;
    console.log(`Local parser: ${localItems.length} items ACONDICIONAMIENTO`);
  }

  if (!rows && existsSync(XLSX_PATH)) {
    rows = await loadLocalAcondicionamientoRows();
  }

  const diag = diagnoseLocal(rows ?? [], items);

  console.log(`\nSin línea: ${diag.missing} (Masivo=${diag.masivo}, Premium=${diag.premium})\n`);
  console.log("| # | Sector | sourceRange | sectorHeader | lineHeader | activeLine | producto |");
  console.log("|---|--------|-------------|--------------|------------|------------|----------|");

  diag.samples.forEach((s, i) => {
    console.log(
      `| ${i + 1} | ${s.sector} | ${s.sourceRange} | r${s.sectorHeaderRow ?? "?"} ${(s.sectorHeader ?? "—").slice(0, 30)} | r${s.lineHeaderRow ?? "?"} ${s.lineHeader ?? "—"} | ${s.activeLineAtRow ?? "null"} | ${(s.product ?? "—").slice(0, 25)} |`
    );
  });

  console.log("\n## Detalle muestra (primeros 5)\n");
  diag.samples.slice(0, 5).forEach((s, i) => {
    console.log(`### Caso ${i + 1}`);
    console.log(JSON.stringify(s, null, 2));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
