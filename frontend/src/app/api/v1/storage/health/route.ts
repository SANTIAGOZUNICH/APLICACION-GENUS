import { NextResponse } from "next/server";
import { getStorageHealth, resolveBlobAuthOptions } from "@/lib/storage/file-storage";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico seguro de almacenamiento privado.
 * Nunca expone store IDs, tokens ni claves.
 * GET /api/v1/storage/health
 *
 * `sample`: hasta 5 pathnames (nunca URLs firmadas) del store efectivamente
 * resuelto — con dos Blob Stores conectados al mismo proyecto, es la única
 * forma de confirmar CUÁL store usa BLOB_STORE_ID en runtime sin exponer su
 * ID. Solo se llama si `configured` es true; un fallo acá no rompe el resto
 * del diagnóstico. Diagnóstico temporal — remover una vez confirmado el
 * store correcto (ver PR #85).
 */
export async function GET() {
  const health = getStorageHealth();
  let sample: string[] | null = null;
  if (health.configured) {
    try {
      const { list } = await import("@vercel/blob");
      const auth = resolveBlobAuthOptions();
      const result = await list({ limit: 5, ...auth });
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
