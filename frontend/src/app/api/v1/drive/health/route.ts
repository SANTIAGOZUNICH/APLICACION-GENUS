import { NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import { getServerDataMode } from "@/lib/config/data-mode";

export async function GET() {
  if (getServerDataMode() !== "real") {
    return NextResponse.json({
      ok: true,
      mode: "demo",
      message: "Modo demo — Drive no requerido.",
    });
  }

  if (!canUseDriveAdapter()) {
    return NextResponse.json({
      ok: false,
      mode: "real",
      message:
        "Modo real activo pero falta GOOGLE_DRIVE_GENUS_FOLDER_ID o credenciales. Compartí GENUS con la service account.",
    });
  }

  const health = await operationsDocumentRepository.health();
  return NextResponse.json(health);
}
