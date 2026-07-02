import "server-only";

import { NextResponse } from "next/server";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export function discoveryNotAvailableResponse(extra: Record<string, unknown> = {}) {
  const dataMode = getServerDataMode();

  return NextResponse.json({
    source: "demo" as const,
    scannedAt: new Date().toISOString(),
    message:
      dataMode !== "real"
        ? "Data Discovery requiere GENUS_DATA_MODE=real."
        : "Data Discovery requiere credenciales Google y GOOGLE_DRIVE_GENUS_FOLDER_ID.",
    warnings: ["Discovery no ejecutado — Drive no configurado."],
    ...extra,
  });
}

export function canRunDiscovery(): boolean {
  return canUseDriveAdapter();
}

export function discoveryErrorResponse(error: unknown, code: string) {
  return NextResponse.json(
    {
      source: "drive" as const,
      scannedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Error en discovery.",
      code,
      warnings: [
        error instanceof Error ? error.message : "Error desconocido en discovery.",
      ],
    },
    { status: 502 }
  );
}
