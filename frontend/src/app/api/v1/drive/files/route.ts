import { NextRequest, NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { resolveFolderKey } from "@/lib/adapters/drive/drive-folder-config";
import {
  canUseDriveAdapter,
  shouldUseDemoFallback,
} from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET(request: NextRequest) {
  const folderParam = request.nextUrl.searchParams.get("folder");

  if (getServerDataMode() !== "real") {
    return NextResponse.json({ files: [], source: "demo" });
  }

  if (!folderParam) {
    return NextResponse.json(
      { error: "Parámetro folder requerido.", code: "MISSING_FOLDER" },
      { status: 400 }
    );
  }

  const folderKey = resolveFolderKey(folderParam);
  if (!folderKey) {
    return NextResponse.json(
      { error: `Carpeta desconocida: ${folderParam}`, code: "INVALID_FOLDER" },
      { status: 400 }
    );
  }

  if (!canUseDriveAdapter()) {
    if (shouldUseDemoFallback()) {
      return NextResponse.json({ files: [], source: "demo" });
    }
    return NextResponse.json(
      { error: "Drive no configurado.", code: "DRIVE_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  try {
    const files = await operationsDocumentRepository.listDocuments(folderKey);
    return NextResponse.json({
      folder: folderKey,
      files,
      source: "drive",
    });
  } catch (error) {
    console.error("[Genus] GET /api/v1/drive/files failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "No se pudo listar archivos.",
        code: "DRIVE_LIST_FAILED",
      },
      { status: 502 }
    );
  }
}
