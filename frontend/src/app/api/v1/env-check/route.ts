import { NextResponse } from "next/server";
import { buildRuntimeEnvSnapshot } from "@/lib/config/runtime-env-check";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico runtime — sin secretos.
 * TEMPORAL: remover tras auditar Vercel/Sheets.
 */
export async function GET() {
  const snapshot = await buildRuntimeEnvSnapshot();

  return NextResponse.json({
    ...snapshot,
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
