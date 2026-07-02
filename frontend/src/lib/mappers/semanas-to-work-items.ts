import "server-only";

import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { DocumentRef } from "@/lib/adapters/drive/types/document.types";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import {
  detectSemanasBlocks,
  extractBlockHeaders,
  inferLineFromRecord,
  inferPriorityFromRecord,
  isMeaningfulSemanasRow,
  mapPriorityLabel,
  recordFromSemanasRow,
} from "@/lib/mappers/semanas-block-parser";
import { detectHeaderRows, extractSampleDataRows } from "@/lib/discovery/schema-analyzer";
import type { OriginStage, WorkItem, WorkItemConfidence } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import type {
  SemanasBlockKind,
  SemanasDiscoveryResponse,
  SemanasTabDiscovery,
} from "@/types/discovery/semanas-discovery.types";

const TAB_CANDIDATES = [
  process.env.SHEETS_TAB_SEMANAS?.trim(),
  "SEMANAS",
  "Semanas",
  "PLAN",
  "Hoja 1",
].filter(Boolean) as string[];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function stageForBlock(kind: SemanasBlockKind): OriginStage {
  switch (kind) {
    case "DESARROLLO":
      return "DESARROLLO";
    case "ELABORACION":
      return "ELABORACION";
    case "ACONDICIONAMIENTO":
      return "ACONDICIONAMIENTO";
    case "ENTREGAS":
      return "DESPACHO";
    default:
      return "PLANIFICACION";
  }
}

function sectorForBlock(
  kind: SemanasBlockKind,
  record: Record<string, string>,
  line: string | null
): { sector: SectorId | null; confidence: WorkItemConfidence } {
  const lineText = normalizeLine(line ?? inferLineFromRecord(record));

  switch (kind) {
    case "ELABORACION":
      return { sector: "ELABORACION", confidence: "high" };
    case "ACONDICIONAMIENTO":
      if (lineText.includes("premium")) {
        return { sector: "ENVASADO_PREMIUM", confidence: "high" };
      }
      if (lineText.includes("masivo") || lineText.includes("consumo")) {
        return { sector: "ENVASADO_MASIVO", confidence: "high" };
      }
      return { sector: null, confidence: "low" };
    case "ENTREGAS":
      return { sector: "DEPOSITO", confidence: "medium" };
    case "DESARROLLO":
      return { sector: "PRODUCCION", confidence: "medium" };
    default:
      return { sector: null, confidence: "low" };
  }
}

function normalizeLine(value: string | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildWorkItemId(
  fileId: string,
  tab: string,
  rowNumber: number,
  product: string | null
): string {
  return `semanas:${fileId}:${slugify(tab)}:row-${rowNumber}:${slugify(product ?? "item")}`;
}

function fieldConfidence(hasValue: boolean, total: number, mapped: number): WorkItemConfidence {
  if (!hasValue) return "low";
  const ratio = total > 0 ? mapped / total : 0;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.25) return "medium";
  return "low";
}

export interface SemanasMapperResult {
  workItems: WorkItem[];
  warnings: string[];
}

/** F8.1 — SEMANAS 2026 → WorkItem[] (no Cards, no invented fields). */
export function semanasRowsToWorkItems(input: {
  fileId: string;
  tab: string;
  rows: string[][];
  blocks: ReturnType<typeof detectSemanasBlocks>;
}): SemanasMapperResult {
  const workItems: WorkItem[] = [];
  const warnings: string[] = [];

  for (const block of input.blocks) {
    const headerRow = block.headerRow;
    if (!headerRow) {
      warnings.push(
        `${input.tab}: bloque ${block.kind} sin fila header detectada (fila ${block.startRow}).`
      );
      continue;
    }

    const headers = extractBlockHeaders(input.rows, headerRow);
    if (headers.filter(Boolean).length < 2) {
      warnings.push(`${input.tab}: headers insuficientes en bloque ${block.kind}.`);
      continue;
    }

    const originStage = stageForBlock(block.kind);

    for (let rowIndex = headerRow; rowIndex < block.endRow; rowIndex++) {
      const row = input.rows[rowIndex] ?? [];
      if (!row.some((cell) => cell.trim())) continue;

      const record = recordFromSemanasRow(headers, row);
      if (!isMeaningfulSemanasRow(record)) continue;

      const client =
        pickField(record, "cliente", "cliente_nombre", "marca", "nombre_cliente") || null;
      const product =
        pickField(record, "producto", "descripcion", "granel", "sku", "pt", "nombre") || null;
      const quantity =
        pickField(record, "cantidad", "kg", "kilos", "unidades", "qty", "tamano_batch") ||
        null;
      const unit = pickField(record, "unidad", "unit", "uom") || null;
      const line = inferLineFromRecord(record);
      const dayLabel = pickField(record, "dia", "día", "day") || null;
      const date = pickField(record, "fecha", "fecha_plan", "inicio") || null;
      const weekLabel = pickField(record, "semana", "week") || null;
      const deliveryDate =
        pickField(record, "entrega", "fecha_entrega", "compromiso", "fecha_compromiso") || null;
      const pedidoRef = pickField(record, "pedido", "pedido_id", "op", "oc", "nro_pedido") || null;
      const oeRef = pickField(record, "oe", "oe_id", "orden_elaboracion") || null;
      const oaRef = pickField(record, "oa", "oa_id", "orden_acondicionamiento") || null;
      const loteRef = pickField(record, "lote", "lote_id", "nro_lote") || null;
      const notes = pickField(record, "observaciones", "obs", "notas", "comentarios") || null;

      const { sector, confidence: sectorConfidence } = sectorForBlock(
        block.kind,
        record,
        line
      );

      if (!sector) {
        warnings.push(
          `${input.tab} fila ${rowIndex + 1}: sector no determinado en bloque ${block.kind}.`
        );
        continue;
      }

      const mappedCount = [client, product, quantity, date, line].filter(Boolean).length;
      const confidence = fieldConfidence(Boolean(product || client), 5, mappedCount);
      const finalConfidence =
        confidence === "high" && sectorConfidence === "high"
          ? "high"
          : confidence === "low" || sectorConfidence === "low"
            ? "low"
            : "medium";

      const priority = mapPriorityLabel(inferPriorityFromRecord(record));
      const rowNumber = rowIndex + 1;

      workItems.push({
        id: buildWorkItemId(input.fileId, input.tab, rowNumber, product),
        sector,
        ownerSector: sector,
        source: "semanas_2026",
        sourceFileId: input.fileId,
        sourceSheet: input.tab,
        sourceRange: `${rowNumber}:${rowNumber}`,
        originStage,
        date,
        dayLabel,
        weekLabel,
        client,
        product,
        quantity,
        unit,
        line,
        deliveryDate,
        status: "pendiente",
        priority,
        pedidoRef,
        oeRef,
        oaRef,
        loteRef,
        notes,
        actionLabel: originStage === "ELABORACION" ? "Abrir OE" : "Abrir trabajo",
        href: oeRef ? `/oe/${encodeURIComponent(oeRef)}` : null,
        confidence: finalConfidence,
        createdFrom: `SEMANAS 2026 · ${input.tab} · ${block.kind} · fila ${rowNumber}`,
        generatedEntities: [],
        dependsOn: null,
        blockedBy: null,
        unblocks: null,
      });
    }
  }

  return { workItems, warnings };
}

export async function discoverSemanasFile(
  docRef: DocumentRef
): Promise<SemanasDiscoveryResponse> {
  const warnings: string[] = [];
  const meta = await sheetsReader.getSpreadsheetMeta(docRef.fileId);

  let tabUsed: string | undefined;
  let rows: string[][] = [];

  for (const candidate of TAB_CANDIDATES) {
    if (!meta.tabs.includes(candidate)) continue;
    try {
      const tabRows = await sheetsReader.readTab(docRef.fileId, candidate);
      if (tabRows.length > 1) {
        rows = tabRows;
        tabUsed = candidate;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!tabUsed) {
    tabUsed = meta.tabs[0];
    if (tabUsed) {
      rows = await sheetsReader.readTab(docRef.fileId, tabUsed);
    }
  }

  const tabDiscoveries: SemanasTabDiscovery[] = [];
  let totalRead = 0;
  let totalMappable = 0;

  const tabsToScan = tabUsed ? [tabUsed] : meta.tabs.slice(0, 3);

  for (const tab of tabsToScan) {
    const tabRows = tab === tabUsed ? rows : await sheetsReader.readTab(docRef.fileId, tab);
    const blocks = detectSemanasBlocks(tabRows);
    const headerRows = detectHeaderRows(tabRows);
    const headers =
      headerRows.length > 0
        ? tabRows[headerRows[0] - 1]?.map((c) => c.trim()).filter(Boolean) ?? []
        : [];
    const sampleRows = headerRows[0]
      ? extractSampleDataRows(tabRows, headerRows[0])
      : tabRows.slice(0, 5);

    const mapperResult = semanasRowsToWorkItems({
      fileId: docRef.fileId,
      tab,
      rows: tabRows,
      blocks,
    });

    const rowsRead = Math.max(tabRows.length - 1, 0);
    const rowsMappable = mapperResult.workItems.length;
    totalRead += rowsRead;
    totalMappable += rowsMappable;

    if (mapperResult.warnings.length > 0) {
      warnings.push(...mapperResult.warnings.slice(0, 5));
    }

    const merges = meta.mergesByTab[tab] ?? [];

    tabDiscoveries.push({
      tab,
      headerRows,
      headers,
      mergedCells: merges.map((m) => ({
        tab,
        range: m.range,
        startRow: m.startRow,
        endRow: m.endRow,
        startColumn: m.startColumn,
        endColumn: m.endColumn,
      })),
      sampleRows,
      rowsRead,
      rowsMappable,
      blocksDetected: [...new Set(blocks.map((b) => b.kind))],
      blockDetails: blocks.map((b) => ({
        kind: b.kind,
        startRow: b.startRow,
        headerRow: b.headerRow,
        dataRowCount: Math.max(b.endRow - (b.headerRow ?? b.startRow), 0),
      })),
      warnings: mapperResult.warnings.slice(0, 5),
    });
  }

  const blocksSummary: Record<import("@/types/discovery/semanas-discovery.types").SemanasBlockKind, number> = {
    ELABORACION: 0,
    ACONDICIONAMIENTO: 0,
    ENTREGAS: 0,
    DESARROLLO: 0,
    OTRO: 0,
  };

  for (const tabDiscovery of tabDiscoveries) {
    for (const detail of tabDiscovery.blockDetails) {
      blocksSummary[detail.kind] += 1;
    }
  }

  return {
    source: "drive",
    scannedAt: new Date().toISOString(),
    sourceFile: {
      fileId: docRef.fileId,
      fileName: docRef.name,
      mimeType: docRef.mimeType,
      modifiedTime: docRef.modifiedTime,
    },
    tabs: meta.tabs,
    tabDiscoveries,
    blocksSummary,
    rowsRead: totalRead,
    rowsMappable: totalMappable,
    warnings,
    message:
      totalMappable > 0
        ? `${totalMappable} filas mapeables en SEMANAS 2026.`
        : "SEMANAS 2026 leído — sin filas mapeables con el contrato actual.",
  };
}

export async function loadSemanasWorkItems(
  docRef: DocumentRef
): Promise<{ workItems: WorkItem[]; warnings: string[]; discovery: SemanasDiscoveryResponse }> {
  const discovery = await discoverSemanasFile(docRef);
  const allItems: WorkItem[] = [];
  const warnings = [...discovery.warnings];

  for (const tabDiscovery of discovery.tabDiscoveries) {
    const rows = await sheetsReader.readTab(docRef.fileId, tabDiscovery.tab);
    const blocks = detectSemanasBlocks(rows);
    const result = semanasRowsToWorkItems({
      fileId: docRef.fileId,
      tab: tabDiscovery.tab,
      rows,
      blocks,
    });
    allItems.push(...result.workItems);
    warnings.push(...result.warnings);
  }

  return { workItems: allItems, warnings, discovery };
}
