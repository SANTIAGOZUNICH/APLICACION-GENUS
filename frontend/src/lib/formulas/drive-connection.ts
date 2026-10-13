/**
 * «Conexión con Google Drive» — diagnóstico de SOLO LECTURA de la carpeta de fórmulas.
 *
 * Qué consulta (todo con el scope drive.readonly de la cuenta de servicio):
 *  - metadatos de la carpeta configurada (nombre, unidad compartida o «Mi unidad»);
 *  - el árbol completo debajo de la raíz (hasta MAX_DEPTH niveles), para explicar qué lee el índice y qué no;
 *  - las unidades compartidas de las que la cuenta es miembro;
 *  - planillas que la cuenta ve FUERA de la carpeta configurada (posibles fórmulas en otro lugar).
 * Nunca escribe, mueve ni borra nada en Drive, ni cambia el banco de fórmulas. Nunca devuelve la clave privada.
 * Lo que no está compartido con la cuenta no se puede ver ni contar: se informa como límite, no se adivina.
 */
import "server-only";

import { google, type drive_v3 } from "googleapis";
import { createGoogleAuth, hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { getServiceAccountEmailSafe, resolveFormulasFolderId } from "./drive-formulas-diagnose";
import {
  classifyDriveScan,
  compareDriveWithBank,
  describeDriveAccessError,
  INDEXED_SHEET_MIMES,
  MIME_FOLDER,
  MIME_SHORTCUT,
  OMIT_REASON_TEXT,
  type ComparisonRow,
  type ComparisonStatus,
  type OmittedFile,
  type ScanItem,
} from "./drive-scan-rules";

const MAX_DEPTH = 6;
const MAX_FOLDERS = 600;
const MAX_OUTSIDE = 2000;
const LIST_LIMIT = 300;

export type DriveConnectionStatus =
  | "OK"
  | "SIN_CREDENCIALES"
  | "SIN_CARPETA"
  | "SIN_PERMISO"
  | "NO_ENCONTRADA"
  | "ERROR";

export type DriveConnectionCheck = {
  status: DriveConnectionStatus;
  message: string;
  serviceAccountEmail: string | null;
  folder: {
    envKey: string | null;
    id: string | null;
    name: string | null;
    url: string | null;
    /** «Unidad compartida «X»» o «Mi unidad (de quien la compartió)». */
    driveLabel: string | null;
    sharedDriveId: string | null;
  };
  index: { builtAt: string | null; entryCount: number | null; clientCount: number | null; ttlMinutes: number; note: string };
  checkedAt: string;
};

export type DriveConnectionReport = DriveConnectionCheck & {
  scan: {
    clients: Array<{ name: string; indexedFiles: number }>;
    indexedCount: number;
    omitted: Array<Omit<OmittedFile, "id"> & { reasonText: string; url: string }>;
    omittedCounts: Record<string, number>;
    otherFiles: number;
    foldersVisited: number;
    truncated: boolean;
    folderErrors: string[];
  } | null;
  outside: {
    sharedDrives: Array<{ name: string; containsRoot: boolean }>;
    sheetsOutsideRoot: Array<{ name: string; url: string }>;
    sheetsOutsideRootCount: number;
    truncated: boolean;
    error: string | null;
  } | null;
  bank: {
    counts: Record<ComparisonStatus, number>;
    rows: ComparisonRow[];
    truncated: boolean;
    error: string | null;
  } | null;
  limits: string[];
};

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
const fileUrl = (id: string) => `https://drive.google.com/open?id=${id}`;
const apiCode = (err: unknown): number | null => {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  const c = Number(e?.code ?? e?.status ?? e?.response?.status);
  return Number.isFinite(c) ? c : null;
};

async function indexState(): Promise<DriveConnectionCheck["index"]> {
  const { peekDriveFormulasIndex } = await import("./drive-formulas-index");
  const s = peekDriveFormulasIndex();
  return {
    builtAt: s?.builtAt ?? null,
    entryCount: s?.entryCount ?? null,
    clientCount: s?.clientCount ?? null,
    ttlMinutes: 10,
    note: "El índice vive en la memoria del servidor y se rehace cada 10 minutos o con «Actualizar índice». Cada instancia del servidor tiene el suyo.",
  };
}

/** «Verificar conexión»: credenciales, carpeta configurada, acceso y unidad. Rápido. */
export async function checkDriveConnection(): Promise<DriveConnectionCheck & { drive?: drive_v3.Drive }> {
  const { folderId, envKey } = resolveFormulasFolderId();
  const base: DriveConnectionCheck = {
    status: "OK",
    message: "",
    serviceAccountEmail: getServiceAccountEmailSafe(),
    folder: { envKey, id: folderId, name: null, url: folderId ? folderUrl(folderId) : null, driveLabel: null, sharedDriveId: null },
    index: await indexState(),
    checkedAt: new Date().toISOString(),
  };
  if (!hasGoogleCredentials()) {
    return { ...base, status: "SIN_CREDENCIALES", message: "No hay credenciales de la cuenta de servicio de Google configuradas en el servidor." };
  }
  if (!folderId) {
    return { ...base, status: "SIN_CARPETA", message: "No hay carpeta de fórmulas configurada (GOOGLE_DRIVE_FORMULAS_FOLDER_ID)." };
  }
  const drive = google.drive({ version: "v3", auth: createGoogleAuth() });
  try {
    const res = await drive.files.get({ fileId: folderId, fields: "id,name,mimeType,driveId", supportsAllDrives: true });
    let driveLabel = "Mi unidad (de la persona que compartió la carpeta con la cuenta)";
    const sharedDriveId = res.data.driveId ?? null;
    if (sharedDriveId) {
      try {
        const d = await drive.drives.get({ driveId: sharedDriveId, fields: "id,name" });
        driveLabel = `Unidad compartida «${d.data.name ?? sharedDriveId}»`;
      } catch {
        driveLabel = "Unidad compartida (la cuenta no puede leer su nombre)";
      }
    }
    if (res.data.mimeType && res.data.mimeType !== MIME_FOLDER) {
      return {
        ...base,
        drive,
        status: "ERROR",
        message: "El ID configurado no corresponde a una carpeta.",
        folder: { ...base.folder, name: res.data.name ?? null, driveLabel, sharedDriveId },
      };
    }
    return {
      ...base,
      drive,
      status: "OK",
      message: "La cuenta de servicio puede leer la carpeta de fórmulas.",
      folder: { ...base.folder, name: res.data.name ?? null, driveLabel, sharedDriveId },
    };
  } catch (err) {
    const d = describeDriveAccessError(apiCode(err));
    return { ...base, drive, status: d.status, message: d.message };
  }
}

async function listChildren(drive: drive_v3.Drive, folderId: string): Promise<drive_v3.Schema$File[]> {
  const out: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,shortcutDetails(targetMimeType))",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    out.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

/** Recorre todo lo que hay debajo de la raíz (BFS). Un error en una carpeta no corta el resto. */
async function scanTree(drive: drive_v3.Drive, rootId: string) {
  const items: ScanItem[] = [];
  const visited = new Set<string>([rootId]);
  const folderErrors: string[] = [];
  let truncated = false;
  const queue: Array<{ id: string; path: string[] }> = [{ id: rootId, path: [] }];
  while (queue.length) {
    const { id, path } = queue.shift()!;
    let children: drive_v3.Schema$File[];
    try {
      children = await listChildren(drive, id);
    } catch (err) {
      folderErrors.push(`No se pudo listar «${path.join(" / ") || "(raíz)"}» (${describeDriveAccessError(apiCode(err)).status}).`);
      continue;
    }
    for (const c of children) {
      if (!c.id || !c.name || !c.mimeType) continue;
      items.push({ id: c.id, name: c.name, mimeType: c.mimeType, modifiedTime: c.modifiedTime ?? null, path, shortcutTargetMime: c.shortcutDetails?.targetMimeType ?? null });
      if (c.mimeType === MIME_FOLDER && !visited.has(c.id)) {
        if (path.length + 1 >= MAX_DEPTH || visited.size >= MAX_FOLDERS) {
          truncated = true;
          continue;
        }
        visited.add(c.id);
        queue.push({ id: c.id, path: [...path, c.name] });
      }
    }
  }
  return { items, visited, folderErrors, truncated };
}

/** Planillas visibles para la cuenta fuera de la carpeta configurada + unidades compartidas de las que es miembro. */
async function scanOutside(drive: drive_v3.Drive, insideFolders: Set<string>, rootDriveId: string | null): Promise<NonNullable<DriveConnectionReport["outside"]>> {
  const sharedDrives: Array<{ name: string; containsRoot: boolean }> = [];
  try {
    let pageToken: string | undefined;
    do {
      const r = await drive.drives.list({ pageSize: 100, pageToken, fields: "nextPageToken, drives(id,name)" });
      for (const d of r.data.drives ?? []) sharedDrives.push({ name: d.name ?? "(sin nombre)", containsRoot: Boolean(rootDriveId && d.id === rootDriveId) });
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch {
    /* sin unidades compartidas visibles */
  }
  const sheets: Array<{ name: string; url: string }> = [];
  let count = 0;
  let truncated = false;
  try {
    const mimeQ = [...INDEXED_SHEET_MIMES].map((m) => `mimeType='${m}'`).join(" or ");
    let pageToken: string | undefined;
    let seen = 0;
    do {
      const r = await drive.files.list({
        q: `(${mimeQ}) and trashed=false`,
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        pageSize: 1000,
        pageToken,
        fields: "nextPageToken, files(id,name,parents)",
      });
      for (const f of r.data.files ?? []) {
        seen += 1;
        if (!f.id || !f.name) continue;
        const inside = (f.parents ?? []).some((p) => insideFolders.has(p));
        if (inside) continue;
        count += 1;
        if (sheets.length < LIST_LIMIT) sheets.push({ name: f.name, url: fileUrl(f.id) });
      }
      pageToken = r.data.nextPageToken ?? undefined;
      if (seen >= MAX_OUTSIDE && pageToken) {
        truncated = true;
        break;
      }
    } while (pageToken);
  } catch (err) {
    return { sharedDrives, sheetsOutsideRoot: sheets, sheetsOutsideRootCount: count, truncated, error: `No se pudieron buscar planillas fuera de la carpeta (${describeDriveAccessError(apiCode(err)).status}).` };
  }
  return { sharedDrives, sheetsOutsideRoot: sheets, sheetsOutsideRootCount: count, truncated, error: null };
}

async function compareBank(indexed: ReturnType<typeof classifyDriveScan>["indexed"]): Promise<NonNullable<DriveConnectionReport["bank"]>> {
  try {
    const { readyFormulaBank } = await import("./get-formula-bank");
    const bank = await readyFormulaBank();
    const cmp = compareDriveWithBank({
      indexed,
      bankOptions: bank.listActiveOptions(),
      lookup: (client, product) => {
        const r = bank.resolveLookup(client, product);
        return r.kind === "found" ? { kind: "found" } : r.kind === "conflict" ? { kind: "conflict", message: r.message } : { kind: "not_found", reason: r.reason, message: r.message };
      },
    });
    const problems = cmp.rows.filter((r) => r.status !== "EN_AMBOS");
    return { counts: cmp.counts, rows: problems.slice(0, LIST_LIMIT), truncated: problems.length > LIST_LIMIT, error: null };
  } catch {
    return {
      counts: { EN_AMBOS: 0, SOLO_DRIVE: 0, SOLO_BANCO: 0, CONFLICTO_BANCO: 0, AMBIGUA_BANCO: 0, REVISION_BANCO: 0 },
      rows: [],
      truncated: false,
      error: "No se pudo consultar el banco de fórmulas.",
    };
  }
}

/** Diagnóstico completo (solo lectura). `refreshIndex` además rehace el índice en memoria (no toca Drive ni el banco). */
export async function diagnoseDriveConnection(opts: { refreshIndex?: boolean } = {}): Promise<DriveConnectionReport> {
  const limits = [
    "Solo se puede ver lo que está compartido con la cuenta de servicio. Un archivo o carpeta no compartido con ella no aparece ni se puede contar desde GENUS OS.",
    "La búsqueda fuera de la carpeta solo encuentra planillas visibles para la cuenta (compartidas con ella o en unidades compartidas de las que es miembro).",
  ];
  const check = await checkDriveConnection();
  const { drive, ...pub } = check;
  if (check.status !== "OK" || !drive || !check.folder.id) {
    return { ...pub, scan: null, outside: null, bank: null, limits };
  }
  if (opts.refreshIndex) {
    const { syncDriveFormulasIndex } = await import("./drive-formulas-index");
    await syncDriveFormulasIndex(true);
    pub.index = await indexState();
  }
  const tree = await scanTree(drive, check.folder.id);
  const cls = classifyDriveScan(tree.items);
  const omittedCounts: Record<string, number> = {};
  for (const o of cls.omitted) omittedCounts[o.reason] = (omittedCounts[o.reason] ?? 0) + 1;
  const [outside, bank] = await Promise.all([scanOutside(drive, tree.visited, check.folder.sharedDriveId), compareBank(cls.indexed)]);
  return {
    ...pub,
    scan: {
      clients: cls.clients,
      indexedCount: cls.indexed.length,
      omitted: cls.omitted.slice(0, LIST_LIMIT).map(({ id, ...o }) => ({ ...o, reasonText: OMIT_REASON_TEXT[o.reason], url: fileUrl(id) })),
      omittedCounts,
      otherFiles: cls.otherFiles,
      foldersVisited: tree.visited.size,
      truncated: tree.truncated || cls.omitted.length > LIST_LIMIT,
      folderErrors: tree.folderErrors,
    },
    outside,
    bank,
    limits,
  };
}

void MIME_SHORTCUT;
