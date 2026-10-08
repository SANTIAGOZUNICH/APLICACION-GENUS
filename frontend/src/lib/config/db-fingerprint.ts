/** Huella no reversible de una base Postgres (sin `server-only`: la usan también scripts locales). */
import { createHash } from "node:crypto";

/**
 * host/base de una URL Postgres → 12 hex de sha256 (null si falta o no es URL). El host pooled de Neon
 * (`ep-x-pooler.…`) y el directo (`ep-x.…`) dan la MISMA huella: son la misma base.
 */
export function databaseFingerprint(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^([^.]+)-pooler\./, "$1.");
    return createHash("sha256").update(`${host}/${u.pathname.replace(/^\//, "")}`).digest("hex").slice(0, 12);
  } catch {
    return null;
  }
}
