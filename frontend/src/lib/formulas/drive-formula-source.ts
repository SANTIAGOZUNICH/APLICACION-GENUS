/**
 * Fuente de fórmulas: carpeta NUEVA de Google Drive («ORDEN DE ELABORACION», carpetas de clientes → .xlsx/.xls).
 *
 *  - Índice persistente (Neon): se recorre Drive SOLO al actualizar el índice (manual, cron o cuando está viejo);
 *    abrir un trabajo nunca recorre Drive: busca en la tabla `formula_drive_index`.
 *  - Vínculo explícito cliente + producto → archivo (`formula_drive_links`), elegido por Producción. Se valida que el
 *    archivo siga existiendo y accesible antes de usarlo; si no, se avisa (nunca se usa otro producto en silencio).
 *  - Mientras la carpeta nueva no tenga una actualización exitosa, se sigue usando la ubicación anterior (en memoria,
 *    `drive-formulas-index.ts`). Con la primera actualización «ok» la búsqueda de fórmulas NUEVAS en la ubicación
 *    anterior queda apagada (no se borra ningún archivo ni vínculo histórico; las OE ya emitidas no se tocan).
 *  - Solo lectura de Drive: nunca cambia permisos ni publica archivos.
 */
import "server-only";

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { google } from "googleapis";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { createGoogleAuth, hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import {
  clientKey,
  computeFlags,
  decideDriveFormula,
  extractProductCode,
  markDuplicates,
  matchClientFolders,
  productKeyOf,
  productLabelOf,
  type DriveIndexFile,
  type DriveIndexFlag,
  type DriveMatchDecision,
} from "./drive-match-rules";

/** Carpeta principal de fórmulas (16/10/2026): «ORDEN DE ELABORACION». */
export const FORMULAS_ROOT_FOLDER_ID = "1yCvZR0KM77I87IHG9VDQO1Gz7Uzo6f6E";

export function formulasRootId(): string {
  return process.env.GENUS_FORMULAS_DRIVE_ROOT_ID?.trim() || FORMULAS_ROOT_FOLDER_ID;
}

/** El índice se considera viejo después de este tiempo (el cron lo refresca cada hora). */
export const INDEX_STALE_MS = 6 * 60 * 60 * 1000;
const RUN_LOCK_MS = 3 * 60 * 1000;
const LINK_REVALIDATE_MS = 10 * 60 * 1000;
const MAX_DEPTH = 3;

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const GSHEET = "application/vnd.google-apps.spreadsheet";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS = "application/vnd.ms-excel";
const SHEET_MIMES = new Set([GSHEET, XLSX, XLS]);
const isSheet = (mime: string, name: string) => SHEET_MIMES.has(mime) || /\.(xlsx|xls)$/i.test(name);

export class FormulaSourceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "FormulaSourceError";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Acceso a Drive (real o, solo en pruebas locales, una carpeta del disco)
// ---------------------------------------------------------------------------------------------------------------------

export type DriveChild = { id: string; name: string; mimeType: string; modifiedTime: string | null; md5: string | null };
export type DriveAccess = { ok: true; name: string } | { ok: false; reason: "not_found" | "no_access" | "no_credentials" | "error"; message: string };
export type FileState = "ok" | "trashed" | "not_found" | "no_access" | "error";

export interface FormulaDriveLister {
  canAccess(folderId: string): Promise<DriveAccess>;
  listChildren(folderId: string): Promise<DriveChild[]>;
  fileState(fileId: string): Promise<FileState>;
  download(fileId: string, mimeType: string): Promise<Buffer>;
}

const serviceAccount = () => process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() || "la cuenta de servicio de GENUS OS";

function errCode(err: unknown): number | null {
  const e = err as { code?: unknown; response?: { status?: unknown } };
  const c = Number(e?.code ?? e?.response?.status);
  return Number.isFinite(c) ? c : null;
}

class GoogleFormulaLister implements FormulaDriveLister {
  private drive() {
    return google.drive({ version: "v3", auth: createGoogleAuth() });
  }
  async canAccess(folderId: string): Promise<DriveAccess> {
    if (!hasGoogleCredentials()) return { ok: false, reason: "no_credentials", message: "GENUS OS no tiene configurada la cuenta de servicio de Google." };
    try {
      const r = await this.drive().files.get({ fileId: folderId, fields: "id,name,mimeType,trashed", supportsAllDrives: true });
      if (r.data.trashed) return { ok: false, reason: "not_found", message: "La carpeta de fórmulas está en la papelera de Drive." };
      return { ok: true, name: r.data.name ?? folderId };
    } catch (err) {
      const c = errCode(err);
      if (c === 404) return { ok: false, reason: "not_found", message: `${serviceAccount()} no ve la carpeta de fórmulas (no existe o no está compartida con ella). Compartila con permiso de LECTOR.` };
      if (c === 403) return { ok: false, reason: "no_access", message: `${serviceAccount()} no tiene permiso de lectura sobre la carpeta de fórmulas. Compartila con permiso de LECTOR.` };
      return { ok: false, reason: "error", message: "No se pudo consultar Google Drive." };
    }
  }
  async listChildren(folderId: string): Promise<DriveChild[]> {
    const out: DriveChild[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.drive().files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: "nextPageToken, files(id,name,mimeType,modifiedTime,md5Checksum,shortcutDetails(targetId,targetMimeType))",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of r.data.files ?? []) {
        if (!f.id || !f.name) continue;
        // Accesos directos: se indexa el destino (carpeta u hoja real).
        const target = f.mimeType === SHORTCUT ? f.shortcutDetails : null;
        out.push({
          id: target?.targetId ?? f.id,
          name: f.name,
          mimeType: target?.targetMimeType ?? f.mimeType ?? "",
          modifiedTime: f.modifiedTime ?? null,
          md5: f.md5Checksum ?? null,
        });
      }
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }
  async fileState(fileId: string): Promise<FileState> {
    if (!hasGoogleCredentials()) return "error";
    try {
      const r = await this.drive().files.get({ fileId, fields: "id,trashed", supportsAllDrives: true });
      return r.data.trashed ? "trashed" : "ok";
    } catch (err) {
      const c = errCode(err);
      return c === 404 ? "not_found" : c === 403 ? "no_access" : "error";
    }
  }
  async download(fileId: string, mimeType: string): Promise<Buffer> {
    const drive = this.drive();
    const res =
      mimeType === GSHEET
        ? await drive.files.export({ fileId, mimeType: XLSX }, { responseType: "arraybuffer" })
        : await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return Buffer.from(res.data as ArrayBuffer);
  }
}

/**
 * SOLO pruebas locales/E2E: una carpeta del disco hace de Drive (ids «local:<ruta>»). Nunca en Vercel.
 * Una subcarpeta «__sin_acceso» simula un archivo sin permiso.
 */
class LocalFormulaLister implements FormulaDriveLister {
  constructor(private readonly base: string) {}
  private resolve(id: string): string | null {
    if (!id.startsWith("local:")) return null;
    const rel = Buffer.from(id.slice(6), "base64url").toString("utf8");
    const full = path.resolve(this.base, rel);
    return full.startsWith(path.resolve(this.base)) ? full : null;
  }
  idOf(full: string) {
    return `local:${Buffer.from(path.relative(this.base, full) || ".", "utf8").toString("base64url")}`;
  }
  async canAccess(folderId: string): Promise<DriveAccess> {
    const p = this.resolve(folderId);
    if (!p || !fs.existsSync(p)) return { ok: false, reason: "not_found", message: `${serviceAccount()} no ve la carpeta de fórmulas (no existe o no está compartida con ella). Compartila con permiso de LECTOR.` };
    return { ok: true, name: path.basename(p) };
  }
  async listChildren(folderId: string): Promise<DriveChild[]> {
    const p = this.resolve(folderId);
    if (!p) return [];
    return fs.readdirSync(p, { withFileTypes: true }).map((d) => {
      const full = path.join(p, d.name);
      const st = fs.statSync(full);
      const isDir = d.isDirectory();
      return {
        id: this.idOf(full),
        name: d.name,
        mimeType: isDir ? FOLDER : /\.xls$/i.test(d.name) ? XLS : XLSX,
        modifiedTime: st.mtime.toISOString(),
        md5: isDir ? null : createHash("md5").update(fs.readFileSync(full)).digest("hex"),
      };
    });
  }
  async fileState(fileId: string): Promise<FileState> {
    const p = this.resolve(fileId);
    if (!p || !fs.existsSync(p)) return "not_found";
    if (p.split(path.sep).includes("__sin_acceso")) return "no_access";
    return "ok";
  }
  async download(fileId: string): Promise<Buffer> {
    const p = this.resolve(fileId);
    if (!p || !fs.existsSync(p)) throw new FormulaSourceError("Archivo no encontrado.", 404);
    if (p.split(path.sep).includes("__sin_acceso")) throw new FormulaSourceError("Sin acceso al archivo.", 403);
    return fs.readFileSync(p);
  }
}

let listerOverride: FormulaDriveLister | null = null;
/** Pruebas: inyecta un Drive simulado. */
export function setFormulaDriveListerForTests(lister: FormulaDriveLister | null) {
  listerOverride = lister;
}

function localFakeDir(): string | null {
  const dir = process.env.GENUS_E2E_FAKE_FORMULAS_DRIVE_DIR?.trim();
  // Nunca en Vercel (VERCEL=1 lo define la plataforma; las pruebas locales no lo tienen).
  return dir && process.env.VERCEL !== "1" ? dir : null;
}

export function formulaDriveLister(): FormulaDriveLister {
  if (listerOverride) return listerOverride;
  const dir = localFakeDir();
  return dir ? new LocalFormulaLister(dir) : new GoogleFormulaLister();
}

/** En pruebas locales la raíz es la carpeta del disco. */
function effectiveRootId(): string {
  const dir = localFakeDir();
  if (dir && !listerOverride && !process.env.GENUS_FORMULAS_DRIVE_ROOT_ID) return new LocalFormulaLister(dir).idOf(path.resolve(dir));
  return formulasRootId();
}

// ---------------------------------------------------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? null : String(v));
const isoOrNull = (v: unknown) => (v == null ? null : new Date(String(v)).toISOString());

function requireDb() {
  if (!isDatabaseConfigured()) throw new FormulaSourceError("El índice de fórmulas requiere la base de datos.", 503);
  return getDb();
}

export type SyncResult =
  | { ok: true; runId: string; clientCount: number; fileCount: number; added: number; updated: number; removed: number; finishedAt: string; newFiles: Array<{ client: string; fileName: string }>; removedFiles: number }
  | { ok: false; runId: string | null; error: string; running?: boolean };

type CollectedFile = Omit<DriveIndexFile, "flags" | "otherClient" | "productKey" | "productLabel" | "productCode"> & { md5: string | null };

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    })
  );
  return out;
}

async function walkClient(lister: FormulaDriveLister, folder: { id: string; name: string }): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  const visit = async (folderId: string, subPath: string, depth: number) => {
    for (const c of await lister.listChildren(folderId)) {
      if (c.mimeType === FOLDER) {
        if (depth < MAX_DEPTH) await visit(c.id, subPath ? `${subPath} / ${c.name}` : c.name, depth + 1);
        continue;
      }
      if (!isSheet(c.mimeType, c.name) || c.name.startsWith("~$")) continue;
      files.push({
        fileId: c.id,
        clientFolderId: folder.id,
        clientFolderName: folder.name,
        subPath,
        fileName: c.name,
        mimeType: c.mimeType,
        modifiedTime: c.modifiedTime,
        md5: c.md5,
      });
    }
  };
  await visit(folder.id, "", 0);
  return files;
}

/** Recorre la carpeta nueva y actualiza el índice (agrega, actualiza y marca lo que ya no está). Solo lectura de Drive. */
export async function syncFormulaIndex(opts: { trigger: "manual" | "cron" | "auto"; actorEmail?: string | null }): Promise<SyncResult> {
  const db = requireDb();
  const root = effectiveRootId();
  const running = (await db.execute(sql`
    select id from formula_drive_sync_runs
     where root_folder_id = ${root} and status = 'running' and started_at > now() - (${RUN_LOCK_MS} * interval '1 millisecond')
     limit 1`)).rows as Row[];
  if (running.length) return { ok: false, runId: String(running[0]!.id), error: "Ya hay una actualización del índice en curso. Esperá un momento.", running: true };

  const runId = randomUUID();
  await db.execute(sql`insert into formula_drive_sync_runs (id, root_folder_id, trigger, actor_email) values (${runId}::uuid, ${root}, ${opts.trigger}, ${opts.actorEmail ?? null})`);
  const fail = async (error: string): Promise<SyncResult> => {
    await db.execute(sql`update formula_drive_sync_runs set status = 'error', error = ${error}, finished_at = now() where id = ${runId}::uuid`);
    return { ok: false, runId, error };
  };
  const lister = formulaDriveLister();
  const access = await lister.canAccess(root);
  if (!access.ok) return fail(access.message);

  let collected: CollectedFile[];
  let clientFolders: Array<{ id: string; name: string }>;
  try {
    const top = await lister.listChildren(root);
    clientFolders = top.filter((c) => c.mimeType === FOLDER).map((c) => ({ id: c.id, name: c.name.trim() }));
    // Hojas sueltas en la raíz (sin carpeta de cliente): se indexan para poder vincularlas a mano, nunca se eligen solas.
    const loose: CollectedFile[] = top
      .filter((c) => c.mimeType !== FOLDER && isSheet(c.mimeType, c.name))
      .map((c) => ({ fileId: c.id, clientFolderId: root, clientFolderName: "(sin carpeta de cliente)", subPath: "", fileName: c.name, mimeType: c.mimeType, modifiedTime: c.modifiedTime, md5: c.md5 }));
    collected = [...loose, ...(await mapLimit(clientFolders, 8, (f) => walkClient(lister, f))).flat()];
  } catch {
    return fail("No se pudo leer el contenido de la carpeta de fórmulas en Drive. Reintentá en unos minutos.");
  }

  // El mismo archivo visible por dos accesos directos se indexa una vez (el primero).
  const seen = new Set<string>();
  // Una lectura que no trae NINGÚN archivo es un error de Drive, no «se borró todo»: no se marca nada como quitado.
  if (collected.length === 0) return fail("Drive no devolvió ningún archivo de fórmulas. No se modificó el índice; reintentá en unos minutos.");
  const unique = collected.filter((f) => (seen.has(f.fileId) ? false : (seen.add(f.fileId), true)));
  const clientNames = clientFolders.map((c) => c.name);
  const files = markDuplicates(
    unique.map((f) => {
      const { flags, otherClient } = computeFlags(f, clientNames);
      const productLabel = productLabelOf(f.fileName, f.clientFolderName);
      return {
        ...f,
        productLabel,
        productKey: productKeyOf(productLabel, f.clientFolderName, otherClient ? [otherClient] : []),
        productCode: extractProductCode(f.fileName),
        flags,
        otherClient,
      };
    })
  );

  let added = 0;
  let updated = 0;
  const newFiles: Array<{ client: string; fileName: string }> = [];
  for (const f of files) {
    const r = (await db.execute(sql`
      insert into formula_drive_index (file_id, root_folder_id, client_folder_id, client_folder_name, client_key, sub_path, file_name,
        product_label, product_key, product_code, mime_type, modified_time, md5, flags, last_run_id)
      values (${f.fileId}, ${root}, ${f.clientFolderId}, ${f.clientFolderName}, ${clientKey(f.clientFolderName)}, ${f.subPath}, ${f.fileName},
        ${f.productLabel}, ${f.productKey}, ${f.productCode}, ${f.mimeType}, ${f.modifiedTime}::timestamptz, ${f.md5},
        ${JSON.stringify({ flags: f.flags, otherClient: f.otherClient })}::jsonb, ${runId}::uuid)
      on conflict (file_id) do update set
        root_folder_id = excluded.root_folder_id, client_folder_id = excluded.client_folder_id, client_folder_name = excluded.client_folder_name,
        client_key = excluded.client_key, sub_path = excluded.sub_path, file_name = excluded.file_name, product_label = excluded.product_label,
        product_key = excluded.product_key, product_code = excluded.product_code, mime_type = excluded.mime_type,
        modified_time = excluded.modified_time, md5 = excluded.md5, flags = excluded.flags, last_run_id = excluded.last_run_id,
        last_seen_at = now(), removed_at = null
      returning (xmax = 0) as inserted`)).rows as Row[];
    if (r[0]?.inserted === true || r[0]?.inserted === "t") {
      added++;
      if (newFiles.length < 30) newFiles.push({ client: f.clientFolderName, fileName: f.fileName });
    }
    else updated++;
  }
  const removed = (await db.execute(sql`
    update formula_drive_index set removed_at = now()
     where root_folder_id = ${root} and removed_at is null and (last_run_id is null or last_run_id <> ${runId}::uuid)
     returning file_id`)).rows.length;
  await db.execute(sql`
    update formula_drive_sync_runs set status = 'ok', finished_at = now(), client_count = ${clientFolders.length}, file_count = ${files.length},
      added_count = ${added}, updated_count = ${updated}, removed_count = ${removed}
     where id = ${runId}::uuid`);
  resetLegacyCacheSafe();
  return { ok: true, runId, clientCount: clientFolders.length, fileCount: files.length, added, updated, removed, finishedAt: new Date().toISOString(), newFiles, removedFiles: removed };
}

function resetLegacyCacheSafe() {
  void import("./drive-formulas-index").then((m) => m.resetDriveFormulasIndexForTests()).catch(() => undefined);
}

export type IndexStatus = {
  rootFolderId: string;
  /** true = la carpeta nueva ya se indexó bien al menos una vez: la ubicación anterior ya no se consulta. */
  validated: boolean;
  lastOk: { at: string; clients: number; files: number; added: number; updated: number; removed: number; trigger: string } | null;
  lastRun: { at: string; status: string; error: string | null; trigger: string } | null;
  stale: boolean;
  serviceAccount: string;
};

export async function getIndexStatus(): Promise<IndexStatus> {
  const db = requireDb();
  const root = effectiveRootId();
  const [ok] = (await db.execute(sql`
    select finished_at, client_count, file_count, added_count, updated_count, removed_count, trigger from formula_drive_sync_runs
     where root_folder_id = ${root} and status = 'ok' order by finished_at desc limit 1`)).rows as Row[];
  const [last] = (await db.execute(sql`
    select started_at, status, error, trigger from formula_drive_sync_runs where root_folder_id = ${root} order by started_at desc limit 1`)).rows as Row[];
  const lastOk = ok
    ? {
        at: isoOrNull(ok.finished_at)!,
        clients: Number(ok.client_count ?? 0),
        files: Number(ok.file_count ?? 0),
        added: Number(ok.added_count ?? 0),
        updated: Number(ok.updated_count ?? 0),
        removed: Number(ok.removed_count ?? 0),
        trigger: String(ok.trigger),
      }
    : null;
  return {
    rootFolderId: formulasRootId(),
    validated: Boolean(lastOk),
    lastOk,
    lastRun: last ? { at: isoOrNull(last.started_at)!, status: String(last.status), error: str(last.error), trigger: String(last.trigger) } : null,
    stale: !lastOk || Date.now() - Date.parse(lastOk.at) > INDEX_STALE_MS,
    serviceAccount: serviceAccount(),
  };
}

/** ¿La carpeta nueva ya está validada? (sin base → no). */
export async function isNewFormulaSourceValidated(): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  try {
    const rows = (await getDb().execute(sql`
      select 1 from formula_drive_sync_runs where root_folder_id = ${effectiveRootId()} and status = 'ok' limit 1`)).rows;
    return rows.length > 0;
  } catch {
    return false;
  }
}

function rowToFile(r: Row): DriveIndexFile & { removedAt: string | null; md5: string | null } {
  const meta = (typeof r.flags === "string" ? JSON.parse(r.flags) : r.flags) as { flags?: DriveIndexFlag[]; otherClient?: string | null } | DriveIndexFlag[] | null;
  const flags = Array.isArray(meta) ? meta : meta?.flags ?? [];
  return {
    fileId: String(r.file_id),
    clientFolderId: String(r.client_folder_id),
    clientFolderName: String(r.client_folder_name),
    subPath: String(r.sub_path ?? ""),
    fileName: String(r.file_name),
    mimeType: String(r.mime_type),
    modifiedTime: isoOrNull(r.modified_time),
    productLabel: String(r.product_label),
    productKey: String(r.product_key),
    productCode: str(r.product_code),
    flags,
    otherClient: Array.isArray(meta) ? null : meta?.otherClient ?? null,
    removedAt: isoOrNull(r.removed_at),
    md5: str(r.md5),
  };
}

/** Archivos vigentes del índice (sin recorrer Drive). */
export async function loadIndexFiles(): Promise<DriveIndexFile[]> {
  const db = requireDb();
  const rows = (await db.execute(sql`
    select * from formula_drive_index where root_folder_id = ${effectiveRootId()} and removed_at is null order by client_folder_name, file_name`)).rows as Row[];
  return rows.map(rowToFile);
}

export async function getIndexedFile(fileId: string): Promise<(DriveIndexFile & { removedAt: string | null; md5: string | null }) | null> {
  const db = requireDb();
  const [r] = (await db.execute(sql`select * from formula_drive_index where file_id = ${fileId} limit 1`)).rows as Row[];
  return r ? rowToFile(r) : null;
}

/** Si el índice está viejo, lo actualiza (una vez, sin bloquear si otro ya lo hace). Nunca lanza. */
export async function ensureFreshIndex(maxAgeMs = INDEX_STALE_MS): Promise<void> {
  try {
    const st = await getIndexStatus();
    if (st.lastOk && Date.now() - Date.parse(st.lastOk.at) <= maxAgeMs) return;
    await syncFormulaIndex({ trigger: "auto" });
  } catch {
    /* el índice anterior sigue sirviendo */
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Vínculos explícitos cliente + producto → archivo
// ---------------------------------------------------------------------------------------------------------------------

export type FormulaLink = {
  id: string;
  clientLabel: string;
  productLabel: string;
  fileId: string;
  fileName: string;
  clientFolderName: string;
  note: string | null;
  linkedBy: string;
  linkedAt: string;
  lastValidation: string | null;
  lastValidatedAt: string | null;
};

export type LinkValidation = "ok" | "removed" | "not_found" | "no_access" | "trashed" | "error";

const linkKeys = (client: string, product: string) => ({ ck: clientKey(client), pk: productKeyOf(product, client) || clientKey(product) });

function rowToLink(r: Row): FormulaLink {
  return {
    id: String(r.id),
    clientLabel: String(r.client_label),
    productLabel: String(r.product_label),
    fileId: String(r.file_id),
    fileName: String(r.file_name),
    clientFolderName: String(r.client_folder_name),
    note: str(r.note),
    linkedBy: String(r.linked_by),
    linkedAt: isoOrNull(r.linked_at)!,
    lastValidation: str(r.last_validation),
    lastValidatedAt: isoOrNull(r.last_validated_at),
  };
}

export async function getActiveLink(client: string, product: string): Promise<FormulaLink | null> {
  const { ck, pk } = linkKeys(client, product);
  if (!ck || !pk) return null;
  const [r] = (await requireDb().execute(sql`
    select * from formula_drive_links where client_key = ${ck} and product_key = ${pk} and ended_at is null limit 1`)).rows as Row[];
  return r ? rowToLink(r) : null;
}

/** ¿El archivo vinculado sigue en la carpeta de fórmulas y accesible? Guarda el resultado en el vínculo. */
export async function validateLink(link: FormulaLink, force = false): Promise<LinkValidation> {
  if (!force && link.lastValidation === "ok" && link.lastValidatedAt && Date.now() - Date.parse(link.lastValidatedAt) < LINK_REVALIDATE_MS) return "ok";
  const indexed = await getIndexedFile(link.fileId);
  let state: LinkValidation;
  if (!indexed || indexed.removedAt) state = "removed";
  else {
    const s = await formulaDriveLister().fileState(link.fileId);
    state = s;
  }
  await requireDb().execute(sql`update formula_drive_links set last_validation = ${state}, last_validated_at = now() where id = ${link.id}::uuid`);
  return state;
}

export const LINK_STATE_MESSAGE: Record<Exclude<LinkValidation, "ok">, string> = {
  removed: "El archivo vinculado ya no está en la carpeta de fórmulas de Drive (se movió o se borró). Vinculá el archivo correcto.",
  not_found: "El archivo vinculado ya no existe en Drive. Vinculá el archivo correcto.",
  trashed: "El archivo vinculado está en la papelera de Drive. Restauralo o vinculá otro.",
  no_access: "GENUS OS no tiene permiso para leer el archivo vinculado en Drive. Compartilo con la cuenta de servicio (lector).",
  error: "No se pudo verificar el archivo vinculado en Drive. Reintentá en unos minutos.",
};

type Actor = { email: string; sector: string };

async function auditLink(actor: Actor, action: string, entityId: string, payload: Record<string, unknown>) {
  await requireDb().execute(sql`
    insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
    values (${randomUUID()}::uuid, 'formulas_drive', ${action}, ${actor.email}, ${actor.sector}, ${entityId}, null, ${JSON.stringify(payload)}::jsonb, now())`);
}

/** Producción vincula (o reemplaza) el archivo de la fórmula de un cliente + producto. */
export async function linkFormula(actor: Actor, input: { client: string; product: string; fileId: string; note?: string | null }): Promise<FormulaLink> {
  const client = input.client?.trim() ?? "";
  const product = input.product?.trim() ?? "";
  if (!client || !product) throw new FormulaSourceError("Faltan cliente y producto para vincular la fórmula.");
  const { ck, pk } = linkKeys(client, product);
  const file = await getIndexedFile(input.fileId?.trim() ?? "");
  if (!file || file.removedAt) throw new FormulaSourceError("Ese archivo no está en la carpeta de fórmulas de Drive (actualizá el índice).", 404);
  const state = await formulaDriveLister().fileState(file.fileId);
  if (state !== "ok") throw new FormulaSourceError(LINK_STATE_MESSAGE[state], state === "no_access" ? 403 : 409);
  const db = requireDb();
  const id = randomUUID();
  const note = input.note?.trim() || null;
  await db.transaction(async (tx) => {
    const prev = (await tx.execute(sql`
      update formula_drive_links set ended_at = now(), ended_by = ${actor.email}, end_reason = 'Reemplazado por otro archivo'
       where client_key = ${ck} and product_key = ${pk} and ended_at is null returning id, file_id, file_name`)).rows as Row[];
    await tx.execute(sql`
      insert into formula_drive_links (id, client_key, product_key, client_label, product_label, file_id, file_name, client_folder_name, note,
        linked_by, linked_by_sector, last_validated_at, last_validation)
      values (${id}::uuid, ${ck}, ${pk}, ${client}, ${product}, ${file.fileId}, ${file.fileName}, ${file.clientFolderName}, ${note},
        ${actor.email}, ${actor.sector}, now(), 'ok')`);
    await tx.execute(sql`
      insert into feature_audit_events (id, domain, action, actor_email, actor_sector, entity_id, idempotency_key, payload, created_at)
      values (${randomUUID()}::uuid, 'formulas_drive', 'link', ${actor.email}, ${actor.sector}, ${id}, null,
        ${JSON.stringify({ client, product, fileId: file.fileId, fileName: file.fileName, clientFolder: file.clientFolderName, note, replaced: prev.map((p) => ({ id: p.id, fileId: p.file_id, fileName: p.file_name })) })}::jsonb, now())`);
  });
  return (await getActiveLink(client, product))!;
}

export async function unlinkFormula(actor: Actor, linkId: string, reason?: string | null): Promise<void> {
  const rows = (await requireDb().execute(sql`
    update formula_drive_links set ended_at = now(), ended_by = ${actor.email}, end_reason = ${reason?.trim() || "Desvinculado"}
     where id = ${linkId}::uuid and ended_at is null returning id, file_id, file_name, client_label, product_label`)).rows as Row[];
  if (!rows.length) throw new FormulaSourceError("El vínculo no existe o ya estaba desvinculado.", 404);
  await auditLink(actor, "unlink", linkId, { fileId: rows[0]!.file_id, fileName: rows[0]!.file_name, client: rows[0]!.client_label, product: rows[0]!.product_label, reason: reason ?? null });
}

// ---------------------------------------------------------------------------------------------------------------------
// Búsqueda para un trabajo
// ---------------------------------------------------------------------------------------------------------------------

export type WorkFormulaLookup =
  | { kind: "linked"; link: FormulaLink; file: DriveIndexFile }
  | { kind: "link_invalid"; link: FormulaLink; state: Exclude<LinkValidation, "ok">; message: string }
  | { kind: "match"; decision: DriveMatchDecision };

/** Cliente + producto → vínculo vigente (validado) o búsqueda en el índice. Nunca recorre Drive. */
export async function lookupFormulaForWork(client: string, product: string): Promise<WorkFormulaLookup> {
  const link = await getActiveLink(client, product);
  if (link) {
    const state = await validateLink(link);
    if (state !== "ok") return { kind: "link_invalid", link, state, message: LINK_STATE_MESSAGE[state] };
    const file = await getIndexedFile(link.fileId);
    return { kind: "linked", link, file: file! };
  }
  const learnedFolderIds = await learnedClientFolderIds(client);
  return { kind: "match", decision: decideDriveFormula(client, product, await loadIndexFiles(), { learnedFolderIds }) };
}

/** Diagnóstico: cómo se identifica la carpeta del cliente en el índice (misma regla que la búsqueda automática). */
export async function loadClientFolderMatch(client: string) {
  const files = await loadIndexFiles();
  const folders = [...new Map(files.map((f) => [f.clientFolderId, { id: f.clientFolderId, name: f.clientFolderName }])).values()];
  const m = matchClientFolders(client, folders, await learnedClientFolderIds(client));
  return { totalClientFolders: folders.length, how: m.how, exact: m.exact.map((f) => f.name), suggestions: m.suggestions.map((f) => f.name) };
}

/**
 * Carpetas de cliente que Producción ya confirmó para este cliente (archivos vinculados y vigentes). Así, una vez que
 * se vinculó una fórmula de «TRC» desde la carpeta «TRC HAIR CARE», los demás productos de TRC se buscan ahí.
 */
export async function learnedClientFolderIds(client: string): Promise<string[]> {
  const ck = clientKey(client);
  if (!ck) return [];
  const rows = (await requireDb().execute(sql`
    select distinct i.client_folder_id from formula_drive_links l
      join formula_drive_index i on i.file_id = l.file_id
     where l.client_key = ${ck} and l.ended_at is null and i.removed_at is null and i.root_folder_id = ${effectiveRootId()}`)).rows as Row[];
  return rows.map((r) => String(r.client_folder_id));
}

/**
 * Coincidencia ÚNICA y segura usada para una OE: se guarda como vínculo (si todavía no hay uno) para que las próximas
 * asignaciones del mismo cliente + producto usen el mismo archivo. Nunca reemplaza un vínculo existente.
 */
export async function autoLinkFormula(actor: Actor, input: { client: string; product: string; fileId: string }): Promise<boolean> {
  const client = input.client.trim();
  const product = input.product.trim();
  const { ck, pk } = linkKeys(client, product);
  if (!ck || !pk) return false;
  const file = await getIndexedFile(input.fileId);
  if (!file || file.removedAt) return false;
  const id = randomUUID();
  const rows = (await requireDb().execute(sql`
    insert into formula_drive_links (id, client_key, product_key, client_label, product_label, file_id, file_name, client_folder_name, note,
      linked_by, linked_by_sector, last_validated_at, last_validation)
    values (${id}::uuid, ${ck}, ${pk}, ${client}, ${product}, ${file.fileId}, ${file.fileName}, ${file.clientFolderName},
      'Vinculada automáticamente: única coincidencia segura', ${actor.email}, ${actor.sector}, now(), 'ok')
    on conflict do nothing returning id`)).rows;
  if (!rows.length) return false;
  await auditLink(actor, "auto_link", id, { client, product, fileId: file.fileId, fileName: file.fileName, clientFolder: file.clientFolderName });
  return true;
}

/**
 * OE de Elaboración que quedaron con la fórmula pendiente (sin empezar): se vuelven a preparar con la búsqueda actual.
 * Usa la preparación automática existente (misma OE, mismo número; no reemplaza fórmulas ya cargadas, no toca lotes,
 * cantidades, consumos ni stock). Devuelve cuántas quedaron con fórmula.
 */
export async function retryPendingOeFormulas(actor: Actor, opts: { limit?: number; workItemIds?: string[] } = {}): Promise<{ checked: number; resolved: number; orderNumbers: string[] }> {
  const db = requireDb();
  const ids = opts.workItemIds?.length ? opts.workItemIds : null;
  const rows = (await db.execute(sql`
    select distinct on (o.created_at, o.id) o.id, o.order_number from operational_orders o
      join work_items w on (w.id::text = o.linked_work_item_id or (coalesce(o.linked_work_item_id, '') = '' and w.order_id = o.id))
     where o.type = 'OE' and o.deleted_at is null and o.status::text in ('BORRADOR', 'PENDIENTE')
       and w.sector::text = 'ELABORACION' and w.status::text <> 'CANCELADO'
       and coalesce(o.form_data->'autoPrep'->'formula'->>'status', '') not in ('ok', 'manual_content')
       ${ids ? sql`and w.id::text in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql``}
     order by o.created_at desc, o.id limit ${opts.limit ?? 25}`)).rows as Row[];
  const { prepareOeFromWork } = await import("@/lib/planning/oe-auto-prep");
  let resolved = 0;
  const orderNumbers: string[] = [];
  for (const r of rows) {
    try {
      // Primero se mira sin guardar: si la fórmula sigue sin aparecer, la OE no se toca (ni versión ni mensaje).
      const preview = await prepareOeFromWork({ orderId: String(r.id), actor, reason: "Fórmula encontrada en la carpeta de Drive", dryRun: true });
      if (preview.status !== "applied" || preview.autoPrep.formula.status !== "ok") continue;
      const out = await prepareOeFromWork({ orderId: String(r.id), actor, reason: "Fórmula encontrada en la carpeta de Drive", expectedVersion: preview.version });
      if (out.status === "applied" && out.autoPrep.formula.status === "ok") {
        resolved++;
        orderNumbers.push(String(r.order_number));
      }
    } catch {
      /* se reintenta en la próxima actualización */
    }
  }
  return { checked: rows.length, resolved, orderNumbers };
}

/** Contenido del archivo (para la OE y para «Descargar»). Solo archivos del índice: nunca es un proxy genérico de Drive. */
export async function readIndexedFile(fileId: string): Promise<{ buffer: Buffer; fileName: string; mimeType: string; checksum: string }> {
  const file = await getIndexedFile(fileId);
  if (!file) throw new FormulaSourceError("Archivo no encontrado en el índice de fórmulas.", 404);
  const lister = formulaDriveLister();
  let buffer: Buffer;
  try {
    buffer = await lister.download(fileId, file.mimeType);
  } catch (err) {
    if (err instanceof FormulaSourceError) throw err;
    const c = errCode(err);
    if (c === 403) throw new FormulaSourceError(LINK_STATE_MESSAGE.no_access, 403);
    if (c === 404) throw new FormulaSourceError(LINK_STATE_MESSAGE.not_found, 404);
    throw new FormulaSourceError("No se pudo descargar el archivo de Drive.", 502);
  }
  const fileName = file.mimeType === GSHEET && !/\.xlsx$/i.test(file.fileName) ? `${file.fileName}.xlsx` : file.fileName;
  return { buffer, fileName, mimeType: file.mimeType === GSHEET ? XLSX : file.mimeType, checksum: createHash("sha256").update(buffer).digest("hex") };
}

/** Lo que Producción debería revisar: productos con varios archivos, posibles archivos de otro cliente y hojas sueltas. */
export async function reviewReport(): Promise<{
  duplicates: Array<{ clientFolder: string; productLabel: string; files: Array<{ fileId: string; fileName: string; subPath: string; modifiedTime: string | null; flags: DriveIndexFlag[] }> }>;
  otherClient: Array<{ clientFolder: string; fileId: string; fileName: string; otherClient: string | null }>;
  loose: Array<{ fileId: string; fileName: string }>;
}> {
  const files = await loadIndexFiles();
  const groups = new Map<string, DriveIndexFile[]>();
  for (const f of files) {
    if (!f.flags.includes("duplicado")) continue;
    const k = `${f.clientFolderId}|${f.productKey}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return {
    duplicates: [...groups.values()].map((g) => ({
      clientFolder: g[0]!.clientFolderName,
      productLabel: g[0]!.productLabel,
      files: g.map((f) => ({ fileId: f.fileId, fileName: f.fileName, subPath: f.subPath, modifiedTime: f.modifiedTime, flags: f.flags })),
    })),
    otherClient: files.filter((f) => f.flags.includes("otro_cliente")).map((f) => ({ clientFolder: f.clientFolderName, fileId: f.fileId, fileName: f.fileName, otherClient: f.otherClient ?? null })),
    loose: files.filter((f) => f.clientFolderName === "(sin carpeta de cliente)").map((f) => ({ fileId: f.fileId, fileName: f.fileName })),
  };
}

export type LiveDriveHit = { fileId: string; name: string; mimeType: string; parentName: string | null; underFormulasRoot: boolean; indexed: boolean };

/**
 * DIAGNÓSTICO: busca por nombre EN VIVO en todo lo que la cuenta de servicio ve en Drive (no solo la carpeta de
 * fórmulas) y dice, por cada archivo, si está debajo de la carpeta de fórmulas configurada y si ya está en el índice.
 * Así se distingue «no está indexado todavía» de «está en otra carpeta» o «la cuenta de servicio no lo ve».
 */
export async function searchDriveLiveByName(term: string): Promise<LiveDriveHit[]> {
  const t = term.replace(/['\\]/g, " ").trim();
  if (t.length < 2 || !hasGoogleCredentials()) return [];
  const drive = google.drive({ version: "v3", auth: createGoogleAuth() });
  const r = await drive.files.list({
    q: `name contains '${t}' and trashed=false and mimeType != '${FOLDER}'`,
    fields: "files(id,name,mimeType,parents)",
    pageSize: 25,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const root = effectiveRootId();
  const indexedIds = new Set((await loadIndexFiles()).map((f) => f.fileId));
  const out: LiveDriveHit[] = [];
  for (const f of r.data.files ?? []) {
    if (!f.id || !f.name) continue;
    let parentName: string | null = null;
    let under = false;
    let cur = f.parents?.[0] ?? null;
    for (let depth = 0; cur && depth < 6; depth++) {
      if (cur === root) {
        under = true;
        break;
      }
      const p = await drive.files.get({ fileId: cur, fields: "id,name,parents", supportsAllDrives: true }).catch(() => null);
      if (!p) break;
      if (depth === 0) parentName = p.data.name ?? null;
      cur = p.data.parents?.[0] ?? null;
    }
    if (f.parents?.[0] === root) parentName = parentName ?? "(carpeta raíz)";
    out.push({ fileId: f.id, name: f.name, mimeType: f.mimeType ?? "", parentName, underFormulasRoot: under, indexed: indexedIds.has(f.id) });
  }
  return out;
}
