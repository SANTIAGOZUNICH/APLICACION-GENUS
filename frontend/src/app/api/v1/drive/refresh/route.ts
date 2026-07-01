import { NextRequest, NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import type { RefreshScope } from "@/lib/adapters/drive/types/document.types";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

const VALID_SCOPES = new Set<RefreshScope>([
  "all",
  "elaboracion",
  "pcp",
  "lotes",
  "critical_sheets",
]);

export async function GET(request: NextRequest) {
  if (getServerDataMode() !== "real") {
    return NextResponse.json({
      message: "Modo demo — refresh no aplica.",
      source: "demo",
    });
  }

  if (!canUseDriveAdapter()) {
    if (shouldUseDemoFallback()) {
      return NextResponse.json({
        message: "Drive no configurado — operando en demo.",
        source: "demo",
      });
    }
    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const scopeParam = request.nextUrl.searchParams.get("scope") ?? "all";
  const scope = VALID_SCOPES.has(scopeParam as RefreshScope)
    ? (scopeParam as RefreshScope)
    : "all";

  try {
    const result = await operationsDocumentRepository.refresh(scope);
    return NextResponse.json({
      ...result,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/drive/refresh failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo refrescar el índice.",
        code: "DRIVE_REFRESH_FAILED",
      },
      { status: 502 }
    );
  }
}
