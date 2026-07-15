/**
 * @mock-temp Repositorio demo de archivos de OE/OA — localStorage, desacoplado de la UI.
 * Reemplazar por Google Drive (carpeta OE/OA) cuando exista escritura real desde backend.
 * No escribe a Sheets/Drive directamente desde React — es una capa de adapter aislada.
 */

export type OrderDocumentKind = "OE" | "OA";

export interface OrderDocument {
  id: string;
  kind: OrderDocumentKind;
  /** Número de OE u OA al que pertenece el archivo (ej. "OE-2026-0142"). */
  ref: string;
  fileName: string;
  fileType: string;
  /** Contenido en data URL — solo para demo; no apto para archivos grandes. */
  fileDataUrl: string;
  uploadedBy: string;
  uploadedAt: string;
  linkedWorkItemId?: string | null;
}

const STORAGE_KEY = "genus_os_order_documents";
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // 4MB — límite razonable para demo en localStorage.

function readAll(): OrderDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as OrderDocument[];
  } catch {
    return [];
  }
}

function writeAll(items: OrderDocument[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listDocumentsByKind(kind: OrderDocumentKind): OrderDocument[] {
  return readAll()
    .filter((d) => d.kind === kind)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

export function getLatestDocumentByRef(ref: string | null | undefined): OrderDocument | null {
  if (!ref) return null;
  const docs = readAll()
    .filter((d) => d.ref === ref)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  return docs[0] ?? null;
}

export function listDocumentsByRef(ref: string): OrderDocument[] {
  return readAll()
    .filter((d) => d.ref === ref)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

export function saveDocument(input: {
  kind: OrderDocumentKind;
  ref: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  uploadedBy: string;
  linkedWorkItemId?: string | null;
}): OrderDocument {
  const doc: OrderDocument = {
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    ref: input.ref,
    fileName: input.fileName,
    fileType: input.fileType,
    fileDataUrl: input.fileDataUrl,
    uploadedBy: input.uploadedBy,
    uploadedAt: new Date().toISOString(),
    linkedWorkItemId: input.linkedWorkItemId ?? null,
  };
  const items = [doc, ...readAll()];
  writeAll(items);
  return doc;
}

export function removeDocument(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
