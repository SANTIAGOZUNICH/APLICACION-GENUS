import { pickField } from "@/lib/adapters/sheets/parse-sheet-rows";
import type { DocumentRef } from "@/lib/adapters/drive/types/document.types";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import {
  createVisualContext,
  detectElaboradorLabel,
  detectLineLabel,
  detectPackagingTier,
  detectSemanasBlocks,
  extractBlockHeaders,
  inferLineFromRecord,
  inferPriorityFromRecord,
  isMeaningfulSemanasRow,
  mapPriorityLabel,
  normalizeLineLabel,
  recordFromSemanasRow,
  type SemanasVisualContext,
} from "@/lib/mappers/semanas-block-parser";
import { detectHeaderRows, extractSampleDataRows } from "@/lib/discovery/schema-analyzer";
import { normalizePersonName } from "@/lib/operational/display-fields";
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

function normalizeLine(value: string | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sectorForVisualBlock(
  kind: SemanasBlockKind,
  ctx: SemanasVisualContext,
  record: Record<string, string>,
  line: string | null
): { sector: SectorId | null; confidence: WorkItemConfidence } {
  const lineText = normalizeLine(line ?? inferLineFromRecord(record));

  switch (kind) {
    case "ELABORACION":
      return { sector: "ELABORACION", confidence: ctx.elaborador ? "high" : "medium" };
    case "ACONDICIONAMIENTO": {
      if (ctx.packagingTier === "premium" || lineText.includes("premium")) {
        return { sector: "ENVASADO_PREMIUM", confidence: "high" };
      }
      if (
        ctx.packagingTier === "masivo" ||
        lineText.includes("masivo") ||
        lineText.includes("consumo")
      ) {
        return { sector: "ENVASADO_MASIVO", confidence: "high" };
      }
      if (ctx.lineLabel?.toLowerCase().includes("premium")) {
        return { sector: "ENVASADO_PREMIUM", confidence: "high" };
      }
      if (ctx.lineLabel?.toLowerCase().includes("línea") || ctx.lineLabel?.toLowerCase().includes("linea")) {
        return { sector: "ENVASADO_MASIVO", confidence: "medium" };
      }
      return { sector: null, confidence: "low" };
    }
    case "ENTREGAS":
      return { sector: "DEPOSITO", confidence: "medium" };
    case "DESARROLLO":
      return { sector: "PRODUCCION", confidence: "medium" };
    default:
      return { sector: null, confidence: "low" };
  }
}

function buildWorkItemId(
  fileId: string,
  tab: string,
  rowNumber: number,
  product: string | null,
  ctx: SemanasVisualContext
): string {
  const scope = slugify(ctx.elaborador ?? ctx.lineLabel ?? "row");
  return `semanas:${fileId}:${slugify(tab)}:${scope}:${rowNumber}:${slugify(product ?? "item")}`;
}

function fieldConfidence(hasValue: boolean, total: number, mapped: number): WorkItemConfidence {
  if (!hasValue) return "low";
  const ratio = total > 0 ? mapped / total : 0;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.25) return "medium";
  return "low";
}

function resolveOwnerPerson(
  ctx: SemanasVisualContext,
  record: Record<string, string>
): string | null {
  const fromColumn =
    pickField(record, "elaborador", "responsable", "operario", "asignado", "elaborador_nombre") ||
    null;
  if (fromColumn) return normalizePersonName(fromColumn);
  return ctx.elaborador;
}

function resolveLine(ctx: SemanasVisualContext, record: Record<string, string>): string | null {
  const fromRecord = inferLineFromRecord(record);
  const fromContext = ctx.lineLabel;
  return normalizeLineLabel(fromRecord ?? fromContext);
}

function updateVisualContext(
  blockKind: SemanasBlockKind,
  row: string[],
  ctx: SemanasVisualContext,
  isHeader: boolean
): SemanasVisualContext {
  const next = { ...ctx };

  const tier = detectPackagingTier(row);
  if (tier) next.packagingTier = tier;

  const line = detectLineLabel(row);
  if (line) next.lineLabel = line;

  if (blockKind === "ELABORACION" && !isHeader) {
    const elaborador = detectElaboradorLabel(row);
    if (elaborador) {
      next.elaborador = elaborador;
    }
  }

  return next;
}

export interface SemanasMapperResult {
  workItems: WorkItem[];
  warnings: string[];
}

/** F10.1 — SEMANAS 2026 → WorkItem[] interpretando bloques visuales (no filas planas). */
export function semanasRowsToWorkItems(input: {
  fileId: string;
  tab: string;
  rows: string[][];
  blocks: ReturnType<typeof detectSemanasBlocks>;
}): SemanasMapperResult {
  const workItems: WorkItem[] = [];
  const warnings: string[] = [];

  for (const block of input.blocks) {
    let ctx = createVisualContext();
    let headers: string[] = block.headerRow
      ? extractBlockHeaders(input.rows, block.headerRow)
      : [];
    const originStage = stageForBlock(block.kind);

    for (let rowIndex = block.startRow - 1; rowIndex < block.endRow; rowIndex++) {
      const row = input.rows[rowIndex] ?? [];
      if (!row.some((cell) => cell.trim())) continue;

      const rowNumber = rowIndex + 1;
      const isHeader = block.headerRow === rowNumber;

      ctx = updateVisualContext(block.kind, row, ctx, isHeader);

      if (isHeader) {
        headers = extractBlockHeaders(input.rows, rowNumber);
        continue;
      }

      const elaboradorOnly = detectElaboradorLabel(row);
      if (elaboradorOnly && block.kind === "ELABORACION") {
        ctx.elaborador = elaboradorOnly;
        continue;
      }

      const lineOnly = detectLineLabel(row);
      if (lineOnly && block.kind === "ACONDICIONAMIENTO" && row.filter((c) => c.trim()).length <= 2) {
        ctx.lineLabel = lineOnly;
        continue;
      }

      const tierOnly = detectPackagingTier(row);
      if (tierOnly && row.filter((c) => c.trim()).length <= 2) {
        ctx.packagingTier = tierOnly;
        continue;
      }

      const record =
        headers.filter(Boolean).length >= 2
          ? recordFromSemanasRow(headers, row)
          : buildPositionalRecord(row);

      if (!isMeaningfulSemanasRow(record) && !record.producto && !record.cliente) {
        continue;
      }

      const client =
        pickField(record, "cliente", "cliente_nombre", "marca", "nombre_cliente") || null;
      const product =
        pickField(record, "producto", "descripcion", "granel", "sku", "pt", "nombre") || null;
      const quantity =
        pickField(record, "cantidad", "kg", "kilos", "unidades", "qty", "tamano_batch") || null;
      const unit = pickField(record, "unidad", "unit", "uom") || null;
      const line = resolveLine(ctx, record);
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
      const ownerPerson = resolveOwnerPerson(ctx, record);

      const { sector, confidence: sectorConfidence } = sectorForVisualBlock(
        block.kind,
        ctx,
        record,
        line
      );

      if (!sector) {
        warnings.push(
          `${input.tab} fila ${rowNumber}: sector no determinado en bloque ${block.kind} (línea: ${line ?? "—"}).`
        );
        continue;
      }

      if (block.kind === "ELABORACION" && !ownerPerson) {
        warnings.push(
          `${input.tab} fila ${rowNumber}: elaboración sin elaborador detectado — revisar bloque visual.`
        );
      }

      if (block.kind === "ACONDICIONAMIENTO" && !line) {
        warnings.push(
          `${input.tab} fila ${rowNumber}: acondicionamiento sin línea detectada — revisar bloque LÍNEA 1/2/3.`
        );
      }

      const mappedCount = [client, product, quantity, date, line, ownerPerson].filter(Boolean).length;
      const confidence = fieldConfidence(Boolean(product || client), 6, mappedCount);
      const finalConfidence =
        confidence === "high" && sectorConfidence === "high"
          ? "high"
          : confidence === "low" || sectorConfidence === "low"
            ? "low"
            : "medium";

      const priority = mapPriorityLabel(inferPriorityFromRecord(record));

      const contextLabel = ownerPerson ?? line ?? block.kind;
      workItems.push({
        id: buildWorkItemId(input.fileId, input.tab, rowNumber, product, ctx),
        sector,
        ownerSector: sector,
        ownerPerson,
        source: "semanas_2026",
        sourceFileId: input.fileId,
        sourceSheet: input.tab,
        sourceRange: `${rowNumber}:${rowNumber}`,
        productSourceRange: null,
        quantitySourceRange: null,
        originStage,
        date,
        plannedDate: null,
        dayLabel,
        dayOfWeek: dayLabel,
        weekLabel,
        weekStart: null,
        weekId: null,
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
        createdFrom: `SEMANAS 2026 · ${input.tab} · ${block.kind} · ${contextLabel} · fila ${rowNumber}`,
        generatedEntities: [],
        dependsOn: null,
        blockedBy: null,
        unblocks: null,
      });
    }
  }

  return { workItems, warnings };
}

/** Fallback cuando no hay fila header — primeras celdas como producto/cliente/cantidad. */
function buildPositionalRecord(row: string[]): Record<string, string> {
  const cells = row.map((c) => c.trim()).filter(Boolean);
  const record: Record<string, string> = {};
  if (cells[0]) record.cliente = cells[0];
  if (cells[1]) record.producto = cells[1];
  if (cells[2]) record.cantidad = cells[2];
  if (cells[3]) record.unidad = cells[3];
  if (cells[4]) record.entrega = cells[4];
  return record;
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
        ? `${totalMappable} bloques de trabajo mapeables en SEMANAS 2026.`
        : "SEMANAS 2026 leído — sin bloques mapeables con el contrato F10.1.",
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
