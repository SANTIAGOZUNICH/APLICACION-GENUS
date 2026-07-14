import { NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";
import { todayInBuenosAires } from "@/lib/operational/operational-calendar";
import { parseSemanasTabsToWorkItems } from "@/lib/live-sync/load-semanas-hot-path";
import {
  buildTodayBySector,
  collectDateHeaderSamplesFromRows,
  type DateHeaderDebugResult,
} from "@/lib/parsers/planner/date-header-debug";
import { PLANNER_TABS } from "@/lib/parsers/planner/planner-parser";
import { SEMANAS_OPERATIONAL_YEAR } from "@/lib/parsers/planner/date-header-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnóstico temporal de resolución de fechas SEMANAS.
 * Seguro: sin secretos. Disponible en modo real para validar Hoy.
 */
export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(
      { error: "Modo demo o Drive no configurado.", code: "NOT_AVAILABLE" },
      { status: 503 }
    );
  }

  try {
    const ref = await operationsDocumentRepository.tryGetCriticalSheetRef("semanas_2026");
    if (!ref) {
      return NextResponse.json(
        { error: "SEMANAS 2026 no indexado.", code: "SHEET_NOT_INDEXED" },
        { status: 404 }
      );
    }

    const tabs: Array<{ tab: string; rows: string[][] }> = [];
    for (const tab of PLANNER_TABS) {
      const rows = await sheetsReader.readTab(ref.fileId, tab);
      tabs.push({ tab, rows });
    }

    const parsed = parseSemanasTabsToWorkItems(ref.fileId, tabs);
    const today = todayInBuenosAires();
    const samples = tabs.flatMap(({ tab, rows }) =>
      collectDateHeaderSamplesFromRows(tab, rows, parsed.workItems)
    );

    const todaySamples = samples.filter((s) => s.resolvedDate === today);
    const payload: DateHeaderDebugResult & {
      todayHeaderSamples: typeof todaySamples;
      parserWarnings: string[];
    } = {
      checkedAt: new Date().toISOString(),
      todayBuenosAires: today,
      operationalYear: SEMANAS_OPERATIONAL_YEAR,
      samples: samples.filter(
        (s) =>
          s.resolvedDate === today ||
          s.resolvedDate.startsWith("2026-07") ||
          s.resolvedDate.startsWith("2026-06")
      ),
      todayHeaderSamples: todaySamples,
      todayBySector: buildTodayBySector(parsed.workItems, today),
      warnings: samples.flatMap((s) => s.warnings),
      parserWarnings: parsed.warnings.slice(0, 40),
    };

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "date-debug failed",
        code: "DATE_DEBUG_FAILED",
      },
      { status: 503 }
    );
  }
}
