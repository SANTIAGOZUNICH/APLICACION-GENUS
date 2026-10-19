/**
 * Preparación en el navegador de las fotos de remitos (tablets Android incluidas) antes de subirlas.
 * - Respeta la orientación EXIF (si no, el remito sale girado y la lectura automática falla).
 * - Achica en pasos (calidad y tamaño) hasta entrar con holgura en el límite del servidor: Vercel corta el cuerpo de la
 *   petición cerca de 4,5 MB, así que apuntamos a ≤ TARGET_BYTES y no a 4 MB justos.
 * - Si el navegador no puede leer el formato (p. ej. HEIC fuera de Safari) devuelve el archivo tal cual.
 */

export const RECEIPT_TARGET_BYTES = 3.2 * 1024 * 1024;

export type ShrinkStep = { maxSide: number; quality: number };

/** Pasos de reducción progresivos (de mejor a peor calidad). Función pura, probada. */
export const SHRINK_STEPS: readonly ShrinkStep[] = [
  { maxSide: 2400, quality: 0.85 },
  { maxSide: 2400, quality: 0.7 },
  { maxSide: 2000, quality: 0.7 },
  { maxSide: 1600, quality: 0.6 },
  { maxSide: 1280, quality: 0.55 },
];

export function scaleFor(width: number, height: number, maxSide: number): number {
  const longest = Math.max(width, height);
  return longest > 0 ? Math.min(1, maxSide / longest) : 1;
}

/** ¿Hace falta recomprimir? Los JPG/PNG chicos y los PDF van tal cual. */
export function needsShrink(file: { type: string; name: string; size: number }): boolean {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return false;
  const smallImage = file.size <= 1.5 * 1024 * 1024 && (file.type === "image/jpeg" || file.type === "image/png");
  return !smallImage;
}

async function decode(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      return null;
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function prepareReceiptImage(file: File, targetBytes = RECEIPT_TARGET_BYTES): Promise<File> {
  if (!needsShrink(file)) return file;
  const bmp = await decode(file);
  if (!bmp) return file;
  try {
    let best: Blob | null = null;
    for (const step of SHRINK_STEPS) {
      const scale = scaleFor(bmp.width, bmp.height, step.maxSide);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, step.quality);
      if (!blob) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= targetBytes) break;
    }
    if (!best || (best.size >= file.size && file.size <= targetBytes)) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "remito";
    return new File([best], `${base}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bmp.close?.();
  }
}

/** Reintenta fallas de red / 5xx con espera creciente (la subida del mismo archivo es idempotente por hash en el servidor). */
export async function withRetry<T>(fn: () => Promise<T>, opts: { tries?: number; baseMs?: number; retryable?: (e: unknown) => boolean } = {}): Promise<T> {
  const tries = opts.tries ?? 3;
  const retryable = opts.retryable ?? (() => true);
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === tries - 1 || !retryable(e)) break;
      await new Promise((r) => setTimeout(r, (opts.baseMs ?? 800) * 2 ** i));
    }
  }
  throw last;
}
