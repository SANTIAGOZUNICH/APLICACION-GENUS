import { NextResponse } from "next/server";
import { getStorageHealth } from "@/lib/storage/file-storage";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico seguro de almacenamiento privado.
 * Nunca expone store IDs, tokens ni claves.
 * GET /api/v1/storage/health
 */
export async function GET() {
  const health = getStorageHealth();
  return NextResponse.json({
    provider: health.provider,
    configured: health.configured,
    authMode: health.authMode,
    storeConfigured: health.storeConfigured,
  });
}
