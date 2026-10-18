/**
 * Ingreso de MP / ME con foto de remito (servidor).
 *
 * Flujo: borrador (sin stock) → revisión → confirmación. La confirmación NO es un sistema paralelo de stock:
 *  - MP: corre dentro de `runMpInventoryOp` (candado de MP + transacción) y crea cada ingreso con `InventoryService.upsertMpIngreso`
 *    (lote, libro mayor, auditoría, duplicados: las reglas de siempre).
 *  - ME: una transacción que inserta filas de `inv_me_ingresos` (el stock de ME se DERIVA de ese libro) con el candado por código.
 * En ambos casos el borrador queda CONFIRMADO en la misma transacción, con una clave de confirmación única: un doble clic,
 * un reintento o dos usuarios a la vez no suman el stock dos veces.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  invAudit,
  invMeIngresos,
  invMeMaterials,
  invMpIngresos,
  invMpStock,
  inventoryIngresoAdjuntos,
  inventoryReceiptLines,
  inventoryReceipts,
  mpStockBalances,
  mpStockMovements,
} from "@/lib/db/schema";
import type { DbTx } from "@/lib/db/tx-context";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError, type InventoryActor } from "@/lib/inventory/inventory-service";
import { normalizeMeCodigo } from "@/lib/inventory/me-codigo";
import { auditRow, lockCodigos } from "@/lib/inventory/me-planilla-db";
import { runMpInventoryOp } from "@/lib/inventory/mp-planilla-db";
import { extractRemito, extractionConfig, type ExtractionConfig } from "@/lib/inventory/receipt-extraction";
import {
  RECEIPT_MAX_FILES,
  RECEIPT_MAX_LINES,
  canReadReceipts,
  canWriteReceipts,
  classifyDuplicates,
  codeKey,
  emptyHeader,
  emptyLine,
  isIsoDate,
  mappingKey,
  autoMatchMaterial,
  normalizeMaterialCode,
  preselectFromHistory,
  remitoKey,
  splitPackages,
  suggestMaterials,
  supplierKey,
  validateReceipt,
  type CatalogItem,
  type DuplicateWarning,
  type ExistingEntry,
  type MappingHistory,
  type MaterialSuggestion,
  type ReceiptDraftPayload,
  type ReceiptIssue,
  type ReceiptLineDraft,
  type ReceiptModule,
  type ReceiptStatus,
  type ValidationResult,
} from "@/lib/inventory/receipt-rules";
import { getFileStorage, safeFileName, STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE } from "@/lib/storage/file-storage";
import { isMpInternalCodigo } from "@/lib/inventory/types";
import type { MeIngresoRow, MeMaterial, MpIngresoRow, MpStockRow } from "@/lib/inventory/types";

type Db = ReturnType<typeof getDb> | DbTx;

/** Error de recepción con detalle estructurado para la pantalla (campos a revisar, advertencias de duplicado). */
export class ReceiptError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly details: { issues?: ReceiptIssue[]; warnings?: DuplicateWarning[] } = {}) {
    super(message);
    this.name = "ReceiptError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const todayIso = () => new Date().toISOString().slice(0, 10);

export const RECEIPT_FILE_MAX_BYTES = 4 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" };

/** Firma real del archivo (no alcanza con la extensión): imagen JPG/PNG/HEIC o PDF. */
export function sniffReceiptFileType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 12) {
    const box = String.fromCharCode(...bytes.slice(4, 8));
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (box === "ftyp" && ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1", "heif"].includes(brand)) return "image/heic";
  }
  return null;
}
export function validateReceiptFileMeta(input: { name: string; size: number }): string | null {
  const ext = (input.name.split(".").pop() ?? "").toLowerCase();
  if (!FILE_TYPES[ext]) return `«${input.name}»: formato no permitido. Usá fotos JPG, PNG, HEIC o un PDF.`;
  if (!(input.size > 0)) return `«${input.name}» está vacío.`;
  if (input.size > RECEIPT_FILE_MAX_BYTES) return `«${input.name}» pesa ${(input.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB: el máximo es 4 MB.`;
  return null;
}

// ───────────────────────── Tipos públicos ─────────────────────────

export type ReceiptFile = { id: string; fileName: string; contentType: string; sizeBytes: number; uploadedBy: string; uploadedAt: string };
export type ReceiptLineConfirmed = {
  lineNo: number; supplierCode: string; description: string; materialCode: string; materialLabel: string; quantity: number; remitoQuantity: number | null;
  unit: string; packages: number | null; lote: string; vencimiento: string; notes: string; ingresoId: string; ingresoNro: string | null;
};
export type ReceiptMovement = { ingresoId: string; ingresoNro: string | null; kind: string; quantity: number; balanceAfter: number | null; at: string | null };
export type Receipt = {
  id: string;
  module: ReceiptModule;
  status: ReceiptStatus;
  version: number;
  draft: ReceiptDraftPayload;
  files: ReceiptFile[];
  parentReceiptId: string | null;
  createdBy: string;
  createdBySector: string;
  createdAt: string;
  updatedAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  confirmedLines: ReceiptLineConfirmed[];
  movements: ReceiptMovement[];
};
export type ReceiptSummary = Pick<Receipt, "id" | "module" | "status" | "createdBy" | "createdAt" | "confirmedBy" | "confirmedAt"> & {
  supplier: string; remitoNumber: string; receivedDate: string; lineCount: number; fileCount: number; parentReceiptId: string | null;
};
export type Analysis = {
  validation: { ok: boolean; issues: ReceiptIssue[] };
  suggestions: Record<string, MaterialSuggestion[]>;
  preselected: Record<string, string>;
  warnings: DuplicateWarning[];
  fileCount: number;
  ready: boolean;
};

// ───────────────────────── Permisos ─────────────────────────

function assertWrite(actor: InventoryActor, module: ReceiptModule) {
  if (actor.isSuperadmin) return;
  if (!canWriteReceipts(actor.sector, module)) {
    throw new InventoryForbiddenError(module === "MP" ? "Solo Materia Prima (o Dirección) registra ingresos de materias primas." : "Solo Depósito (o Dirección) registra ingresos de materiales de envase.");
  }
}
function assertRead(actor: InventoryActor, module: ReceiptModule) {
  if (actor.isSuperadmin) return;
  if (!canReadReceipts(actor.sector, module)) throw new InventoryForbiddenError("No tenés permiso para ver estos ingresos.");
}
const canWriteSafe = (actor: InventoryActor, module: ReceiptModule) => actor.isSuperadmin || canWriteReceipts(actor.sector, module);

// ───────────────────────── Catálogos reales ─────────────────────────

/**
 * ME: los materiales de Depósito (inv_me_materials, no archivados). MP: los códigos que ya existen en Stock MP y en el libro
 * mayor (GENUS OS no tiene un maestro aparte). Nunca se crea un material desde un remito.
 */
export async function loadCatalog(db: Db, module: ReceiptModule): Promise<Map<string, CatalogItem>> {
  const out = new Map<string, CatalogItem>();
  if (module === "ME") {
    const rows = await db.select({ payload: invMeMaterials.payload }).from(invMeMaterials);
    for (const r of rows) {
      const m = r.payload as MeMaterial;
      if (m.archived) continue;
      const code = normalizeMeCodigo(m.codigo);
      if (!code || out.has(code)) continue;
      out.set(code, { code, description: String(m.descripcion || code), unit: String(m.unidad || "u") });
    }
    return out;
  }
  const [lots, balances] = await Promise.all([
    db.select({ payload: invMpStock.payload }).from(invMpStock),
    db.select({ codigo: mpStockBalances.codigo, descripcion: mpStockBalances.descripcion }).from(mpStockBalances),
  ]);
  for (const r of lots) {
    const l = r.payload as MpStockRow;
    if (l.archived) continue;
    const code = normalizeMaterialCode(l.codigo ?? "");
    if (!code || isMpInternalCodigo(code) || !/[\p{L}\p{N}]/u.test(code)) continue;
    if (!out.has(code) || (!out.get(code)!.description && l.descripcion)) out.set(code, { code, description: String(l.descripcion || code), unit: "kg" });
  }
  for (const b of balances) {
    const code = normalizeMaterialCode(b.codigo);
    if (!code || isMpInternalCodigo(code) || out.has(code)) continue;
    out.set(code, { code, description: String(b.descripcion || code), unit: "kg" });
  }
  return out;
}

export function searchCatalog(catalog: Map<string, CatalogItem>, q: string, limit = 30): CatalogItem[] {
  const needle = codeKey(q);
  const text = q.trim().toUpperCase();
  const all = [...catalog.values()];
  if (!needle && !text) return all.sort((a, b) => a.code.localeCompare(b.code)).slice(0, limit);
  return all
    .filter((m) => codeKey(m.code).includes(needle) || m.description.toUpperCase().includes(text))
    .sort((a, b) => Number(codeKey(b.code).startsWith(needle)) - Number(codeKey(a.code).startsWith(needle)) || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/** (proveedor, código del proveedor) → material interno, a partir de recepciones confirmadas. */
async function loadHistory(db: Db, module: ReceiptModule): Promise<MappingHistory> {
  const rows = await db
    .select({ supplier: inventoryReceipts.supplier, code: inventoryReceiptLines.supplierCode, material: inventoryReceiptLines.materialCode })
    .from(inventoryReceiptLines)
    .innerJoin(inventoryReceipts, eq(inventoryReceipts.id, inventoryReceiptLines.receiptId))
    .where(and(eq(inventoryReceiptLines.module, module), eq(inventoryReceipts.status, "CONFIRMADO"), sql`${inventoryReceiptLines.supplierCodeKey} <> ''`))
    .orderBy(desc(inventoryReceiptLines.createdAt))
    .limit(5000);
  const tally = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const k = mappingKey(r.supplier, r.code);
    const byMat = tally.get(k) ?? new Map<string, number>();
    byMat.set(r.material, (byMat.get(r.material) ?? 0) + 1);
    tally.set(k, byMat);
  }
  const history: MappingHistory = new Map();
  for (const [k, byMat] of tally) {
    const [code, count] = [...byMat.entries()].sort((a, b) => b[1] - a[1])[0]!;
    history.set(k, { code, count });
  }
  return history;
}

// ───────────────────────── Lectura de filas ─────────────────────────

type ReceiptRow = typeof inventoryReceipts.$inferSelect;

function readDraft(row: ReceiptRow): ReceiptDraftPayload {
  const p = (row.payload ?? {}) as Partial<ReceiptDraftPayload>;
  const header = { ...emptyHeader(), ...(p.header ?? {}) };
  const lines = Array.isArray(p.lines) ? p.lines.map((l, i) => ({ ...emptyLine(l?.id || `l${i}`), ...l, review: Array.isArray(l?.review) ? l.review : [] })) : [];
  return { header, lines, extraction: p.extraction ?? null };
}

async function loadFiles(db: Db, receiptId: string): Promise<ReceiptFile[]> {
  const rows = await db
    .select()
    .from(inventoryIngresoAdjuntos)
    .where(and(eq(inventoryIngresoAdjuntos.receiptId, receiptId), isNull(inventoryIngresoAdjuntos.deletedAt)))
    .orderBy(asc(inventoryIngresoAdjuntos.uploadedAt));
  return rows.map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, sizeBytes: f.sizeBytes, uploadedBy: f.uploadedBy, uploadedAt: f.uploadedAt.toISOString() }));
}

async function ingresoNumbers(db: Db, module: ReceiptModule, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const table = module === "MP" ? invMpIngresos : invMeIngresos;
  const rows = await db.select({ id: table.id, payload: table.payload }).from(table).where(inArray(table.id, ids));
  for (const r of rows) out.set(r.id, String((r.payload as { ingresoNro?: string }).ingresoNro ?? ""));
  return out;
}

async function toReceipt(db: Db, row: ReceiptRow): Promise<Receipt> {
  const mod = row.module as ReceiptModule;
  const files = await loadFiles(db, row.id);
  let confirmedLines: ReceiptLineConfirmed[] = [];
  let movements: ReceiptMovement[] = [];
  if (row.status === "CONFIRMADO") {
    const lines = await db.select().from(inventoryReceiptLines).where(eq(inventoryReceiptLines.receiptId, row.id)).orderBy(asc(inventoryReceiptLines.lineNo));
    const nros = await ingresoNumbers(db, mod, lines.map((l) => l.ingresoId));
    confirmedLines = lines.map((l) => ({
      lineNo: l.lineNo, supplierCode: l.supplierCode, description: l.description, materialCode: l.materialCode, materialLabel: l.materialLabel, quantity: l.quantity,
      remitoQuantity: l.remitoQuantity, unit: l.unit, packages: l.packages, lote: l.lote, vencimiento: l.vencimiento, notes: l.notes, ingresoId: l.ingresoId, ingresoNro: nros.get(l.ingresoId) ?? null,
    }));
    if (mod === "MP" && lines.length) {
      const mv = await db.select().from(mpStockMovements).where(inArray(mpStockMovements.refId, lines.map((l) => l.ingresoId))).orderBy(asc(mpStockMovements.createdAt));
      movements = mv.map((m) => ({ ingresoId: String(m.refId), ingresoNro: nros.get(String(m.refId)) ?? null, kind: m.kind, quantity: m.quantity, balanceAfter: m.balanceAfter, at: m.createdAt.toISOString() }));
    } else {
      movements = confirmedLines.map((l) => ({ ingresoId: l.ingresoId, ingresoNro: l.ingresoNro, kind: "INGRESO", quantity: l.quantity, balanceAfter: null, at: row.confirmedAt ? row.confirmedAt.toISOString() : null }));
    }
  }
  return {
    id: row.id, module: mod, status: row.status as ReceiptStatus, version: row.version, draft: readDraft(row), files, parentReceiptId: row.parentReceiptId,
    createdBy: row.createdBy, createdBySector: row.createdBySector, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    confirmedBy: row.confirmedBy, confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null, confirmedLines, movements,
  };
}

async function requireRow(db: Db, id: string, module?: ReceiptModule, forUpdate = false): Promise<ReceiptRow> {
  if (!UUID_RE.test(id)) throw new InventoryNotFoundError("No se encontró la recepción.");
  const q = db.select().from(inventoryReceipts).where(eq(inventoryReceipts.id, id)).limit(1);
  const [row] = forUpdate ? await (q as unknown as { for: (m: string) => Promise<ReceiptRow[]> }).for("update") : await q;
  if (!row) throw new InventoryNotFoundError("No se encontró la recepción.");
  if (module && row.module !== module) throw new InventoryForbiddenError("Esa recepción es de otro sector.");
  return row;
}

// ───────────────────────── Duplicados ─────────────────────────

async function loadExisting(db: Db, module: ReceiptModule, header: { supplier: string; remitoNumber: string }, excludeReceiptId: string): Promise<ExistingEntry[]> {
  const sk = supplierKey(header.supplier);
  const rk = remitoKey(header.remitoNumber);
  if (!sk || !rk) return [];
  const out: ExistingEntry[] = [];
  const receipts = await db
    .select()
    .from(inventoryReceipts)
    .where(and(eq(inventoryReceipts.module, module), eq(inventoryReceipts.status, "CONFIRMADO"), eq(inventoryReceipts.supplierKey, sk), eq(inventoryReceipts.remitoKey, rk)));
  const receiptIds = receipts.filter((r) => r.id !== excludeReceiptId).map((r) => r.id);
  const lines = receiptIds.length ? await db.select().from(inventoryReceiptLines).where(inArray(inventoryReceiptLines.receiptId, receiptIds)) : [];
  for (const r of receipts) {
    if (r.id === excludeReceiptId) continue;
    const nros = await ingresoNumbers(db, module, lines.filter((l) => l.receiptId === r.id).map((l) => l.ingresoId));
    out.push({
      source: "recepcion", id: r.id, supplierKey: sk, remitoKey: rk,
      label: `la recepción del ${r.receivedDate || "—"} (${[...nros.values()].filter(Boolean).join(", ") || "sin Nº"})`,
      lines: lines.filter((l) => l.receiptId === r.id).map((l) => ({ materialCode: l.materialCode, quantity: l.quantity })),
    });
  }
  // Ingresos cargados antes por las planillas (sin recepción): se comparan por proveedor + n.º de remito.
  const tail = rk.split("-").pop() ?? "";
  if (tail.length >= 2) {
    const table = module === "MP" ? invMpIngresos : invMeIngresos;
    const linked = new Set((await db.select({ id: inventoryReceiptLines.ingresoId }).from(inventoryReceiptLines).where(eq(inventoryReceiptLines.module, module))).map((x) => x.id));
    const rows = await db.select({ id: table.id, payload: table.payload }).from(table).where(sql`upper(${table.payload}->>'remitoNro') like ${`%${tail.toUpperCase()}%`}`);
    for (const r of rows) {
      if (linked.has(r.id)) continue;
      const p = r.payload as Partial<MpIngresoRow & MeIngresoRow> & { status?: string; anulado?: boolean };
      if (p.status === "ANULADO" || p.anulado) continue;
      if (remitoKey(String(p.remitoNro ?? "")) !== rk || supplierKey(String(p.proveedor ?? "")) !== sk) continue;
      const qty = Number(p.total ?? p.cantidad ?? 0);
      out.push({ source: "ingreso", id: r.id, supplierKey: sk, remitoKey: rk, label: `el ingreso ${p.ingresoNro ?? ""} (${p.fecha ?? ""})`, lines: [{ materialCode: String(p.codigo ?? ""), quantity: qty }] });
    }
  }
  return out;
}

async function fileDuplicates(db: Db, module: ReceiptModule, receiptId: string): Promise<Array<{ refId: string; source: "recepcion" | "ingreso"; label: string }>> {
  const mine = await db.select({ sha: inventoryIngresoAdjuntos.sha256 }).from(inventoryIngresoAdjuntos).where(and(eq(inventoryIngresoAdjuntos.receiptId, receiptId), isNull(inventoryIngresoAdjuntos.deletedAt)));
  const shas = [...new Set(mine.map((m) => m.sha))];
  if (!shas.length) return [];
  const same = await db
    .select({ id: inventoryIngresoAdjuntos.id, ingresoId: inventoryIngresoAdjuntos.ingresoId, receiptId: inventoryIngresoAdjuntos.receiptId })
    .from(inventoryIngresoAdjuntos)
    .where(and(eq(inventoryIngresoAdjuntos.module, module), inArray(inventoryIngresoAdjuntos.sha256, shas), isNull(inventoryIngresoAdjuntos.deletedAt)));
  const out: Array<{ refId: string; source: "recepcion" | "ingreso"; label: string }> = [];
  for (const f of same) {
    if (f.receiptId === receiptId) continue;
    if (f.receiptId) {
      const [r] = await db.select({ status: inventoryReceipts.status, d: inventoryReceipts.receivedDate }).from(inventoryReceipts).where(eq(inventoryReceipts.id, f.receiptId)).limit(1);
      // Un borrador abandonado de otra persona no cuenta: solo lo ya confirmado.
      if (r?.status === "CONFIRMADO") out.push({ refId: f.receiptId, source: "recepcion", label: `la recepción del ${r.d || "—"}` });
    } else out.push({ refId: f.ingresoId, source: "ingreso", label: "un ingreso anterior" });
  }
  return out;
}

// ───────────────────────── Servicio ─────────────────────────

export class ReceiptService {
  constructor(private readonly deps: { extract?: typeof extractRemito; extractionConfig?: () => ExtractionConfig } = {}) {}

  config(): ExtractionConfig {
    return (this.deps.extractionConfig ?? extractionConfig)();
  }

  async createDraft(actor: InventoryActor, module: ReceiptModule): Promise<Receipt> {
    assertWrite(actor, module);
    const header = { ...emptyHeader(), receivedDate: todayIso() };
    const payload: ReceiptDraftPayload = { header, lines: [], extraction: null };
    const [row] = await getDb()
      .insert(inventoryReceipts)
      .values({ module, status: "BORRADOR", receivedDate: header.receivedDate, payload, createdBy: actor.email, createdBySector: actor.sector })
      .returning();
    return toReceipt(getDb(), row!);
  }

  async get(actor: InventoryActor, id: string, module: ReceiptModule): Promise<Receipt> {
    assertRead(actor, module);
    const row = await requireRow(getDb(), id, module);
    if (row.status !== "CONFIRMADO" && !canWriteSafe(actor, module)) throw new InventoryForbiddenError("Ese borrador todavía no fue confirmado.");
    return toReceipt(getDb(), row);
  }

  async list(actor: InventoryActor, module: ReceiptModule, opts: { limit?: number } = {}): Promise<ReceiptSummary[]> {
    assertRead(actor, module);
    const writer = canWriteSafe(actor, module);
    const rows = await getDb()
      .select()
      .from(inventoryReceipts)
      .where(and(eq(inventoryReceipts.module, module), writer ? sql`${inventoryReceipts.status} <> 'DESCARTADO'` : eq(inventoryReceipts.status, "CONFIRMADO")))
      .orderBy(desc(inventoryReceipts.createdAt))
      .limit(Math.min(opts.limit ?? 100, 300));
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [fc, lc] = await Promise.all([
      getDb().select({ id: inventoryIngresoAdjuntos.receiptId, n: sql<number>`count(*)::int` }).from(inventoryIngresoAdjuntos).where(and(inArray(inventoryIngresoAdjuntos.receiptId, ids), isNull(inventoryIngresoAdjuntos.deletedAt))).groupBy(inventoryIngresoAdjuntos.receiptId),
      getDb().select({ id: inventoryReceiptLines.receiptId, n: sql<number>`count(*)::int` }).from(inventoryReceiptLines).where(inArray(inventoryReceiptLines.receiptId, ids)).groupBy(inventoryReceiptLines.receiptId),
    ]);
    return rows.map((r) => {
      const d = readDraft(r);
      return {
        id: r.id, module, status: r.status as ReceiptStatus, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), confirmedBy: r.confirmedBy,
        confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null, supplier: r.supplier || d.header.supplier, remitoNumber: r.remitoNumber || d.header.remitoNumber,
        receivedDate: r.receivedDate || d.header.receivedDate, parentReceiptId: r.parentReceiptId,
        lineCount: r.status === "CONFIRMADO" ? Number(lc.find((x) => x.id === r.id)?.n ?? 0) : d.lines.length,
        fileCount: Number(fc.find((x) => x.id === r.id)?.n ?? 0),
      };
    });
  }

  /** Catálogo real para elegir el material (búsqueda por código o descripción). */
  async catalog(actor: InventoryActor, module: ReceiptModule, q: string): Promise<CatalogItem[]> {
    assertRead(actor, module);
    return searchCatalog(await loadCatalog(getDb(), module), q);
  }

  /** Guarda el borrador (NO toca stock). Versión optimista: si otra persona lo cambió, se rechaza. */
  async saveDraft(actor: InventoryActor, id: string, module: ReceiptModule, input: { expectedVersion: number; header: unknown; lines: unknown }): Promise<Receipt> {
    assertWrite(actor, module);
    const db = getDb();
    const row = await requireRow(db, id, module);
    if (row.status !== "BORRADOR") throw new ReceiptError("Esta recepción ya no es un borrador.", 409, "NOT_DRAFT");
    const draft = sanitizeDraft(input.header, input.lines, readDraft(row).extraction ?? null);
    const h = draft.header;
    const res = await db
      .update(inventoryReceipts)
      .set({
        payload: draft, supplier: h.supplier, supplierKey: supplierKey(h.supplier), remitoNumber: h.remitoNumber, remitoKey: remitoKey(h.remitoNumber),
        remitoDate: h.remitoDate, receivedDate: h.receivedDate, notes: h.notes, version: sql`${inventoryReceipts.version} + 1`, updatedAt: new Date(),
      })
      .where(and(eq(inventoryReceipts.id, id), eq(inventoryReceipts.status, "BORRADOR"), eq(inventoryReceipts.version, Number(input.expectedVersion))))
      .returning();
    if (!res[0]) throw new ReceiptError("Otra persona modificó este borrador. Recargá y revisá antes de seguir.", 409, "CONFLICT");
    return toReceipt(db, res[0]);
  }

  async discard(actor: InventoryActor, id: string, module: ReceiptModule): Promise<void> {
    assertWrite(actor, module);
    const res = await getDb()
      .update(inventoryReceipts)
      .set({ status: "DESCARTADO", discardedBy: actor.email, discardedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(inventoryReceipts.id, id), eq(inventoryReceipts.module, module), eq(inventoryReceipts.status, "BORRADOR")))
      .returning({ id: inventoryReceipts.id });
    if (!res[0]) throw new ReceiptError("Solo se puede descartar un borrador.", 409, "NOT_DRAFT");
  }

  // ── Archivos ──

  async addFile(actor: InventoryActor, id: string, module: ReceiptModule, file: { fileName: string; bytes: Uint8Array }): Promise<ReceiptFile> {
    assertWrite(actor, module);
    const db = getDb();
    const row = await requireRow(db, id, module);
    if (row.status !== "BORRADOR") throw new ReceiptError("Solo se agregan archivos mientras la recepción es un borrador.", 409, "NOT_DRAFT");
    const meta = validateReceiptFileMeta({ name: file.fileName, size: file.bytes.length });
    if (meta) throw new InventoryValidationError(meta);
    const type = sniffReceiptFileType(file.bytes);
    if (!type) throw new InventoryValidationError(`«${file.fileName}» no es una imagen JPG, PNG, HEIC ni un PDF válido.`);
    const current = await loadFiles(db, id);
    if (current.length >= RECEIPT_MAX_FILES) throw new InventoryValidationError(`Máximo ${RECEIPT_MAX_FILES} archivos por remito.`);
    const storage = getFileStorage();
    const sha = storage.sha256(file.bytes);
    // El mismo archivo dos veces en el mismo remito: no se guarda de nuevo.
    const [dup] = await db.select().from(inventoryIngresoAdjuntos).where(and(eq(inventoryIngresoAdjuntos.receiptId, id), eq(inventoryIngresoAdjuntos.sha256, sha), isNull(inventoryIngresoAdjuntos.deletedAt))).limit(1);
    if (dup) return { id: dup.id, fileName: dup.fileName, contentType: dup.contentType, sizeBytes: dup.sizeBytes, uploadedBy: dup.uploadedBy, uploadedAt: dup.uploadedAt.toISOString() };
    const fid = randomUUID();
    const storageKey = `ingresos-remitos/${module.toLowerCase()}/recepciones/${id}/${fid}-${safeFileName(file.fileName)}`;
    const put = await storage.put({ storageKey, bytes: file.bytes, contentType: type });
    try {
      const [ins] = await db
        .insert(inventoryIngresoAdjuntos)
        .values({
          id: fid, module, ingresoId: id, receiptId: id, storageProvider: STORAGE_PROVIDER_VERCEL_BLOB_PRIVATE, storageKey, fileName: file.fileName.slice(0, 200),
          contentType: type, sizeBytes: put.sizeBytes, sha256: put.sha256, uploadedBy: actor.email, uploadedBySector: actor.sector,
        })
        .returning();
      return { id: ins!.id, fileName: ins!.fileName, contentType: ins!.contentType, sizeBytes: ins!.sizeBytes, uploadedBy: ins!.uploadedBy, uploadedAt: ins!.uploadedAt.toISOString() };
    } catch (err) {
      await storage.delete(storageKey).catch(() => {});
      throw err;
    }
  }

  async removeFile(actor: InventoryActor, id: string, module: ReceiptModule, fileId: string): Promise<void> {
    assertWrite(actor, module);
    const row = await requireRow(getDb(), id, module);
    if (row.status !== "BORRADOR") throw new ReceiptError("El comprobante de un ingreso confirmado no se puede quitar.", 409, "NOT_DRAFT");
    await getDb()
      .update(inventoryIngresoAdjuntos)
      .set({ deletedAt: new Date(), deletedBy: actor.email })
      .where(and(eq(inventoryIngresoAdjuntos.id, fileId), eq(inventoryIngresoAdjuntos.receiptId, id), isNull(inventoryIngresoAdjuntos.deletedAt)));
  }

  // ── Lectura automática (sugerencia) ──

  /**
   * Lee el remito con el servicio configurado y COMPLETA el borrador: encabezado (solo campos vacíos), una línea por renglón del remito
   * y, cuando es inequívoco, el material del catálogo. NO pisa lo que ya escribió la persona (salvo `replace`). Es una sugerencia: nada
   * confirma ni mueve stock. Si el servicio está apagado, falla o no entiende el remito, devuelve el motivo y el borrador intacto.
   */
  async extract(actor: InventoryActor, id: string, module: ReceiptModule, opts: { replace?: boolean } = {}): Promise<{ receipt: Receipt; applied: boolean; message: string; kind: string; analysis: Analysis | null }> {
    assertWrite(actor, module);
    const db = getDb();
    const row = await requireRow(db, id, module);
    if (row.status !== "BORRADOR") throw new ReceiptError("Esta recepción ya no es un borrador.", 409, "NOT_DRAFT");
    const cfg = this.config();
    const fail = async (message: string, kind: string, persist: boolean) => {
      let current = row;
      if (persist) {
        const next = { ...readDraft(row), extraction: { provider: cfg.provider ?? "", at: new Date().toISOString(), ok: false, note: message } };
        await db.update(inventoryReceipts).set({ payload: next, updatedAt: new Date() }).where(eq(inventoryReceipts.id, id));
        current = { ...row, payload: next };
      }
      return { receipt: await toReceipt(db, current), applied: false, message, kind, analysis: null as Analysis | null };
    };
    if (!cfg.available) return fail(cfg.reason, cfg.code, false);
    const files = await db.select().from(inventoryIngresoAdjuntos).where(and(eq(inventoryIngresoAdjuntos.receiptId, id), isNull(inventoryIngresoAdjuntos.deletedAt))).orderBy(asc(inventoryIngresoAdjuntos.uploadedAt));
    if (!files.length) return fail("Primero sacá o subí la foto del remito.", "no_files", false);
    const storage = getFileStorage();
    let loaded: Array<{ bytes: Uint8Array; contentType: string }>;
    try {
      loaded = await Promise.all(files.map(async (f) => ({ bytes: (await storage.get(f.storageKey)).bytes, contentType: f.contentType })));
    } catch (err) {
      console.warn("[ingreso-remito] no se pudo leer el archivo guardado para la lectura automática", err instanceof Error ? err.message : err);
      return fail("No se pudo abrir la foto guardada para leerla. Reintentá o completá los datos manualmente.", "storage", true);
    }
    const out = await (this.deps.extract ?? extractRemito)(loaded);
    if (!out.ok) return fail(out.message, "kind" in out ? out.kind : "unavailable", true);

    const draft = readDraft(row);
    const history = await loadHistory(db, module);
    const catalog = await loadCatalog(db, module);
    const d = out.data;
    const base = opts.replace ? { header: { ...emptyHeader(), receivedDate: draft.header.receivedDate }, lines: [] as ReceiptLineDraft[] } : draft;
    const header = { ...base.header };
    const pick = (cur: string, next: string) => (cur.trim() ? cur : next);
    header.supplier = pick(header.supplier, d.supplier);
    header.remitoNumber = pick(header.remitoNumber, d.remitoNumber);
    header.remitoDate = pick(header.remitoDate, d.remitoDate);
    header.notes = pick(header.notes, d.notes);
    const keepLines = base.lines.some((l) => l.description || l.quantity || l.materialCode || l.supplierCode);
    const lines = keepLines
      ? base.lines
      : d.lines.map((l, i): ReceiptLineDraft => {
          const match = autoMatchMaterial({ supplier: header.supplier, supplierCode: l.supplierCode, description: l.description, unit: l.unit }, catalog, history, module);
          return {
            ...emptyLine(`x${i}-${randomUUID().slice(0, 6)}`), supplierCode: l.supplierCode, description: l.description, quantity: l.quantity, unit: l.unit, packages: l.packages, lote: l.lote,
            vencimiento: l.vencimiento, notes: l.notes, remitoQuantity: l.quantity,
            // «Revisar» siempre incluye lo que el servicio no pudo leer; un material elegido automáticamente se marca aparte.
            review: match ? l.review : [...new Set([...l.review, "materialCode"])],
            materialCode: match?.code ?? "", matchSource: match?.source ?? "", matchReason: match?.reason ?? "",
          };
        });
    const review = [...d.headerReview];
    const note = review.length ? `Revisar: ${review.join(", ")}` : undefined;
    const next: ReceiptDraftPayload = { header, lines, extraction: { provider: out.provider, at: new Date().toISOString(), ok: true, note } };
    const h = next.header;
    const [upd] = await db
      .update(inventoryReceipts)
      .set({
        payload: next, supplier: h.supplier, supplierKey: supplierKey(h.supplier), remitoNumber: h.remitoNumber, remitoKey: remitoKey(h.remitoNumber), remitoDate: h.remitoDate,
        notes: h.notes, version: sql`${inventoryReceipts.version} + 1`, updatedAt: new Date(),
      })
      .where(and(eq(inventoryReceipts.id, id), eq(inventoryReceipts.status, "BORRADOR")))
      .returning();
    const finalRow = upd ?? row;
    const message = keepLines
      ? "Se completaron los datos faltantes del encabezado. Tus materiales no se tocaron."
      : lines.length
        ? "Remito analizado. Revisá los datos antes de confirmar."
        : "Se leyó el encabezado pero no se detectaron materiales. Agregalos a mano.";
    return { receipt: await toReceipt(db, finalRow), applied: true, message, kind: "ok", analysis: await this.analyzeRow(db, finalRow, module) };
  }

  // ── Revisión (sin escribir) ──

  async analyze(actor: InventoryActor, id: string, module: ReceiptModule): Promise<Analysis> {
    assertWrite(actor, module);
    const db = getDb();
    const row = await requireRow(db, id, module);
    return this.analyzeRow(db, row, module);
  }

  private async analyzeRow(db: Db, row: ReceiptRow, module: ReceiptModule): Promise<Analysis> {
    const draft = readDraft(row);
    const catalog = await loadCatalog(db, module);
    const validation = validateReceipt(module, draft, catalog, todayIso());
    const history = await loadHistory(db, module);
    const suggestions: Record<string, MaterialSuggestion[]> = {};
    const preselected: Record<string, string> = {};
    for (const l of draft.lines) {
      suggestions[l.id] = suggestMaterials({ supplier: draft.header.supplier, supplierCode: l.supplierCode, description: l.description }, catalog.values(), history);
      const pre = preselectFromHistory({ supplier: draft.header.supplier, supplierCode: l.supplierCode }, history);
      if (pre && catalog.has(normalizeMaterialCode(pre))) preselected[l.id] = normalizeMaterialCode(pre);
    }
    const files = await loadFiles(db, row.id);
    const warnings = await this.duplicateWarnings(db, module, row.id, draft, validation);
    const issues = [...validation.issues];
    if (!files.length) issues.push({ line: null, field: "files", code: "NO_FILE", message: "Falta la foto o el PDF del remito: el ingreso lleva su comprobante." });
    return { validation: { ok: issues.length === 0, issues }, suggestions, preselected, warnings, fileCount: files.length, ready: issues.length === 0 };
  }

  private async duplicateWarnings(db: Db, module: ReceiptModule, receiptId: string, draft: ReceiptDraftPayload, validation: ValidationResult): Promise<DuplicateWarning[]> {
    const lines = validation.lines.length ? validation.lines : draft.lines.flatMap((l) => (l.materialCode ? [{ materialCode: normalizeMaterialCode(l.materialCode), quantity: Number(l.quantity.replace(",", ".")) || 0 }] : []));
    const existing = await loadExisting(db, module, draft.header, receiptId);
    return classifyDuplicates({
      supplier: draft.header.supplier, remitoNumber: draft.header.remitoNumber,
      lines: lines.map((l) => ({ materialCode: l.materialCode, quantity: l.quantity })), existing, fileMatches: await fileDuplicates(db, module, receiptId),
    });
  }

  // ── Confirmación ──

  /**
   * Confirma el ingreso de stock. Atómico e idempotente: `confirmKey` identifica este intento (el mismo valor = mismo resultado,
   * sin sumar de nuevo). `acknowledgeDuplicates` es obligatorio si el remito parece ya cargado o el archivo ya existe.
   */
  async confirm(actor: InventoryActor, id: string, module: ReceiptModule, input: { expectedVersion: number; confirmKey: string; acknowledgeDuplicates?: boolean; parentReceiptId?: string | null }): Promise<Receipt> {
    assertWrite(actor, module);
    const key = String(input.confirmKey ?? "").trim();
    if (key.length < 8 || key.length > 80) throw new InventoryValidationError("Falta la clave de confirmación del ingreso.");
    if (module === "MP") {
      const receipt = await runMpInventoryOp(actor, async ({ service, tx }) => {
        const row = await requireRow(tx, id, module, true);
        if (replayOrReject(row, key)) return id;
        const prepared = await this.prepareConfirm(tx, row, module, input);
        const created: Array<{ ingresoId: string; line: (typeof prepared.lines)[number] }> = [];
        for (const line of prepared.lines) {
          const parts = splitPackages(line.quantity, line.packages);
          let ingreso: MpIngresoRow;
          try {
            ingreso = await service.upsertMpIngreso(actor, {
              id: randomUUID(), fecha: prepared.header.receivedDate, proveedor: prepared.header.supplier.trim(), remitoNro: prepared.header.remitoNumber.trim(),
              codigo: line.materialCode, descripcion: line.description || line.materialLabel, bultos: parts.bultos ?? 1, cantidad: parts.cantidad,
              lote: line.lote, vencimiento: line.vencimiento, confirm: true, auditReason: `Ingreso con remito (recepción ${id})`,
            });
          } catch (err) {
            if (err instanceof InventoryValidationError) throw new ReceiptError(`Línea ${line.index + 1}: ${err.message}`, 409, "REJECTED_BY_INVENTORY");
            throw err;
          }
          if (ingreso.status !== "CONFIRMADO" || !ingreso.stockImpacted) throw new ReceiptError(`Línea ${line.index + 1}: el ingreso no pudo sumar al stock. No se confirmó nada.`, 409, "NOT_CONFIRMED");
          created.push({ ingresoId: ingreso.id, line });
        }
        await finalizeConfirm(tx, actor, row, module, key, prepared, created.map((c) => ({ ingresoId: c.ingresoId, line: c.line })), input.parentReceiptId ?? null);
        return id;
      });
      // Los ingresos de MP se escriben al cerrar la operación: recién ahora se pueden leer sus números y movimientos.
      return toReceipt(getDb(), await requireRow(getDb(), receipt, module));
    }
    // ME
    const receipt = await getDb().transaction(async (tx) => {
      const row = await requireRow(tx, id, module, true);
      if (replayOrReject(row, key)) return toReceipt(tx, row);
      const draft = readDraft(row);
      await lockCodigos(tx, draft.lines.map((l) => l.materialCode));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('genus-me-ingreso-nro'))`);
      const prepared = await this.prepareConfirm(tx, row, module, input);
      const all = await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos);
      let next = all.reduce((m, r) => Math.max(m, Number(/^ME-I-(\d+)$/.exec(String((r.payload as MeIngresoRow).ingresoNro ?? ""))?.[1] ?? 0)), 0);
      const catalog = await loadMeMaterialIds(tx);
      const created: Array<{ ingresoId: string; line: (typeof prepared.lines)[number] }> = [];
      const now = new Date().toISOString();
      for (const line of prepared.lines) {
        const parts = splitPackages(line.quantity, line.packages);
        const ingresoId = randomUUID();
        next += 1;
        const mat = catalog.get(line.materialCode)!;
        const ingreso: MeIngresoRow = {
          id: ingresoId, fecha: prepared.header.receivedDate, ingresoNro: `ME-I-${String(next).padStart(5, "0")}`, proveedor: prepared.header.supplier.trim(), cliente: mat.cliente ?? "",
          remitoNro: prepared.header.remitoNumber.trim(), codigo: line.materialCode, descripcionInsumo: line.description || line.materialLabel,
          bultos: parts.bultos ?? 1, cantidad: parts.cantidad, total: line.quantity, ubicacion: mat.ubicacion ?? "", materialId: mat.id, anulado: false, anuladoAt: null, anuladoReason: null,
          createdBy: actor.email, updatedBy: actor.email, createdAt: now, updatedAt: now,
        };
        await tx.insert(invMeIngresos).values({ id: ingresoId, payload: ingreso, updatedAt: new Date(now) });
        const a = auditRow(actor, "me_ingresos", ingresoId, "create", null, ingreso as unknown as Record<string, unknown>, `Ingreso con remito (recepción ${id})`);
        await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
        created.push({ ingresoId, line });
      }
      await finalizeConfirm(tx, actor, row, module, key, prepared, created, input.parentReceiptId ?? null);
      return toReceipt(tx, await requireRow(tx, id, module));
    });
    await refreshMeAlertsBestEffort(actor, receipt);
    return receipt;
  }

  /** Validaciones del lado servidor justo antes de escribir (con la base bloqueada). */
  private async prepareConfirm(db: Db, row: ReceiptRow, module: ReceiptModule, input: { expectedVersion: number; acknowledgeDuplicates?: boolean; parentReceiptId?: string | null }) {
    if (row.status === "DESCARTADO") throw new ReceiptError("Este borrador fue descartado.", 409, "DISCARDED");
    if (row.version !== Number(input.expectedVersion)) throw new ReceiptError("El borrador cambió mientras lo revisabas. Recargá y volvé a confirmar.", 409, "CONFLICT");
    const draft = readDraft(row);
    const catalog = await loadCatalog(db, module);
    const validation = validateReceipt(module, draft, catalog, todayIso());
    const files = await loadFiles(db, row.id);
    const issues = [...validation.issues];
    if (!files.length) issues.push({ line: null, field: "files", code: "NO_FILE", message: "Falta la foto o el PDF del remito: el ingreso lleva su comprobante." });
    if (issues.length) throw new ReceiptError(issues[0]!.message, 422, "INVALID", { issues });
    const warnings = await this.duplicateWarnings(db, module, row.id, draft, validation);
    if (warnings.some((w) => w.requiresAck) && !input.acknowledgeDuplicates) {
      throw new ReceiptError("Este remito parece ya registrado. Revisá la advertencia y confirmá que querés cargarlo igual.", 409, "DUPLICATE", { warnings });
    }
    if (input.parentReceiptId) {
      if (!UUID_RE.test(input.parentReceiptId)) throw new InventoryValidationError("Recepción vinculada inválida.");
      const [p] = await db.select({ m: inventoryReceipts.module, s: inventoryReceipts.status }).from(inventoryReceipts).where(eq(inventoryReceipts.id, input.parentReceiptId)).limit(1);
      if (!p || p.m !== module || p.s !== "CONFIRMADO") throw new InventoryValidationError("La recepción a vincular no existe o no está confirmada.");
    }
    return { header: draft.header, lines: validation.lines };
  }
}

type Prepared = { header: ReceiptDraftPayload["header"]; lines: ValidationResult["lines"] };

/** Si ya está confirmada con la MISMA clave → devuelve el resultado sin tocar nada (reintento / doble clic). Con otra clave → conflicto. */
function replayOrReject(row: ReceiptRow, key: string): boolean {
  if (row.status !== "CONFIRMADO") return false;
  if (row.confirmKey === key) return true;
  throw new ReceiptError("Este remito ya fue confirmado por otra persona o en otro intento. El stock no se sumó de nuevo.", 409, "ALREADY_CONFIRMED");
}

async function finalizeConfirm(tx: Db, actor: InventoryActor, row: ReceiptRow, module: ReceiptModule, key: string, prepared: Prepared, created: Array<{ ingresoId: string; line: Prepared["lines"][number] }>, parentReceiptId: string | null) {
  if (created.length) {
    await tx.insert(inventoryReceiptLines).values(
      created.map((c, i) => ({
        receiptId: row.id, module, lineNo: i + 1, supplierCode: c.line.supplierCode, supplierCodeKey: codeKey(c.line.supplierCode), description: c.line.description,
        materialCode: c.line.materialCode, materialLabel: c.line.materialLabel, remitoQuantity: c.line.remitoQuantity, quantity: c.line.quantity, unit: c.line.unit,
        packages: c.line.packages, lote: c.line.lote, vencimiento: c.line.vencimiento, notes: c.line.notes, ingresoId: c.ingresoId,
      }))
    );
  }
  const updated = await tx
    .update(inventoryReceipts)
    .set({
      status: "CONFIRMADO", confirmKey: key, ingresoIds: created.map((c) => c.ingresoId), confirmedBy: actor.email, confirmedAt: new Date(), updatedAt: new Date(),
      version: sql`${inventoryReceipts.version} + 1`, parentReceiptId, supplier: prepared.header.supplier.trim(), supplierKey: supplierKey(prepared.header.supplier),
      remitoNumber: prepared.header.remitoNumber.trim(), remitoKey: remitoKey(prepared.header.remitoNumber),
    })
    .where(and(eq(inventoryReceipts.id, row.id), eq(inventoryReceipts.status, "BORRADOR")))
    .returning({ id: inventoryReceipts.id });
  if (!updated[0]) throw new ReceiptError("Este remito ya fue confirmado. El stock no se sumó de nuevo.", 409, "ALREADY_CONFIRMED");
  const a = auditRow(actor, module === "MP" ? "mp_ingresos" : "me_ingresos", row.id, "receipt_confirm", null, { receiptId: row.id, ingresos: created.map((c) => c.ingresoId), lines: created.length }, `Ingreso con remito ${prepared.header.remitoNumber}`);
  await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
}

async function loadMeMaterialIds(db: Db): Promise<Map<string, MeMaterial>> {
  const out = new Map<string, MeMaterial>();
  for (const r of await db.select({ payload: invMeMaterials.payload }).from(invMeMaterials)) {
    const m = r.payload as MeMaterial;
    if (m.archived) continue;
    const code = normalizeMeCodigo(m.codigo);
    if (code && !out.has(code)) out.set(code, m);
  }
  return out;
}

/** El stock de ME se deriva del libro; los avisos de stock bajo/recuperado se refrescan con el servicio de siempre. Nunca rompe la confirmación. */
async function refreshMeAlertsBestEffort(actor: InventoryActor, receipt: Receipt) {
  try {
    const [{ getInventoryService, memoryInventoryRepo }, { hydrateInventoryFromNeon, persistInventorySnapshot }] = await Promise.all([import("@/lib/inventory/get-inventory-service"), import("@/lib/inventory/neon-persist")]);
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    const service = getInventoryService();
    const ids = new Set<string>();
    for (const l of receipt.confirmedLines) {
      const m = service.getMeMaterialByCodigo(actor, l.materialCode);
      if (m?.id) ids.add(m.id);
    }
    for (const id of ids) service.syncMeAlertsPublic(actor, id);
    await persistInventorySnapshot(memoryInventoryRepo);
  } catch (err) {
    console.warn("[ingreso-remito] avisos de ME no actualizados", err instanceof Error ? err.message : err);
  }
}

// ───────────────────────── Saneamiento del borrador ─────────────────────────

const t = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v).slice(0, max) : "");

/** El cliente manda el borrador completo: se limpia campo por campo (tipos, largos, fechas) antes de guardarlo. */
export function sanitizeDraft(headerIn: unknown, linesIn: unknown, extraction: ReceiptDraftPayload["extraction"]): ReceiptDraftPayload {
  const h = (headerIn && typeof headerIn === "object" ? headerIn : {}) as Record<string, unknown>;
  const date = (v: unknown) => {
    const s = t(v, 10);
    return isIsoDate(s) ? s : "";
  };
  const header = { supplier: t(h.supplier, 120), remitoNumber: t(h.remitoNumber, 60), remitoDate: date(h.remitoDate), receivedDate: date(h.receivedDate), notes: t(h.notes, 500) };
  const arr = Array.isArray(linesIn) ? linesIn.slice(0, RECEIPT_MAX_LINES) : [];
  const lines = arr.map((raw, i): ReceiptLineDraft => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      id: t(l.id, 40) || `l${i}`, supplierCode: t(l.supplierCode, 60), description: t(l.description, 200), materialCode: normalizeMaterialCode(t(l.materialCode, 60)),
      quantity: t(l.quantity, 24), remitoQuantity: t(l.remitoQuantity, 24), unit: t(l.unit, 20), packages: t(l.packages, 12), lote: t(l.lote, 60), vencimiento: date(l.vencimiento),
      noExpiry: l.noExpiry === true, notes: t(l.notes, 300), review: Array.isArray(l.review) ? l.review.map((x) => t(x, 30)).filter(Boolean).slice(0, 12) : [],
      matchSource: l.matchSource === "previo" || l.matchSource === "codigo" || l.matchSource === "nombre" || l.matchSource === "manual" ? l.matchSource : "",
      matchReason: t(l.matchReason, 160),
    };
  });
  return { header, lines, extraction };
}

export function getReceiptService(): ReceiptService {
  if (!isDatabaseConfigured()) throw new InventoryValidationError("No hay conexión con la base de datos: no se pueden registrar ingresos.");
  return new ReceiptService();
}
