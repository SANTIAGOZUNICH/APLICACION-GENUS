import { NextRequest, NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { CriticalSheetKey } from "@/lib/adapters/drive/drive-folder-config";
import { sheetsReader } from "@/lib/adapters/sheets/sheets-reader";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

const VALID_KEYS = new Set<CriticalSheetKey>([
  "semanas_2026",
  "pedidos_2026",
  "asignacion_lotes_2026",
]);

/** Lectura puntual de celda — solo validación operativa (Flujo A). */
export async function GET(request: NextRequest) {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json(
      { error: "Modo demo o Drive no configurado.", code: "NOT_AVAILABLE" },
      { status: 503 }
    );
  }

  const sheetKey = (request.nextUrl.searchParams.get("key") ?? "semanas_2026") as CriticalSheetKey;
  const a1 = request.nextUrl.searchParams.get("a1")?.trim();

  if (!VALID_KEYS.has(sheetKey)) {
    return NextResponse.json({ error: "key inválido.", code: "INVALID_KEY" }, { status: 400 });
  }

  if (!a1 || !a1.includes("!")) {
    return NextResponse.json(
      { error: "Parámetro a1 requerido (ej. ELABORACION!B537).", code: "INVALID_RANGE" },
      { status: 400 }
    );
  }

  try {
    const ref = await operationsDocumentRepository.tryGetCriticalSheetRef(sheetKey);
    if (!ref) {
      return NextResponse.json(
        { error: `Sheet ${sheetKey} no indexado.`, code: "SHEET_NOT_INDEXED" },
        { status: 404 }
      );
    }

    const meta = await sheetsReader.getSpreadsheetMeta(ref.fileId);
    const tab = a1.split("!")[0]?.replace(/^'|'$/g, "") ?? "";
    if (!meta.tabs.some((t) => t.toLowerCase() === tab.toLowerCase())) {
      return NextResponse.json(
        { error: `Pestaña "${tab}" no existe.`, code: "TAB_NOT_FOUND", tabs: meta.tabs },
        { status: 404 }
      );
    }

    const rows = await sheetsReader.readRange(ref.fileId, a1);
    const value = rows[0]?.[0] ?? "";

    return NextResponse.json({
      spreadsheetId: ref.fileId,
      key: sheetKey,
      a1,
      value,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/sheets/cell failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo leer la celda.",
        code: "SHEET_READ_FAILED",
      },
      { status: 502 }
    );
  }
}
