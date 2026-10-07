/** Cliente HTTP de la carga asistida de ingresos ME desde remito. */

import type {
  ConfirmInput,
  ConfirmResult,
  RemitoDuplicateInfo,
  RemitoPreview,
} from "@/lib/inventory/remito-ai/remito-ingreso-service";
import { actorHeaders, InventoryClientError } from "./inventory-client";

export type { ConfirmInput, ConfirmResult, RemitoDuplicateInfo, RemitoPreview };

/** Vercel limita el body de una función a 4,5 MB. */
export const REMITO_UPLOAD_LIMIT_BYTES = 4_300_000;

export class RemitoClientError extends InventoryClientError {
  duplicate?: RemitoDuplicateInfo;
  constructor(message: string, status: number, code: string, duplicate?: RemitoDuplicateInfo) {
    super(message, status, code);
    this.duplicate = duplicate;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: string;
    code?: string;
    duplicate?: RemitoDuplicateInfo;
  };
  if (!res.ok) {
    throw new RemitoClientError(json.error ?? "Operación rechazada", res.status, json.code ?? "ERROR", json.duplicate);
  }
  return json.data as T;
}

export async function analyzeRemito(files: File[]): Promise<RemitoPreview> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const headers = { ...(actorHeaders() as Record<string, string>) };
  delete headers["Content-Type"]; // multipart: el navegador define el boundary
  const res = await fetch("/api/v1/inventory/remito-ai/analyze", { method: "POST", headers, body: form });
  return parse<RemitoPreview>(res);
}

export async function confirmRemito(body: ConfirmInput): Promise<ConfirmResult> {
  const res = await fetch("/api/v1/inventory/remito-ai/confirm", {
    method: "POST",
    headers: actorHeaders(),
    body: JSON.stringify(body),
  });
  return parse<ConfirmResult>(res);
}

export function remitoDocumentUrl(docId: string, index = 0): string {
  return `/api/v1/inventory/remito-ai/document?docId=${encodeURIComponent(docId)}&i=${index}`;
}

/** Reduce fotos de celular (varios MB) a JPEG ~0,3-0,8 MB para entrar en el límite de subida. */
export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    for (const [maxSide, quality] of [
      [2000, 0.82],
      [1600, 0.72],
      [1280, 0.65],
    ] as const) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= 1_400_000) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      }
      if (blob && maxSide === 1280) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
  } catch {
    /* sin createImageBitmap: se sube tal cual y el servidor valida el tamaño */
  }
  return file;
}
