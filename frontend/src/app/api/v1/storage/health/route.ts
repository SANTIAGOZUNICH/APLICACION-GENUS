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

  // ---- Diagnóstico adicional (temporal, ver PR #85) ----
  // Solo booleanos de presencia — NUNCA el valor de un token/ID. Investiga
  // por qué authMode:NONE persiste aunque BLOB_READ_WRITE_TOKEN figure
  // agregado en Production desde el dashboard de Vercel.
  const hasReadWriteTokenEnv = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const hasOidcTokenEnv = Boolean(process.env.VERCEL_OIDC_TOKEN?.trim());
  const hasStoreIdEnv = Boolean(process.env.BLOB_STORE_ID?.trim());
  // GENUS_FILE_STORAGE y VERCEL son flags de config, no secretos — su
  // valor literal no es sensible (a diferencia de un token/ID).
  const genusFileStorageFlag = process.env.GENUS_FILE_STORAGE ?? null;
  const vercelRuntimeFlag = process.env.VERCEL ?? null;

  // Prueba de auth CRUDA con el token, sin pasar por nuestro detector —
  // aísla "el token no llega al runtime" de "llega pero autentica otro
  // store" de "nuestro detector tiene un bug". Solo lista pathnames
  // (nunca escribe/borra), y solo corre si el token existe.
  let sampleViaRawToken: string[] | null = null;
  if (hasReadWriteTokenEnv) {
    try {
      const { list } = await import("@vercel/blob");
      const result = await list({ limit: 5, token: process.env.BLOB_READ_WRITE_TOKEN });
      sampleViaRawToken = result.blobs.map((b) => b.pathname);
    } catch (err) {
      sampleViaRawToken = [`list_failed: ${err instanceof Error ? err.message : "unknown"}`];
    }
  }

  return NextResponse.json({
    provider: health.provider,
    configured: health.configured,
    authMode: health.authMode,
    storeConfigured: health.storeConfigured,
    sample,
    diag: {
      hasReadWriteTokenEnv,
      hasOidcTokenEnv,
      hasStoreIdEnv,
      genusFileStorageFlag,
      vercelRuntimeFlag,
      sampleViaRawToken,
    },
  });
}
