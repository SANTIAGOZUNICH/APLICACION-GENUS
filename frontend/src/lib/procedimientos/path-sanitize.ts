/** Bloquea traversal y caracteres inválidos en rutas relativas. */
const INVALID_PATH_SEGMENT = /^(?:\.\.?|)$/;

const INVALID_CHARS = /[<>:"|?*\x00-\x1f]/;

export function sanitizePathSegment(segment: string): string {
  const trimmed = segment.trim().replace(/\\/g, "/");
  if (!trimmed || INVALID_PATH_SEGMENT.test(trimmed)) {
    throw new Error(`Segmento de ruta inválido: ${segment}`);
  }
  if (trimmed.includes("/") || trimmed.includes("..")) {
    throw new Error(`Segmento de ruta inválido: ${segment}`);
  }
  if (INVALID_CHARS.test(trimmed)) {
    throw new Error(`Caracteres inválidos en: ${segment}`);
  }
  return trimmed.slice(0, 200);
}

export function sanitizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error("Ruta con traversal no permitida.");
  }
  const parts = normalized.split("/").filter(Boolean);
  return parts.map(sanitizePathSegment).join("/");
}

export function joinRelativePath(base: string, segment: string): string {
  const clean = sanitizePathSegment(segment);
  const baseClean = base ? sanitizeRelativePath(base) : "";
  return baseClean ? `${baseClean}/${clean}` : clean;
}

export function isPathSafe(relativePath: string): boolean {
  try {
    sanitizeRelativePath(relativePath);
    return true;
  } catch {
    return false;
  }
}
