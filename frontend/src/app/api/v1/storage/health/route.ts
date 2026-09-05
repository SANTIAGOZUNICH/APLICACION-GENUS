import { NextResponse } from "next/server";
import { getStorageHealth, resolveBlobAuthOptions } from "@/lib/storage/file-storage";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico seguro de almacenamiento privado.
 * Nunca expone store IDs, tokens ni claves.
 * GET /api/v1/storage/health
 *
 * `sample`: verificación TEMPORAL (solo en main, no en la rama del PR #85)
 * de que Production quedó conectado al Blob Store correcto tras mover el
 * binding a `aplicacion-genus-blob` — hasta 10 pathnames reales, nunca
 * URLs firmadas. Se revierte apenas se confirma coas/remitos visibles.
 */
export async function GET() {
  const health = getStorageHealth();
  let sample: string[] | null = null;
  if (health.configured) {
    try {
      const { list } = await import("@vercel/blob");
      const auth = resolveBlobAuthOptions();
      const result = await list({ limit: 10, ...auth });
      sample = result.blobs.map((b) => b.pathname);
    } catch (err) {
      sample = [`list_failed: ${err instanceof Error ? err.message : "unknown"}`];
    }
  }
  return NextResponse.json({
    provider: health.provider,
    configured: health.configured,
    authMode: health.authMode,
    storeConfigured: health.storeConfigured,
    sample,
  });
}
