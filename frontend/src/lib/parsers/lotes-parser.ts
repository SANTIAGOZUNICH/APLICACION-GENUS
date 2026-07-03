import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { WorkItemAssembler } from "@/lib/domain/work-item/work-item-assembler";
import type { WorkItemRegistry } from "@/lib/domain/work-item/work-item-registry";

export interface LotesParserInput {
  fileId: string;
  tab: string;
  rows: string[][];
  registry: WorkItemRegistry;
  assembler: WorkItemAssembler;
}

export interface LotesParserResult {
  enriched: number;
  warnings: string[];
}

const MONTH_TABS = new Set([
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]);

export function isLoteMonthTab(tab: string): boolean {
  return MONTH_TABS.has(tab.trim().toUpperCase());
}

function inferEstadoCalidad(record: Record<string, string>): string {
  const rl = pickField(record, "rl", "reg_lib");
  const oe = pickField(record, "oe");
  const oa = pickField(record, "oa");
  const analisis = pickField(record, "fecha_analisis", "fecha_análisis", "n°_analisis");

  if (rl && rl !== "----" && rl.toLowerCase() !== "n/a") return "aprobado";
  if (oe || oa) return "en_proceso";
  if (analisis && analisis.toLowerCase() !== "n/a") return "en_analisis";
  return "pendiente_analisis";
}

function parseLoteRecord(record: Record<string, string>, input: LotesParserInput): boolean {
  const productoCol = pickField(record, "producto", "descripcion");
  if (productoCol.toUpperCase().includes("AGUA DEL SECTOR DE ELABORACION")) {
    return false;
  }

  const lote = pickField(
    record,
    "n°_lote",
    "n_lote",
    "nº_lote",
    "lote",
    "nro_lote",
    "numero_lote"
  );

  if (!lote || !/^[A-Z]\d/i.test(lote)) return false;

  const loteRef = lote.trim().toUpperCase();
  const cliente = pickField(record, "marca", "cliente") || null;
  const producto = pickField(record, "producto", "descripcion") || null;

  input.assembler.apply(
    input.registry,
    { loteRef, client: cliente, product: producto },
    {
      loteRef,
      client: cliente,
      product: producto,
      quantity: pickField(record, "cantidad", "cantidades") || null,
      oeRef: pickField(record, "oe") || null,
      oaRef: pickField(record, "oa") || null,
      rl: pickField(record, "rl", "reg_lib") || null,
      fechaAnalisis: pickField(record, "fecha_analisis", "fecha_análisis") || null,
      numeroAnalisis: pickField(record, "n°_analisis", "n_analisis", "nº_analisis") || null,
      observacionCalidad: pickField(record, "observacion", "observaciones") || null,
      estadoCalidad: inferEstadoCalidad(record),
      sector: "CALIDAD",
      ownerSector: "CALIDAD",
      originStage: "CALIDAD",
      dayLabel: input.tab,
    },
    "asignacion_lotes_2026",
    { fileId: input.fileId, range: `${input.tab}!${loteRef}` }
  );

  return true;
}

function rowsToRecordsFromHeader(rows: string[][], headerRowIndex: number): Record<string, string>[] {
  if (rows.length <= headerRowIndex + 1) return [];

  const headers = rows[headerRowIndex].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.some((cell) => cell.trim())) continue;

    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      const key = header
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w]+/g, "_")
        .replace(/^_|_$/g, "");
      if (key) record[key] = row[index]?.trim() ?? "";
    });
    records.push(record);
  }

  return records;
}

function findLoteHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const joined = rows[i]?.map((c) => c.trim().toLowerCase()).join(" ") ?? "";
    if (joined.includes("lote") && (joined.includes("producto") || joined.includes("fecha"))) {
      return i;
    }
  }
  return 1;
}

/** LotesParser — pestañas mensuales ASIGNACIÓN DE LOTES 2026. */
export function parseLotesTab(input: LotesParserInput): LotesParserResult {
  const warnings: string[] = [];
  let enriched = 0;

  const headerRow = findLoteHeaderRow(input.rows);
  const records = rowsToRecordsFromHeader(input.rows, headerRow);

  for (const record of records) {
    if (parseLoteRecord(record, input)) enriched += 1;
  }

  if (enriched === 0) {
    warnings.push(`${input.tab}: LotesParser sin lotes productivos.`);
  }

  return { enriched, warnings };
}
