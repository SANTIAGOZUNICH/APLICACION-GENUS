/**
 * @mock-temp Repositorio demo de archivos de OE/OA — localStorage, desacoplado de la UI.
 * Reemplazar por Google Drive (carpeta OE/OA) cuando exista escritura real desde backend.
 * No escribe a Sheets/Drive directamente desde React — es una capa de adapter aislada.
 */

import type { SectorId } from "@/types/operational/sector";
import {
  gateOrderDocumentAction,
  type OrderDocumentKind,
} from "../lib/order-documents-rbac";

export type { OrderDocumentKind } from "../lib/order-documents-rbac";

export interface OrderDocument {
  id: string;
  kind: OrderDocumentKind;
  /** Número de OE u OA al que pertenece el archivo (ej. "OE-2026-0142"). */
  ref: string;
  producto?: string;
  codigo?: string;
  cliente?: string;
  lote?: string;
  fecha?: string;
  observaciones?: string;
  fileName: string;
  fileType: string;
  /**
   * Contenido en data URL — solo para demo localStorage.
   * Mantener bajo MAX_DOCUMENT_BYTES; no es almacenamiento Drive/multiusuario.
   */
  fileDataUrl: string;
  uploadedBy: string;
  uploadedAt: string;
  version: number;
  sectorUploaded?: string;
  previousVersionId?: string | null;
  linkedWorkItemId?: string | null;
}

const STORAGE_KEY = "genus_os_order_documents";
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024; // 4MB — límite razonable para demo en localStorage.
export const ALLOWED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
] as const;
export const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".xls",
  ".xlsx",
  ".doc",
  ".docx",
  ".jpg",
  ".jpeg",
  ".png",
] as const;

export type OrderDocumentMutationResult =
  | { ok: true; document: OrderDocument }
  | { ok: false; error: string; code?: string };

type OrderDocumentInput = {
  kind: OrderDocumentKind;
  ref: string;
  producto?: string;
  codigo?: string;
  cliente?: string;
  lote?: string;
  fecha?: string;
  observaciones?: string;
  fileName: string;
  fileType: string;
  fileDataUrl: string;
  uploadedBy: string;
  linkedWorkItemId?: string | null;
  actorSectorId?: SectorId | null;
};

function makeDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function migrateRecord(raw: unknown): OrderDocument {
  const record = (raw ?? {}) as Record<string, unknown>;
  const uploadedAt = asString(record.uploadedAt) ?? new Date().toISOString();
  return {
    id: asString(record.id) ?? makeDocumentId(),
    kind: record.kind === "OA" ? "OA" : "OE",
    ref: asString(record.ref) ?? "",
    producto: asString(record.producto),
    codigo: asString(record.codigo),
    cliente: asString(record.cliente),
    lote: asString(record.lote),
    fecha: asString(record.fecha),
    observaciones: asString(record.observaciones),
    fileName: asString(record.fileName) ?? "documento",
    fileType: asString(record.fileType) ?? "application/octet-stream",
    fileDataUrl: asString(record.fileDataUrl) ?? "",
    uploadedBy: asString(record.uploadedBy) ?? "Demo",
    uploadedAt,
    version:
      typeof record.version === "number" && Number.isFinite(record.version) && record.version > 0
        ? Math.trunc(record.version)
        : 0,
    sectorUploaded: asString(record.sectorUploaded),
    previousVersionId:
      typeof record.previousVersionId === "string" ? record.previousVersionId : null,
    linkedWorkItemId:
      typeof record.linkedWorkItemId === "string" ? record.linkedWorkItemId : null,
  };
}

function migrateRecords(rawRecords: unknown[]): OrderDocument[] {
  const migrated = rawRecords.map(migrateRecord);
  const groups = new Map<string, OrderDocument[]>();
  for (const doc of migrated) {
    const key = `${doc.kind}:${doc.ref}`;
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
    let lastVersion = 0;
    for (const doc of group) {
      if (doc.version > 0) {
        lastVersion = Math.max(lastVersion, doc.version);
        continue;
      }
      lastVersion += 1;
      doc.version = lastVersion;
    }
  }
  return migrated;
}

function readAll(): OrderDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const migrated = migrateRecords(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) writeAll(migrated);
    return migrated;
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
    .sort(compareLatestFirst);
}

export function getLatestDocumentByRef(ref: string | null | undefined): OrderDocument | null {
  if (!ref) return null;
  const docs = readAll()
    .filter((d) => d.ref === ref)
    .sort(compareLatestFirst);
  return docs[0] ?? null;
}

export function listDocumentsByRef(ref: string): OrderDocument[] {
  return readAll()
    .filter((d) => d.ref === ref)
    .sort(compareLatestFirst);
}

export function listVersionHistory(ref: string): OrderDocument[] {
  return listDocumentsByRef(ref);
}

function compareLatestFirst(a: OrderDocument, b: OrderDocument): number {
  if (b.version !== a.version) return b.version - a.version;
  return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
}

function gateMutation(
  input: Pick<OrderDocumentInput, "kind" | "actorSectorId">,
  action: "upload" | "replace"
): OrderDocumentMutationResult | null {
  const gate = gateOrderDocumentAction(input.kind, action, input.actorSectorId);
  if (!gate.ok) {
    return { ok: false, error: gate.error, code: gate.code };
  }
  return null;
}

function createDocument(
  input: OrderDocumentInput,
  options: { previousVersion?: OrderDocument | null } = {}
): OrderDocument {
  const latest = options.previousVersion ?? getLatestDocumentByRef(input.ref);
  return {
    id: makeDocumentId(),
    kind: input.kind,
    ref: input.ref,
    producto: input.producto,
    codigo: input.codigo,
    cliente: input.cliente,
    lote: input.lote,
    fecha: input.fecha,
    observaciones: input.observaciones,
    fileName: input.fileName,
    fileType: input.fileType,
    fileDataUrl: input.fileDataUrl,
    uploadedBy: input.uploadedBy,
    uploadedAt: new Date().toISOString(),
    version: (latest?.version ?? 0) + 1,
    sectorUploaded: input.actorSectorId ?? undefined,
    previousVersionId: latest?.id ?? null,
    linkedWorkItemId: input.linkedWorkItemId ?? null,
  };
}

export function saveDocument(input: OrderDocumentInput): OrderDocumentMutationResult {
  const denied = gateMutation(input, "upload");
  if (denied) return denied;
  const doc: OrderDocument = {
    ...createDocument(input),
    previousVersionId: null,
  };
  const items = [doc, ...readAll()];
  writeAll(items);
  return { ok: true, document: doc };
}

export function replaceDocument(input: OrderDocumentInput): OrderDocumentMutationResult {
  const denied = gateMutation(input, "replace");
  if (denied) return denied;
  const previousVersion = getLatestDocumentByRef(input.ref);
  const doc = createDocument(input, { previousVersion });
  const items = [doc, ...readAll()];
  writeAll(items);
  return { ok: true, document: doc };
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

export function validateOrderFile(file: File): { ok: true } | { ok: false; error: string } {
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "El archivo supera el tamaño máximo permitido (4 MB) para esta demo." };
  }

  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  const hasAllowedMime =
    file.type === "" || ALLOWED_MIME.includes(file.type as (typeof ALLOWED_MIME)[number]);

  if (!hasAllowedExtension || !hasAllowedMime) {
    return {
      ok: false,
      error: "Formato no permitido. Usá PDF, Excel, Word, JPG o PNG.",
    };
  }

  return { ok: true };
}
