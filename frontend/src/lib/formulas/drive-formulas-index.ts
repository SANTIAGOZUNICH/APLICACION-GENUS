/**
 * Índice de metadata de fórmulas en Google Drive (sin abrir Excel en cada tecla).
 * Fuente de verdad: Drive. Cache en memoria con TTL.
 */
import "server-only";

import { createHash } from "node:crypto";
import { google } from "googleapis";
import { createGoogleAuth } from "@/lib/adapters/google/google-auth";
import {
  GoogleDriveGateway,
  OFFICE_SHEET_MIMES,
} from "@/lib/adapters/drive/google-drive-gateway";
import { deriveProductFromFilename, normalizeSearchKey } from "@/lib/formulas/types";
import { resolveFormulasFolderId } from "@/lib/formulas/drive-formulas-diagnose";
import { parseWorkbookBuffer } from "@/lib/formulas/parse-workbook";
import { emptyOeMaterial } from "@/lib/orders/content";

const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS = "application/vnd.ms-excel";
const GSHEET = "application/vnd.google-apps.spreadsheet";

const TTL_MS = 10 * 60 * 1000;

export type DriveFormulaIndexEntry = {
  fileId: string;
  folderId: string;
  client: string;
  fileName: string;
  productLabel: string;
  mimeType: string;
  modifiedTime: string | null;
  aliases: string[];
  source: "DRIVE";
};

export type DriveFormulaSearchHit = DriveFormulaIndexEntry & {
  rank: "exact_prefix" | "word_prefix" | "contains" | "fuzzy";
  score: number;
};

type IndexState = {
  builtAt: number;
  folderEnvKey: string | null;
  entries: DriveFormulaIndexEntry[];
  clients: string[];
};

let cache: IndexState | null = null;
let building: Promise<IndexState> | null = null;

const RANK_SCORE = {
  exact_prefix: 400,
  word_prefix: 300,
  contains: 200,
  fuzzy: 100,
} as const;

function rankQuery(
  queryNorm: string,
  candidateNorm: string
): DriveFormulaSearchHit["rank"] | null {
  if (!queryNorm || !candidateNorm) return null;
  if (candidateNorm.startsWith(queryNorm)) return "exact_prefix";
  const words = candidateNorm.split(" ").filter(Boolean);
  if (words.some((w) => w.startsWith(queryNorm))) return "word_prefix";
  if (candidateNorm.includes(queryNorm)) return "contains";
  const qTokens = queryNorm.split(" ").filter((t) => t.length >= 2);
  if (qTokens.length && qTokens.every((t) => candidateNorm.includes(t))) {
    return "fuzzy";
  }
  return null;
}

function uniqAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const t = raw.trim();
    if (!t) continue;
    const key = normalizeSearchKey(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export async function syncDriveFormulasIndex(force = false): Promise<{
  ok: boolean;
  entryCount: number;
  clientCount: number;
  folderEnvKey: string | null;
  builtAt: string;
  error?: string;
}> {
  try {
    const state = await ensureIndex(force);
    return {
      ok: true,
      entryCount: state.entries.length,
      clientCount: state.clients.length,
      folderEnvKey: state.folderEnvKey,
      builtAt: new Date(state.builtAt).toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      entryCount: 0,
      clientCount: 0,
      folderEnvKey: resolveFormulasFolderId().envKey,
      builtAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : "Error sync Drive",
    };
  }
}

async function ensureIndex(force = false): Promise<IndexState> {
  if (!force && cache && Date.now() - cache.builtAt < TTL_MS) {
    return cache;
  }
  if (building) return building;
  building = buildIndex()
    .then((state) => {
      cache = state;
      building = null;
      return state;
    })
    .catch((err) => {
      building = null;
      throw err;
    });
  return building;
}

async function buildIndex(): Promise<IndexState> {
  const { folderId, envKey } = resolveFormulasFolderId();
  if (!folderId) {
    throw new Error(
      "Carpeta de fórmulas no configurada (GOOGLE_DRIVE_FORMULAS_FOLDER_ID)."
    );
  }
  const gateway = new GoogleDriveGateway();
  const accessible = await gateway.canAccessFolder(folderId);
  if (!accessible) {
    throw new Error("Sin acceso a la carpeta de fórmulas en Drive.");
  }

  const folders = await gateway.listSubfolders(folderId);
  const entries: DriveFormulaIndexEntry[] = [];

  const clientFolders =
    folders.length > 0
      ? folders
      : [{ folderId, name: "SIN_CLIENTE" }];

  for (const folder of clientFolders) {
    const files = await gateway.listSpreadsheetsInFolder(folder.folderId, {
      alias: "elaboracion",
      folderPath: folder.name,
    });
    // Si hay varios archivos con mismo productLabel, quedarse con modifiedTime más reciente.
    const byLabel = new Map<string, DriveFormulaIndexEntry>();
    for (const file of files) {
      const productLabel =
        deriveProductFromFilename(file.name, folder.name) ||
        file.name.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, "");
      const aliases = uniqAliases([
        productLabel,
        file.name,
        file.name.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, ""),
      ]);
      const entry: DriveFormulaIndexEntry = {
        fileId: file.fileId,
        folderId: folder.folderId,
        client: folder.name,
        fileName: file.name,
        productLabel,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime ?? null,
        aliases,
        source: "DRIVE",
      };
      const key = normalizeSearchKey(productLabel);
      const prev = byLabel.get(key);
      if (!prev) {
        byLabel.set(key, entry);
        continue;
      }
      const prevT = prev.modifiedTime ? Date.parse(prev.modifiedTime) : 0;
      const nextT = entry.modifiedTime ? Date.parse(entry.modifiedTime) : 0;
      if (nextT >= prevT) byLabel.set(key, entry);
    }
    entries.push(...byLabel.values());
  }

  const clients = [
    ...new Set(entries.map((e) => e.client).filter((c) => c && c !== "SIN_CLIENTE")),
  ].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

  return {
    builtAt: Date.now(),
    folderEnvKey: envKey,
    entries,
    clients,
  };
}

export async function searchDriveClients(
  query: string,
  limit = 10
): Promise<Array<{ client: string; rank: DriveFormulaSearchHit["rank"]; source: "DRIVE" }>> {
  const state = await ensureIndex(false);
  const q = normalizeSearchKey(query);
  if (!q) return [];
  const hits: Array<{
    client: string;
    rank: DriveFormulaSearchHit["rank"];
    score: number;
  }> = [];
  for (const client of state.clients) {
    const rank = rankQuery(q, normalizeSearchKey(client));
    if (!rank) continue;
    hits.push({ client, rank, score: RANK_SCORE[rank] });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.client.localeCompare(b.client, "es", { sensitivity: "base" })
  );
  return hits.slice(0, limit).map((h) => ({
    client: h.client,
    rank: h.rank,
    source: "DRIVE" as const,
  }));
}

export async function searchDriveProducts(
  client: string,
  query: string,
  limit = 10
): Promise<DriveFormulaSearchHit[]> {
  const state = await ensureIndex(false);
  const clientNorm = normalizeSearchKey(client);
  const q = normalizeSearchKey(query);
  if (!clientNorm || !q) return [];
  const scoped = state.entries.filter(
    (e) => normalizeSearchKey(e.client) === clientNorm
  );
  const hits: DriveFormulaSearchHit[] = [];
  for (const e of scoped) {
    let best: DriveFormulaSearchHit["rank"] | null = null;
    for (const field of [e.productLabel, e.fileName, ...e.aliases]) {
      const r = rankQuery(q, normalizeSearchKey(field));
      if (!r) continue;
      if (!best || RANK_SCORE[r] > RANK_SCORE[best]) best = r;
    }
    if (!best) continue;
    hits.push({ ...e, rank: best, score: RANK_SCORE[best] });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      a.productLabel.localeCompare(b.productLabel, "es", { sensitivity: "base" })
  );
  return hits.slice(0, limit);
}

export async function downloadDriveFormulaBuffer(
  fileId: string,
  mimeType: string
): Promise<{ buffer: Buffer; checksum: string }> {
  const auth = createGoogleAuth();
  const drive = google.drive({ version: "v3", auth });
  let data: ArrayBuffer;
  if (mimeType === GSHEET || mimeType.includes("google-apps.spreadsheet")) {
    const res = await drive.files.export(
      {
        fileId,
        mimeType: XLSX,
      },
      { responseType: "arraybuffer" }
    );
    data = res.data as ArrayBuffer;
  } else {
    const res = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" }
    );
    data = res.data as ArrayBuffer;
  }
  const buffer = Buffer.from(data);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  return { buffer, checksum };
}

export type DriveResolveResult = {
  found: true;
  source: "DRIVE";
  snapshot: {
    formulaProductId: string;
    formulaVersionId: string;
    versionHash: string;
    driveFileId: string;
    driveModifiedTime: string | null;
    driveChecksum: string;
    sourceSheet: string;
    displayClient: string;
    displayProduct: string;
    productCode: string;
  };
  materials: Array<{
    materiaPrima: string;
    codigo: string;
    formulaPct: number | null;
  }>;
  procedureSteps: Array<{ id: string; text: string }>;
};

/** Descarga + parsea el archivo de Drive. No muta el banco Neon. */
export async function resolveFormulaFromDriveFile(args: {
  fileId: string;
  clientHint?: string;
  productHint?: string;
}): Promise<DriveResolveResult | { found: false; message: string }> {
  const state = await ensureIndex(false).catch(() => null);
  const meta =
    state?.entries.find((e) => e.fileId === args.fileId) ??
    (await new GoogleDriveGateway().getFileMetadata(args.fileId));

  if (!meta) {
    return { found: false, message: "Archivo no encontrado en Drive." };
  }

  const mimeType =
    "mimeType" in meta && meta.mimeType
      ? meta.mimeType
      : XLSX;
  const fileName =
    "fileName" in meta
      ? (meta as DriveFormulaIndexEntry).fileName
      : meta.name;
  const client =
    "client" in meta
      ? (meta as DriveFormulaIndexEntry).client
      : args.clientHint || "";
  const modifiedTime =
    "modifiedTime" in meta ? (meta.modifiedTime ?? null) : null;

  const { buffer, checksum } = await downloadDriveFormulaBuffer(
    args.fileId,
    mimeType
  );

  const knownClients = state?.clients ?? (client ? [client] : []);
  const drafts = parseWorkbookBuffer(buffer, {
    sourceFile: fileName,
    sourceModifiedAt: modifiedTime,
    folderClient: client && client !== "SIN_CLIENTE" ? client : undefined,
    knownClients,
  });

  if (!drafts.length) {
    return {
      found: false,
      message: "No se pudo parsear una fórmula válida desde el archivo de Drive.",
    };
  }

  // Preferir draft cuyo producto matchee el hint; si no, el de mayor ingredientes.
  const productHint = normalizeSearchKey(args.productHint ?? "");
  let draft = drafts[0]!;
  if (productHint) {
    const match = drafts.find(
      (d) =>
        normalizeSearchKey(d.displayProduct) === productHint ||
        normalizeSearchKey(deriveProductFromFilename(d.sourceFile, client)).includes(
          productHint
        )
    );
    if (match) draft = match;
  } else {
    draft = [...drafts].sort(
      (a, b) => b.ingredients.length - a.ingredients.length
    )[0]!;
  }

  if (draft.reviewRequired) {
    return {
      found: false,
      message: "Fórmula requiere revisión y no está disponible para OE.",
    };
  }

  const materials = draft.ingredients.map((ing) =>
    emptyOeMaterial({
      materiaPrima: ing.materialName,
      codigo: ing.materialCodeOrPhase,
      formulaPct: ing.percentage,
      kgAPesar: null,
    })
  );

  return {
    found: true,
    source: "DRIVE",
    snapshot: {
      // IDs sintéticos estables por file+checksum (no son UUIDs de Neon).
      formulaProductId: `drive:${args.fileId}`,
      formulaVersionId: `drive:${args.fileId}:${checksum.slice(0, 16)}`,
      versionHash: checksum,
      driveFileId: args.fileId,
      driveModifiedTime: modifiedTime,
      driveChecksum: checksum,
      sourceSheet: draft.sourceSheet,
      displayClient: draft.displayClient || client,
      displayProduct: draft.displayProduct,
      productCode: draft.productCode || "",
    },
    materials: materials.map((m) => ({
      materiaPrima: m.materiaPrima,
      codigo: m.codigo,
      formulaPct: m.formulaPct,
    })),
    procedureSteps: draft.procedureSteps.map((s, i) => ({
      id: `step-${i}`,
      text: s.instruction,
    })),
  };
}

/** Invalidar cache (tests / sync forzado). */
export function resetDriveFormulasIndexForTests() {
  cache = null;
  building = null;
}

void OFFICE_SHEET_MIMES;
void XLS;
