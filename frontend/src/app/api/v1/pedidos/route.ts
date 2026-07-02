import { NextResponse } from "next/server";
import { pedidoResolver } from "@/lib/adapters/drive/resolvers/pedido.resolver";
import { parsePedidosWithDiagnostics } from "@/lib/mappers/diagnose-pedidos";
import {
  canUseDriveAdapter,
  demoFallbackResponse,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real" || !canUseDriveAdapter()) {
    return NextResponse.json({
      pedidos: [],
      source: "demo",
    });
  }

  try {
    const readMeta = await pedidoResolver.readPedidosWithMeta();
    const parsed = parsePedidosWithDiagnostics(readMeta.rows);
    const hasPartialIssue =
      Boolean(readMeta.warning) ||
      (parsed.diagnostic.rowsRead > 0 && parsed.diagnostic.rowsMapped === 0) ||
      parsed.diagnostic.rowsRead === 0;

    return NextResponse.json({
      pedidos: parsed.pedidos,
      source: hasPartialIssue ? "drive-partial" : "drive",
      diagnostics: {
        rowsRead: parsed.diagnostic.rowsRead,
        rowsMapped: parsed.diagnostic.rowsMapped,
        fileMimeType: readMeta.mimeType,
        readerUsed: readMeta.readerUsed,
        tabUsed: readMeta.tabUsed,
        tabsAttempted: readMeta.tabsAttempted,
        sampleHeaders: parsed.diagnostic.headersDetected.slice(0, 12),
        warning:
          readMeta.warning ??
          (parsed.diagnostic.rowsRead > 0 && parsed.diagnostic.rowsMapped === 0
            ? parsed.diagnostic.discardReasons[0] ??
              "PEDIDOS 2026 conectado, pero falta mapear columnas."
            : parsed.diagnostic.rowsRead === 0
              ? "PEDIDOS 2026 sin filas de datos detectadas."
              : undefined),
      },
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/pedidos failed:", error);

    if (shouldUseDemoFallback()) {
      return NextResponse.json({ pedidos: [], source: "demo" });
    }

    const fallback = demoFallbackResponse(() => [], error);
    if (!fallback.ok) return fallback.response;

    return NextResponse.json({
      pedidos: [],
      source: "drive-partial",
      diagnostics: {
        rowsRead: 0,
        rowsMapped: 0,
        warning:
          error instanceof Error ? error.message : "No se pudo leer PEDIDOS 2026.",
      },
    });
  }
}
