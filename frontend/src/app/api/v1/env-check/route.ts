import { NextResponse } from "next/server";
import { buildRuntimeEnvSnapshot } from "@/lib/config/runtime-env-check";
import { getLocalEditsSchemaStatus, serverBuildSha } from "@/lib/asignacion-lotes/schema-status";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico runtime — sin secretos.
 * TEMPORAL: remover tras auditar Vercel/Sheets.
 */
export async function GET() {
  const snapshot = await buildRuntimeEnvSnapshot();
  // Solo lectura de information_schema: ¿la base tiene la migración 0043 (ediciones de GENUS en Asignación de lotes)?
  const asignacionLotesSchema = await getLocalEditsSchemaStatus().catch(() => null);

  return NextResponse.json({
    ...snapshot,
    build: serverBuildSha() || null,
    asignacionLotesLocalEdits: asignacionLotesSchema,
    hint:
      snapshot.mode !== "real"
        ? "Servidor en demo — revisar GENUS_DATA_MODE en el Environment del deploy activo (Production vs Preview)."
        : !snapshot.canUseDriveAdapter
          ? "Modo real pero Drive adapter bloqueado — ver driveAdapterBlockers."
          : !snapshot.driveFolder.ok
            ? "Credenciales presentes pero carpeta inaccesible — ver driveFolder."
            : "Configuración OK — ejecutar /api/v1/drive/refresh?scope=all",
  });
}
