import "server-only";

import {
  CRITICAL_SHEET_NAMES,
} from "@/lib/adapters/drive/drive-folder-config";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { oeResolver } from "@/lib/adapters/drive/resolvers/oe.resolver";
import { loteResolver } from "@/lib/adapters/drive/resolvers/lote.resolver";
import { readTabularFile } from "@/lib/adapters/excel/tabular-file-reader";
import { isExcelMime, isGoogleSpreadsheetMime } from "@/lib/adapters/excel/excel-mime";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import type { OeIndexEntry } from "@/lib/adapters/drive/types/document.types";
import {
  LOTES_MAPPER_CONTRACT,
  matchContractFields,
  OE_MAPPER_CONTRACT,
  PEDIDOS_MAPPER_CONTRACT,
} from "@/lib/discovery/mapper-contract";
import {
  analyzeSheetLayout,
  buildValuesByKeyFromLabelValue,
  buildValuesByKeyFromTabular,
  detectHeaderRows,
  extractHeadersFromRow,
  extractSampleDataRows,
} from "@/lib/discovery/schema-analyzer";
import { parseAsignacionLoteRowsWithDiagnostics } from "@/lib/mappers/diagnose-asignacion-lotes";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import type {
  DiscoveryConnectionStatus,
  DiscoverySummaryResponse,
  DriveSummaryResponse,
  LotesSchemaResponse,
  OeSchemaSample,
  OeSchemasResponse,
  PedidosSchemaResponse,
} from "@/types/discovery/discovery.types";

const OE_SAMPLE_COUNT = 5;

function connectionStatus(
  connected: boolean,
  rowsMappable: number
): DiscoveryConnectionStatus {
  if (!connected) return "not_connected";
  if (rowsMappable > 0) return "connected";
  return "pending_mapper";
}

function pickOeSamples(entries: OeIndexEntry[]): Array<{ entry: OeIndexEntry; reason: string }> {
  const picked = new Map<string, { entry: OeIndexEntry; reason: string }>();

  const byRecency = [...entries].sort((a, b) => {
    const left = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const right = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return right - left;
  });

  const julioJunio = byRecency.filter((entry) => {
    const path = entry.folderPath?.toLowerCase() ?? "";
    return path.includes("julio") || path.includes("junio");
  });

  for (const entry of julioJunio.slice(0, 2)) {
    picked.set(entry.fileId, {
      entry,
      reason: entry.folderPath?.toLowerCase().includes("julio")
        ? "Reciente — carpeta Julio"
        : "Reciente — carpeta Junio",
    });
  }

  const older = byRecency.filter((entry) => {
    const path = entry.folderPath?.toLowerCase() ?? "";
    return !path.includes("julio") && !path.includes("junio");
  });

  for (const entry of older.slice(0, 2)) {
    picked.set(entry.fileId, { entry, reason: "Mes anterior / carpeta distinta" });
  }

  const oePrefix = byRecency.find((entry) =>
    entry.fileName.trim().toUpperCase().startsWith("OE-")
  );
  if (oePrefix) {
    picked.set(oePrefix.fileId, { entry: oePrefix, reason: "Nombre empieza con OE-" });
  }

  for (const entry of byRecency) {
    if (picked.size >= OE_SAMPLE_COUNT) break;
    if (!picked.has(entry.fileId)) {
      picked.set(entry.fileId, { entry, reason: "Completar muestra representativa" });
    }
  }

  return [...picked.values()].slice(0, OE_SAMPLE_COUNT);
}

async function analyzeOeSample(
  entry: OeIndexEntry,
  sampleReason: string
): Promise<OeSchemaSample> {
  const warnings: string[] = [];
  let tabs: string[] = [];
  let tabUsed: string | undefined;
  let rows: string[][] = [];

  try {
    tabs = await sheetsReader.listTabs(entry.fileId);
    tabUsed = tabs[0];
    if (tabUsed) {
      rows = await sheetsReader.readTab(entry.fileId, tabUsed);
    }
  } catch (error) {
    warnings.push(
      error instanceof Error ? error.message : "No se pudo leer tabs del Sheet."
    );
  }

  const analysis = analyzeSheetLayout(rows);
  let valuesByKey: Record<string, string> = {};

  if (analysis.layout === "label_value") {
    valuesByKey = buildValuesByKeyFromLabelValue(rows);
  } else if (analysis.headerRowIndex) {
    valuesByKey = buildValuesByKeyFromTabular(rows, analysis.headerRowIndex);
  }

  const { detected, missing } = matchContractFields(
    OE_MAPPER_CONTRACT,
    analysis.headers,
    valuesByKey
  );

  const requiredMissing = detected.filter((f) => f.required && !f.matched).map((f) => f.field);
  if (requiredMissing.length > 0) {
    warnings.push(`Campos obligatorios no detectados: ${requiredMissing.join(", ")}`);
  }

  return {
    fileName: entry.fileName,
    fileId: entry.fileId,
    folderPath: entry.folderPath,
    modifiedTime: entry.modifiedTime,
    sampleReason,
    tabs,
    tabUsed,
    detectedHeaderRows: analysis.detectedHeaderRows ?? detectHeaderRows(rows),
    headers: analysis.headers,
    sampleRows: analysis.sampleRows,
    layout: analysis.layout,
    fieldsDetected: detected,
    fieldsMissing: missing,
    warnings,
  };
}

export class DiscoveryService {
  async getDriveSummary(): Promise<DriveSummaryResponse> {
    await operationsDocumentRepository.refresh("all");

    const folderIndex = operationsDocumentRepository.getFolderIndex();
    const oeIndex = await oeResolver.listOeIndex();
    const warnings: string[] = [];

    const documentsByAlias: Record<string, number> = {};
    const formatsDetected: Record<string, number> = {};
    let googleSheetsCount = 0;
    let excelCount = 0;
    let lastModified: string | undefined;

    const documentAliases = ["elaboracion", "pcp", "lotes"] as const;

    for (const alias of documentAliases) {
      const docs = await operationsDocumentRepository.listDocuments(alias);
      if (docs.length > 0) {
        documentsByAlias[alias] = docs.length;
      }

      for (const doc of docs) {
        formatsDetected[doc.mimeType] = (formatsDetected[doc.mimeType] ?? 0) + 1;
        if (isGoogleSpreadsheetMime(doc.mimeType)) googleSheetsCount += 1;
        if (isExcelMime(doc.mimeType)) excelCount += 1;

        if (doc.modifiedTime) {
          if (!lastModified || doc.modifiedTime > lastModified) {
            lastModified = doc.modifiedTime;
          }
        }
      }
    }

    const criticalKeys = [
      "asignacion_lotes_2026",
      "pedidos_2026",
      "semanas_2026",
    ] as const;

    const criticalSheets = await Promise.all(
      criticalKeys.map(async (key) => {
        const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(key);
        return {
          key,
          name: CRITICAL_SHEET_NAMES[key],
          connected: Boolean(ref),
          fileId: ref?.fileId,
          mimeType: ref?.mimeType,
          modifiedTime: ref?.modifiedTime,
        };
      })
    );

    const missingCritical = criticalSheets.filter((s) => !s.connected).map((s) => s.name);
    if (missingCritical.length > 0) {
      warnings.push(`Sheets críticos no indexados: ${missingCritical.join(", ")}`);
    }

    return {
      source: "drive",
      scannedAt: new Date().toISOString(),
      foldersScanned: folderIndex.length,
      folderIndexCount: folderIndex.length,
      documentsByAlias,
      formatsDetected,
      googleSheetsCount,
      excelCount,
      criticalSheets,
      oeIndexCount: oeIndex.length,
      lastModified,
      warnings,
      message: `${oeIndex.length} OEs indexadas · ${folderIndex.length} carpetas escaneadas.`,
    };
  }

  async getOeSchemas(): Promise<OeSchemasResponse> {
    await operationsDocumentRepository.refresh("elaboracion");
    const oeIndex = await oeResolver.listOeIndex();
    const samples = pickOeSamples(oeIndex);
    const warnings: string[] = [];

    if (oeIndex.length === 0) {
      warnings.push("Índice ELABORACION vacío. Ejecutá /api/v1/drive/refresh.");
    }

    const analyzed = await Promise.all(
      samples.map(({ entry, reason }) => analyzeOeSample(entry, reason))
    );

    const allRequiredMissing = new Set<string>();
    for (const sample of analyzed) {
      for (const field of sample.fieldsDetected.filter((f) => f.required && !f.matched)) {
        allRequiredMissing.add(field.field);
      }
    }
    if (allRequiredMissing.size > 0) {
      warnings.push(
        `Campos OE obligatorios no confirmados en muestra: ${[...allRequiredMissing].join(", ")}`
      );
    }

    return {
      source: "drive",
      scannedAt: new Date().toISOString(),
      samplesRequested: OE_SAMPLE_COUNT,
      samples: analyzed,
      oeIndexCount: oeIndex.length,
      warnings,
      message: `${analyzed.length} OEs analizadas de ${oeIndex.length} indexadas.`,
    };
  }

  async getLotesSchema(): Promise<LotesSchemaResponse> {
    await operationsDocumentRepository.refresh("lotes");

    let connected = false;
    let sourceFile: LotesSchemaResponse["sourceFile"];
    let tabs: string[] = [];
    let tabUsed: string | undefined;
    let rows: string[][] = [];
    const warnings: string[] = [];

    try {
      const docRef = await operationsDocumentRepository.getCriticalSheetRef(
        "asignacion_lotes_2026"
      );
      connected = true;
      sourceFile = {
        fileId: docRef.fileId,
        fileName: docRef.name,
        mimeType: docRef.mimeType,
        modifiedTime: docRef.modifiedTime,
        folderPath: docRef.folderPath,
      };

      tabs = await sheetsReader.listTabs(docRef.fileId);
      const readMeta = await loteResolver.readAsignacionWithMeta();
      rows = readMeta.rows;
      tabUsed = readMeta.tabUsed;
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : "ASIGNACION DE LOTES 2026 no disponible."
      );
    }

    const headerRows = detectHeaderRows(rows);
    const headerRowIndex = headerRows[0] ?? 1;
    const headers = extractHeadersFromRow(rows, headerRowIndex);
    const sampleRows = extractSampleDataRows(rows, headerRowIndex);
    const valuesByKey = buildValuesByKeyFromTabular(rows, headerRowIndex);
    const { detected, missing } = matchContractFields(
      LOTES_MAPPER_CONTRACT,
      headers,
      valuesByKey
    );

    const parsed = parseAsignacionLoteRowsWithDiagnostics(rows);
    if (parsed.diagnostic.rowsRead > 0 && parsed.diagnostic.rowsMapped === 0) {
      warnings.push("Filas leídas pero ninguna mapeable con aliases actuales.");
      if (parsed.diagnostic.discardReasons.length > 0) {
        warnings.push(...parsed.diagnostic.discardReasons.slice(0, 3));
      }
    }

    const status = connectionStatus(connected, parsed.diagnostic.rowsMapped);

    return {
      source: "drive",
      scannedAt: new Date().toISOString(),
      connected,
      connectionStatus: status,
      sourceFile,
      tabs,
      tabUsed,
      detectedHeaderRows: headerRows,
      headers,
      sampleRows,
      fieldsDetected: detected,
      fieldsMissing: missing,
      rowsRead: parsed.diagnostic.rowsRead,
      rowsMappable: parsed.diagnostic.rowsMapped,
      warnings,
      message: connected
        ? `${parsed.diagnostic.rowsMapped}/${parsed.diagnostic.rowsRead} filas mapeables`
        : "Archivo ASIGNACION DE LOTES 2026 no conectado.",
    };
  }

  async getPedidosSchema(): Promise<PedidosSchemaResponse> {
    await operationsDocumentRepository.refresh("pcp");

    const warnings: string[] = [];
    const docRef = await operationsDocumentRepository.tryGetCriticalSheetRef("pedidos_2026");

    if (!docRef) {
      warnings.push("PEDIDOS 2026 no indexado. Ejecutá /api/v1/drive/refresh.");
      return {
        source: "drive",
        scannedAt: new Date().toISOString(),
        connected: false,
        connectionStatus: "not_connected",
        workbookSheets: [],
        detectedHeaderRows: [],
        headers: [],
        sampleRows: [],
        fieldsDetected: matchContractFields(PEDIDOS_MAPPER_CONTRACT, [], {}).detected,
        fieldsMissing: PEDIDOS_MAPPER_CONTRACT.map((f) => f.field),
        rowsRead: 0,
        rowsMappable: 0,
        warnings,
        message: "PEDIDOS 2026 no conectado.",
      };
    }

    const readResult = await readTabularFile(docRef, [
      process.env.SHEETS_TAB_PEDIDOS?.trim(),
      "PEDIDOS",
      "Pedidos",
      "Hoja 1",
    ].filter(Boolean) as string[]);

    if (readResult.warning) warnings.push(readResult.warning);

    const rows = readResult.rows;
    const headerRows = detectHeaderRows(rows);
    const headerRowIndex = headerRows[0] ?? 1;
    const headers = extractHeadersFromRow(rows, headerRowIndex);
    const sampleRows = extractSampleDataRows(rows, headerRowIndex);
    const valuesByKey = buildValuesByKeyFromTabular(rows, headerRowIndex);
    const { detected, missing } = matchContractFields(
      PEDIDOS_MAPPER_CONTRACT,
      headers,
      valuesByKey
    );

    const parsed = parsePedidosWithDiagnostics(rows);
    if (parsed.diagnostic.rowsRead > 0 && parsed.diagnostic.rowsMapped === 0) {
      warnings.push("Filas leídas pero ninguna mapeable con aliases actuales.");
      if (parsed.diagnostic.discardReasons.length > 0) {
        warnings.push(...parsed.diagnostic.discardReasons.slice(0, 3));
      }
    }

    const status = connectionStatus(true, parsed.diagnostic.rowsMapped);

    return {
      source: "drive",
      scannedAt: new Date().toISOString(),
      connected: true,
      connectionStatus: status,
      sourceFile: {
        fileId: docRef.fileId,
        fileName: docRef.name,
        mimeType: docRef.mimeType,
        modifiedTime: docRef.modifiedTime,
        folderPath: docRef.folderPath,
      },
      mimeType: readResult.mimeType,
      readerUsed: readResult.readerUsed,
      workbookSheets: readResult.sheetNames ?? [],
      tabUsed: readResult.tabUsed,
      detectedHeaderRows: headerRows,
      headers,
      sampleRows,
      fieldsDetected: detected,
      fieldsMissing: missing,
      rowsRead: parsed.diagnostic.rowsRead,
      rowsMappable: parsed.diagnostic.rowsMapped,
      warnings,
      message: `${parsed.diagnostic.rowsMapped}/${parsed.diagnostic.rowsRead} filas mapeables · lector ${readResult.readerUsed}`,
    };
  }

  async getDiscoverySummary(): Promise<DiscoverySummaryResponse> {
    const [drive, oe, lotes, pedidos] = await Promise.all([
      this.getDriveSummary(),
      this.getOeSchemas(),
      this.getLotesSchema(),
      this.getPedidosSchema(),
    ]);

    const oeRequiredDetected = oe.samples.flatMap((s) =>
      s.fieldsDetected.filter((f) => f.required && f.matched)
    );
    const oeRequiredTotal = OE_MAPPER_CONTRACT.filter((f) => f.required).length;
    const oeFieldsDetectedCount = new Set(oeRequiredDetected.map((f) => f.field)).size;
    const oeFieldsMissingCount = OE_MAPPER_CONTRACT.filter((f) => f.required).length - oeFieldsDetectedCount;

    const schemaWarnings = [
      ...drive.warnings,
      ...oe.warnings,
      ...lotes.warnings,
      ...pedidos.warnings,
    ];

    const blockers: string[] = [];
    if (drive.oeIndexCount === 0) blockers.push("Sin OEs indexadas en ELABORACION");
    if (lotes.rowsMappable === 0) blockers.push("lotesRowsMappable = 0");
    if (pedidos.rowsMappable === 0) blockers.push("pedidosRowsMappable = 0");
    if (oeFieldsDetectedCount < oeRequiredTotal) {
      blockers.push("Campos OE obligatorios no confirmados en muestra");
    }

    const oeStatus: DiscoveryConnectionStatus =
      drive.oeIndexCount > 0
        ? oeFieldsDetectedCount >= oeRequiredTotal
          ? "connected"
          : "pending_mapper"
        : "not_connected";

    return {
      source: "drive",
      scannedAt: new Date().toISOString(),
      oes: {
        count: drive.oeIndexCount,
        status: oeStatus,
        fieldsDetectedCount: oeFieldsDetectedCount,
        fieldsMissingCount: oeFieldsMissingCount,
        warnings: oe.warnings,
      },
      lotes: {
        status: lotes.connectionStatus,
        rowsRead: lotes.rowsRead,
        rowsMappable: lotes.rowsMappable,
        warnings: lotes.warnings,
      },
      pedidos: {
        status: pedidos.connectionStatus,
        rowsRead: pedidos.rowsRead,
        rowsMappable: pedidos.rowsMappable,
        warnings: pedidos.warnings,
      },
      schemaWarnings,
      readyForUiMapping: blockers.length === 0,
      blockers,
    };
  }
}

export const discoveryService = new DiscoveryService();
