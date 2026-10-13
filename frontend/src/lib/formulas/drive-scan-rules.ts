/**
 * Diagnóstico de la conexión con Google Drive — reglas PURAS (sin Google, testeables).
 *
 * Reproduce EXACTAMENTE lo que hace el índice de fórmulas (drive-formulas-index.ts) para explicar por qué un archivo
 * que existe en Drive no aparece en GENUS OS:
 *  - raíz configurada → subcarpetas de primer nivel = CLIENTES → hojas DIRECTAMENTE dentro de cada cliente;
 *  - tipos reconocidos: Google Sheets, .xlsx y .xls (no .xlsm, .xlsb, .ods, .csv);
 *  - accesos directos (shortcuts) no se siguen;
 *  - si un cliente tiene dos archivos con el mismo producto, se usa el modificado más recientemente;
 *  - si la raíz tiene subcarpetas, las hojas sueltas en la raíz no se leen.
 * No inventa causas: lo que no se puede ver (archivos no compartidos con la cuenta) se informa como tal.
 */
import { deriveProductFromFilename, normalizeSearchKey } from "./types";

export const MIME_FOLDER = "application/vnd.google-apps.folder";
export const MIME_SHORTCUT = "application/vnd.google-apps.shortcut";
export const MIME_GSHEET = "application/vnd.google-apps.spreadsheet";
export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MIME_XLS = "application/vnd.ms-excel";

/** Tipos que el índice lee. */
export const INDEXED_SHEET_MIMES = new Set([MIME_GSHEET, MIME_XLSX, MIME_XLS]);

/** Planillas que existen pero el índice NO lee (formato no reconocido). */
const UNSUPPORTED_SHEET_MIMES = new Set([
  "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // .xlsb
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  "text/csv",
]);
const UNSUPPORTED_EXT = /\.(xlsm|xlsb|ods|csv)$/i;

export type ScanItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  /** Nombres de carpeta desde la raíz configurada (vacío = está en la raíz). */
  path: string[];
  /** Solo accesos directos: tipo del destino. */
  shortcutTargetMime?: string | null;
};

export type OmitReason = "ROOT_FILE" | "NESTED" | "UNSUPPORTED_TYPE" | "SHORTCUT" | "SUPERSEDED";

export const OMIT_REASON_TEXT: Record<OmitReason, string> = {
  ROOT_FILE: "Está suelto en la carpeta raíz: el índice solo lee hojas dentro de una carpeta de cliente.",
  NESTED: "Está dentro de una subcarpeta de la carpeta del cliente: el índice no busca en subcarpetas.",
  UNSUPPORTED_TYPE: "Formato no reconocido por el índice (solo Google Sheets, .xlsx y .xls).",
  SHORTCUT: "Es un acceso directo: el índice no sigue accesos directos.",
  SUPERSEDED: "Hay otro archivo del mismo producto en ese cliente modificado más recientemente: se usa ese.",
};

export type IndexedFile = { id: string; client: string; name: string; productLabel: string; modifiedTime: string | null; mimeType: string };
export type OmittedFile = { id: string; name: string; path: string; reason: OmitReason; detail?: string };

export type ScanClassification = {
  clients: Array<{ name: string; indexedFiles: number }>;
  indexed: IndexedFile[];
  omitted: OmittedFile[];
  /** Archivos que no son planillas (PDF, documentos, imágenes…): no se listan, solo se cuentan. */
  otherFiles: number;
};

const isSheetLike = (it: ScanItem) => INDEXED_SHEET_MIMES.has(it.mimeType) || UNSUPPORTED_SHEET_MIMES.has(it.mimeType) || UNSUPPORTED_EXT.test(it.name);

/** Clasifica todo lo que la cuenta ve dentro de la raíz configurada, igual que el índice. */
export function classifyDriveScan(items: ScanItem[]): ScanClassification {
  const rootHasSubfolders = items.some((it) => it.mimeType === MIME_FOLDER && it.path.length === 0);
  const omitted: OmittedFile[] = [];
  let otherFiles = 0;
  const candidatesByClient = new Map<string, IndexedFile[]>();
  const clientNames = items.filter((it) => it.mimeType === MIME_FOLDER && it.path.length === 0).map((it) => it.name);

  for (const it of items) {
    if (it.mimeType === MIME_FOLDER) continue;
    const pathText = it.path.join(" / ") || "(raíz)";
    if (it.mimeType === MIME_SHORTCUT) {
      const target = it.shortcutTargetMime ?? "";
      if (target === MIME_FOLDER || INDEXED_SHEET_MIMES.has(target) || UNSUPPORTED_SHEET_MIMES.has(target)) {
        omitted.push({ id: it.id, name: it.name, path: pathText, reason: "SHORTCUT", detail: target === MIME_FOLDER ? "Acceso directo a una carpeta" : "Acceso directo a una planilla" });
      } else {
        otherFiles += 1;
      }
      continue;
    }
    if (!isSheetLike(it)) {
      otherFiles += 1;
      continue;
    }
    if (!INDEXED_SHEET_MIMES.has(it.mimeType)) {
      omitted.push({ id: it.id, name: it.name, path: pathText, reason: "UNSUPPORTED_TYPE" });
      continue;
    }
    // Ubicación: raíz, carpeta de cliente (nivel 1) o más adentro.
    if (it.path.length === 0) {
      if (rootHasSubfolders) {
        omitted.push({ id: it.id, name: it.name, path: pathText, reason: "ROOT_FILE" });
        continue;
      }
      pushCandidate(candidatesByClient, "SIN_CLIENTE", it);
      continue;
    }
    if (it.path.length > 1) {
      omitted.push({ id: it.id, name: it.name, path: pathText, reason: "NESTED" });
      continue;
    }
    pushCandidate(candidatesByClient, it.path[0]!, it);
  }

  // Igual que el índice: por cliente, un archivo por producto (el más reciente; empate → el último listado).
  const indexed: IndexedFile[] = [];
  for (const [, files] of candidatesByClient) {
    const byLabel = new Map<string, IndexedFile>();
    for (const f of files) {
      const key = normalizeSearchKey(f.productLabel);
      const prev = byLabel.get(key);
      if (!prev) {
        byLabel.set(key, f);
        continue;
      }
      const prevT = prev.modifiedTime ? Date.parse(prev.modifiedTime) : 0;
      const nextT = f.modifiedTime ? Date.parse(f.modifiedTime) : 0;
      const [keep, drop] = nextT >= prevT ? [f, prev] : [prev, f];
      byLabel.set(key, keep);
      omitted.push({ id: drop.id, name: drop.name, path: drop.client, reason: "SUPERSEDED", detail: `Se usa «${keep.name}»` });
    }
    indexed.push(...byLabel.values());
  }

  const counts = new Map<string, number>();
  for (const f of indexed) counts.set(f.client, (counts.get(f.client) ?? 0) + 1);
  const clients = clientNames
    .map((name) => ({ name, indexedFiles: counts.get(name) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

  return { clients, indexed, omitted, otherFiles };
}

function pushCandidate(map: Map<string, IndexedFile[]>, client: string, it: ScanItem) {
  const productLabel = deriveProductFromFilename(it.name, client) || it.name.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
  const list = map.get(client) ?? [];
  list.push({ id: it.id, client, name: it.name, productLabel, modifiedTime: it.modifiedTime, mimeType: it.mimeType });
  map.set(client, list);
}

// ---------------------------------------------------------------------------------------------------------------
// Comparación Drive ↔ banco de fórmulas (Neon)

export type BankLookup =
  | { kind: "found" }
  | { kind: "conflict"; message?: string }
  | { kind: "not_found"; reason?: string; message?: string };

export type ComparisonStatus = "EN_AMBOS" | "SOLO_DRIVE" | "SOLO_BANCO" | "CONFLICTO_BANCO" | "AMBIGUA_BANCO" | "REVISION_BANCO";

export const COMPARISON_TEXT: Record<ComparisonStatus, string> = {
  EN_AMBOS: "Disponible: está en el banco y en Drive.",
  SOLO_DRIVE: "Solo en Drive: no está en el banco; la OE la lee de Drive si el nombre coincide exacto.",
  SOLO_BANCO: "Solo en el banco: no aparece en la carpeta de Drive configurada (la OE la toma igual del banco).",
  CONFLICTO_BANCO: "Conflicto de versiones en el banco: la OE no elige ninguna hasta que se resuelva.",
  AMBIGUA_BANCO: "Ambigua en el banco: hay más de una fórmula que coincide.",
  REVISION_BANCO: "En el banco, pero pendiente de revisión: no se usa en OE.",
};

export type ComparisonRow = { client: string; product: string; status: ComparisonStatus; detail?: string };

export function compareDriveWithBank(args: {
  indexed: IndexedFile[];
  bankOptions: Array<{ client: string; productLabel: string; aliases: string[] }>;
  lookup: (client: string, product: string) => BankLookup;
}): { rows: ComparisonRow[]; counts: Record<ComparisonStatus, number> } {
  const rows: ComparisonRow[] = [];
  const driveKeys = new Set<string>();
  for (const f of args.indexed) {
    const client = f.client === "SIN_CLIENTE" ? "" : f.client;
    driveKeys.add(`${normalizeSearchKey(client)}||${normalizeSearchKey(f.productLabel)}`);
    const r = args.lookup(client, f.productLabel);
    let status: ComparisonStatus;
    if (r.kind === "found") status = "EN_AMBOS";
    else if (r.kind === "conflict") status = "CONFLICTO_BANCO";
    else if (r.reason === "ambiguous") status = "AMBIGUA_BANCO";
    else if (r.reason === "review_required") status = "REVISION_BANCO";
    else status = "SOLO_DRIVE";
    rows.push({ client: f.client, product: f.productLabel, status });
  }
  for (const o of args.bankOptions) {
    const keys = [o.productLabel, ...o.aliases].map((p) => `${normalizeSearchKey(o.client)}||${normalizeSearchKey(p)}`);
    if (keys.some((k) => driveKeys.has(k))) continue;
    rows.push({ client: o.client, product: o.productLabel, status: "SOLO_BANCO" });
  }
  const counts = { EN_AMBOS: 0, SOLO_DRIVE: 0, SOLO_BANCO: 0, CONFLICTO_BANCO: 0, AMBIGUA_BANCO: 0, REVISION_BANCO: 0 } as Record<ComparisonStatus, number>;
  for (const r of rows) counts[r.status] += 1;
  rows.sort((a, b) => a.client.localeCompare(b.client, "es", { sensitivity: "base" }) || a.product.localeCompare(b.product, "es", { sensitivity: "base" }));
  return { rows, counts };
}

/** Error de la API de Drive → estado legible (sin detalles internos). */
export function describeDriveAccessError(code: number | null | undefined): { status: "SIN_PERMISO" | "NO_ENCONTRADA" | "ERROR"; message: string } {
  if (code === 403) return { status: "SIN_PERMISO", message: "La cuenta de servicio no tiene permiso para ver la carpeta configurada." };
  if (code === 404) {
    return {
      status: "NO_ENCONTRADA",
      message: "Drive no encuentra la carpeta configurada para esta cuenta: o el ID es incorrecto, o la carpeta no está compartida con la cuenta de servicio (Drive responde igual en los dos casos).",
    };
  }
  return { status: "ERROR", message: "No se pudo consultar Google Drive (error de conexión o del servicio). Reintentá en unos minutos." };
}
