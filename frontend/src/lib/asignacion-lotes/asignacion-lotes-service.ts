/**
 * Asignación de lotes — Neon (Production) o memoria de proceso (vitest / sin DATABASE_URL).
 */
import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { parseFlexibleDate } from "@/features/os/operational/lib/delivery-date";
import {
  canAccessAsignacionLotes,
  canMutateAsignacionLotes,
} from "@/features/os/operational/lib/asignacion-lotes-rbac";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLotes, asignacionLotesCellAudit, workItems } from "@/lib/db/schema";
import { fillBareWorkItemsFromAsignacionLote } from "./sync-to-bare-workitems";
import { hasWritebackSince } from "./writeback-ops";
import { normalizeOptionalReason } from "@/lib/lifecycle/reason";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import {
  ASIGNACION_CELL_FIELDS,
  ASIGNACION_CELL_KIND,
  IDENTITY_FIELDS,
  MAX_CELL_CHANGES_PER_REQUEST,
  cellProtectionReason,
  isAsignacionCellField,
  validateCellValue,
  type AsignacionCellChange,
  type AsignacionCellField,
  type AsignacionCellFailure,
} from "./cell-edit";
import type {
  AsignacionLote,
  AsignacionLoteImportResult,
  AsignacionLotesActor,
  AsignacionLoteUpsertInput,
} from "./types";

const g = globalThis as unknown as { __genusAsignacionLotesMem?: AsignacionLote[] };

function mem(): AsignacionLote[] {
  if (!g.__genusAsignacionLotesMem) {
    g.__genusAsignacionLotesMem = [];
  }
  return g.__genusAsignacionLotesMem;
}

export function resetAsignacionLotesMemoryForTests(): void {
  g.__genusAsignacionLotesMem = [];
}

function useNeon(): boolean {
  return isDatabaseConfigured();
}

function makeId(): string {
  return `al-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Identidad (lote,código,PRODUCTO) — ampliada 0038 (antes solo lote,
 * código). Causa demostrada con datos reales (lote G26042, AGOSTO 2026):
 * dos productos DISTINTOS comparten el mismo lote y ambos tienen código
 * vacío — con (lote,código) solo, colapsaban a la misma identidad y uno se
 * perdía/pisaba al otro. Agregar producto los distingue sin afectar los
 * casos donde código ya alcanzaba (ahí producto es redundante, no daña).
 */
function duplicateKey(lote: string, codigo: string, producto: string): string {
  return `${normalizeKeyPart(lote)}::${normalizeKeyPart(codigo)}::${normalizeKeyPart(producto)}`;
}

function asOptionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return parseFlexibleDate(value) ?? null;
}

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return parseFlexibleDate(value) ?? value.slice(0, 10);
}

function migrateRecord(raw: unknown, now = new Date().toISOString()): AsignacionLote {
  const record = (raw ?? {}) as Record<string, unknown>;
  const createdAt = asString(record.createdAt) || asString(record.updatedAt) || now;
  const updatedAt = asString(record.updatedAt) || createdAt;
  return {
    id: asString(record.id) || makeId(),
    lote: asString(record.lote),
    fecha: asOptionalDate(record.fecha) ?? now.slice(0, 10),
    producto: asString(record.producto),
    codigo: asString(record.codigo),
    marca: asString(record.marca),
    cantidades: asNumber(record.cantidades) ?? asNumber(record.cantidad) ?? 0,
    vto: asOptionalDate(record.vto) ?? asOptionalDate(record.vencimiento),
    muestras: asString(record.muestras),
    cjMuestra: asString(record.cjMuestra) || asString(record.cj_muestra),
    fechaAnalisis: asOptionalDate(record.fechaAnalisis) ?? asOptionalDate(record.fecha_analisis),
    observaciones: asString(record.observaciones) || asString(record.notes),
    createdAt,
    createdBy: asString(record.createdBy),
    updatedAt,
    updatedBy: asString(record.updatedBy),
    archived: Boolean(record.archived),
    datosIncompletos: Boolean(record.datosIncompletos),
    camposIncompletos: Array.isArray(record.camposIncompletos) ? (record.camposIncompletos as string[]) : null,
  };
}

function rowToDomain(row: typeof asignacionLotes.$inferSelect): AsignacionLote {
  return {
    id: row.id,
    lote: row.lote,
    fecha: row.fecha,
    producto: row.producto,
    codigo: row.codigo,
    marca: row.marca,
    cantidades: Number(row.cantidades) || 0,
    vto: row.vto,
    muestras: row.muestras,
    cjMuestra: row.cjMuestra,
    fechaAnalisis: row.fechaAnalisis,
    observaciones: row.observaciones,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archived: row.archived,
    sourceId: row.sourceId ?? null,
    sourceSheetTab: row.sourceSheetTab ?? null,
    datosIncompletos: row.datosIncompletos,
    camposIncompletos: (row.camposIncompletos as string[] | null) ?? null,
  };
}

function domainToInsert(record: AsignacionLote): typeof asignacionLotes.$inferInsert {
  return {
    id: record.id,
    lote: record.lote,
    fecha: record.fecha,
    producto: record.producto,
    codigo: record.codigo,
    marca: record.marca,
    cantidades: String(record.cantidades),
    vto: dateOnly(record.vto),
    muestras: record.muestras,
    cjMuestra: record.cjMuestra,
    fechaAnalisis: dateOnly(record.fechaAnalisis),
    observaciones: record.observaciones,
    archived: record.archived ?? false,
    createdAt: new Date(record.createdAt),
    createdBy: record.createdBy,
    updatedAt: new Date(record.updatedAt),
    updatedBy: record.updatedBy,
    sourceId: record.sourceId ?? null,
    sourceSheetTab: record.sourceSheetTab ?? null,
    datosIncompletos: record.datosIncompletos ?? false,
    camposIncompletos: record.camposIncompletos ?? null,
  };
}

function assertAccess(actor: AsignacionLotesActor): void {
  if (!canAccessAsignacionLotes(actor.sector)) {
    throw new OrdersForbiddenError(
      "Este módulo está habilitado solo para Calidad, Producción y Codificado."
    );
  }
}

function assertMutate(actor: AsignacionLotesActor): void {
  if (!canMutateAsignacionLotes(actor.sector)) {
    throw new OrdersForbiddenError("No tenés permiso para modificar asignaciones de lotes.");
  }
}

function findDuplicateMem(
  lote: string,
  codigo: string,
  producto: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): AsignacionLote | null {
  const key = duplicateKey(lote, codigo, producto);
  return (
    mem().find(
      (item) =>
        duplicateKey(item.lote, item.codigo, item.producto) === key &&
        item.id !== options.excludeId &&
        (options.includeArchived || !item.archived)
    ) ?? null
  );
}

async function findDuplicateNeon(
  lote: string,
  codigo: string,
  producto: string,
  options: { excludeId?: string; includeArchived?: boolean } = {}
): Promise<AsignacionLote | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(asignacionLotes)
    .where(options.includeArchived ? undefined : eq(asignacionLotes.archived, false));
  const key = duplicateKey(lote, codigo, producto);
  const match = rows.find(
    (row) =>
      duplicateKey(row.lote, row.codigo, row.producto) === key &&
      row.id !== options.excludeId &&
      (options.includeArchived || !row.archived)
  );
  return match ? rowToDomain(match) : null;
}

/**
 * Compara los campos "de contenido" (no auditoría) entre lo ya guardado y
 * lo que trae la fuente — usado por el sync para reportar "sin cambios" de
 * verdad en vez de contar cada fila vista como "actualizada", y por la
 * vista previa de importación (sección "ya existentes" vs "conflictos").
 */
export function fieldsDiffer(previous: AsignacionLote, input: Omit<AsignacionLoteUpsertInput, "sourceId" | "sourceSheetTab">): boolean {
  const nextFecha = input.fecha?.trim() || previous.fecha || null;
  const nextMarca = input.marca?.trim() ?? previous.marca ?? "";
  const nextVto = input.vto ?? previous.vto ?? null;
  const nextMuestras = input.muestras?.trim() ?? previous.muestras ?? "";
  const nextCjMuestra = input.cjMuestra?.trim() ?? previous.cjMuestra ?? "";
  const nextFechaAnalisis = input.fechaAnalisis ?? previous.fechaAnalisis ?? null;
  const nextObservaciones = input.observaciones?.trim() ?? previous.observaciones ?? "";
  return (
    previous.lote !== (input.lote.trim() || previous.lote) ||
    previous.fecha !== nextFecha ||
    previous.producto !== (input.producto.trim() || previous.producto) ||
    previous.codigo !== (input.codigo.trim() || previous.codigo) ||
    previous.marca !== nextMarca ||
    previous.cantidades !== (Number.isFinite(input.cantidades) ? input.cantidades : previous.cantidades) ||
    previous.vto !== nextVto ||
    previous.muestras !== nextMuestras ||
    previous.cjMuestra !== nextCjMuestra ||
    previous.fechaAnalisis !== nextFechaAnalisis ||
    previous.observaciones !== nextObservaciones
  );
}

function sortItems(items: AsignacionLote[]): AsignacionLote[] {
  return [...items].sort(
    (a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.lote.localeCompare(b.lote, "es")
  );
}


/** Rechazo atómico de un PATCH por celdas: NADA se aplicó. */
export class AsignacionCellPatchError extends Error {
  readonly status: number;
  readonly code = "ASIGNACION_CELL_PATCH_REJECTED";
  constructor(readonly failures: AsignacionCellFailure[]) {
    super(
      failures.length === 1
        ? failures[0]!.message
        : `${failures.length} celdas rechazadas — no se guardó ningún cambio.`
    );
    this.name = "AsignacionCellPatchError";
    this.status = failures.some((f) => f.code === "CONFLICT")
      ? 409
      : failures.some((f) => f.code === "PROTECTED_SOURCE" || f.code === "FORBIDDEN_FIELD")
        ? 403
        : 400;
  }
}

export type AsignacionLoteHistoryEntry =
  | { kind: "CHANGE"; at: string; actor: string; actorSector: string; field: string; oldValue: string | null; newValue: string | null; batchId: string; origin: "FORM" | "CELL" }
  | { kind: "CREATED"; at: string; actor: string; origin: "SYNC" | "MANUAL" }
  | { kind: "ARCHIVED"; at: string; actor: string; reason: string | null };

export interface AsignacionCellAuditEntry {
  batchId: string;
  recordId: string;
  lote: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  actorEmail: string;
  actorSector: string;
  actorName: string;
  createdAt: string;
}

const gAudit = globalThis as unknown as { __genusAsignacionCellAudit?: AsignacionCellAuditEntry[] };

/** Solo path en memoria (tests / sin DATABASE_URL). */
export function getAsignacionCellAuditMemory(): AsignacionCellAuditEntry[] {
  if (!gAudit.__genusAsignacionCellAudit) gAudit.__genusAsignacionCellAudit = [];
  return gAudit.__genusAsignacionCellAudit;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function sameVersion(a: string, b: string): boolean {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && ta === tb;
}

function auditText(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function currentCellValue(record: AsignacionLote, field: AsignacionCellField): string | number | null {
  return record[field] ?? null;
}


/** Campos de trazabilidad de un lote: no se sobrescriben si el lote ya fue aprobado/entregado en algún trabajo. */
const LOT_TRACE_FIELDS: ReadonlySet<string> = new Set(["lote", "producto", "codigo", "vto"]);

/**
 * ¿El lote ya quedó en un registro histórico (Calidad decidió, envasado cerrado o entregado)? Devuelve el motivo
 * (con el procedimiento de corrección) o null. Solo con base real: en memoria no hay trabajos que consultar.
 */
export async function lockedLotUsageReason(lote: string | null | undefined): Promise<string | null> {
  const value = lote?.trim();
  if (!value || !isDatabaseConfigured()) return null;
  const rows = await getDb()
    .select({ product: workItems.product, quality: workItems.qualityStatus, status: workItems.operationalStatus, closed: workItems.packagingClosedAt })
    .from(workItems)
    .where(and(eq(workItems.packagingLote, value), isNull(workItems.deletedAt)))
    .limit(50);
  const locked = rows.filter((r) => r.quality === "aprobado" || r.quality === "rechazado" || r.status === "entregado" || r.closed);
  if (locked.length === 0) return null;
  const what = locked.some((r) => r.status === "entregado") ? "entregado" : locked.some((r) => r.quality === "aprobado" || r.quality === "rechazado") ? "decidido por Calidad" : "cerrado en Envasado";
  return `El lote ${value} ya fue ${what} en ${locked.length} trabajo(s) (${locked.map((r) => r.product).slice(0, 3).join(", ")}). No se sobrescribe el registro histórico: para corregirlo, anulá la decisión de Calidad / la entrega del trabajo y corregí el lote desde el trabajo (queda auditado).`;
}

function assertUpsertRespectsCellPolicy(
  actor: AsignacionLotesActor,
  previous: AsignacionLote,
  input: AsignacionLoteUpsertInput
): void {
  const next: Record<AsignacionCellField, string | number | null> = {
    lote: input.lote.trim(),
    fecha: input.fecha?.trim() ? (parseFlexibleDate(input.fecha) ?? input.fecha.trim()) : null,
    producto: input.producto.trim(),
    codigo: input.codigo.trim(),
    marca: input.marca?.trim() ?? previous.marca,
    cantidades: input.cantidades,
    vto: input.vto ?? null,
    muestras: input.muestras?.trim() ?? previous.muestras,
    cjMuestra: input.cjMuestra?.trim() ?? previous.cjMuestra,
    fechaAnalisis: input.fechaAnalisis ?? null,
    observaciones: input.observaciones?.trim() ?? previous.observaciones,
  };
  for (const field of Object.keys(next) as AsignacionCellField[]) {
    const before = auditText(currentCellValue(previous, field)) ?? "";
    const after = auditText(next[field]) ?? "";
    if (before === after) continue;
    const reason = cellProtectionReason(previous, field, actor.sector);
    if (reason) throw new OrdersForbiddenError(`${field}: ${reason}`);
  }
}

export class AsignacionLotesService {
  async list(
    actor: AsignacionLotesActor,
    options: { includeArchived?: boolean } = {}
  ): Promise<AsignacionLote[]> {
    assertAccess(actor);
    if (useNeon()) {
      const db = getDb();
      const rows = await db
        .select()
        .from(asignacionLotes)
        .where(options.includeArchived ? undefined : eq(asignacionLotes.archived, false))
        .orderBy(desc(asignacionLotes.fecha));
      return sortItems(rows.map(rowToDomain));
    }
    return sortItems(
      mem().filter((item) => options.includeArchived || !item.archived)
    );
  }

  /**
   * Historial de un lote: cambios campo a campo (edición por celda y por formulario, con valor anterior, nuevo y
   * quién), más alta y archivo con su motivo. Solo lectura; incluye registros archivados.
   */
  async history(actor: AsignacionLotesActor, id: string): Promise<AsignacionLoteHistoryEntry[]> {
    assertAccess(actor);
    let record: AsignacionLote | undefined;
    let deletedReason: string | null = null;
    let audit: AsignacionCellAuditEntry[];
    if (isDatabaseConfigured()) {
      const db = getDb();
      const [row] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id)).limit(1);
      record = row ? rowToDomain(row) : undefined;
      deletedReason = row?.deletedReason ?? null;
      const rows = await db.select().from(asignacionLotesCellAudit).where(eq(asignacionLotesCellAudit.recordId, id)).orderBy(desc(asignacionLotesCellAudit.createdAt)).limit(500);
      audit = rows.map((r) => ({ batchId: r.batchId, recordId: r.recordId, lote: r.lote, field: r.field as AsignacionCellField, oldValue: r.oldValue, newValue: r.newValue, actorEmail: r.actorEmail, actorSector: r.actorSector, actorName: r.actorName, createdAt: new Date(r.createdAt).toISOString() }));
    } else {
      record = mem().find((item) => item.id === id);
      audit = getAsignacionCellAuditMemory().filter((r) => r.recordId === id).reverse();
    }
    if (!record) throw new OrdersNotFoundError("Lote no encontrado.");
    const out: AsignacionLoteHistoryEntry[] = audit.map((r) => ({ kind: "CHANGE", at: r.createdAt, actor: r.actorName || r.actorEmail, actorSector: r.actorSector, field: r.field, oldValue: r.oldValue, newValue: r.newValue, batchId: r.batchId, origin: r.batchId.startsWith("form-") ? "FORM" : "CELL" }));
    if (record.archived) out.unshift({ kind: "ARCHIVED", at: record.updatedAt, actor: record.updatedBy, reason: deletedReason });
    out.push({ kind: "CREATED", at: record.createdAt, actor: record.createdBy, origin: record.sourceId ? "SYNC" : "MANUAL" });
    return out;
  }

  async get(actor: AsignacionLotesActor, id: string): Promise<AsignacionLote | null> {
    assertAccess(actor);
    if (useNeon()) {
      const db = getDb();
      const [row] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!row || row.archived) return null;
      return rowToDomain(row);
    }
    const item = mem().find((item) => item.id === id);
    if (!item || item.archived) return null;
    return item;
  }

  async upsert(actor: AsignacionLotesActor, input: AsignacionLoteUpsertInput): Promise<AsignacionLote> {
    assertMutate(actor);
    const previous = input.id
      ? useNeon()
        ? await this.get(actor, input.id)
        : mem().find((item) => item.id === input.id)
      : undefined;

    // Alta/edición manual (un solo registro, no import masivo): estos 3
    // siguen siendo obligatorios — la carga flexible es solo para
    // copiar/pegar desde Excel (ver import() más abajo, que llama
    // writeRecord directo sin pasar por acá).
    if (!input.lote.trim() || !input.fecha?.trim() || !input.producto.trim()) {
      throw new OrdersValidationError("Lote, Fecha y Producto son obligatorios.");
    }
    if (!parseFlexibleDate(input.fecha)) {
      throw new OrdersValidationError("Fecha inválida.");
    }
    if (!Number.isFinite(input.cantidades) || input.cantidades < 0) {
      throw new OrdersValidationError("Cantidades debe ser un número mayor o igual a 0.");
    }

    // Misma política que la grilla: el modal clásico no puede saltear la matriz
    // de sectores ni editar registros sincronizados desde Google (solo los
    // campos que REALMENTE cambian se validan contra la política).
    if (previous) assertUpsertRespectsCellPolicy(actor, previous, input);
    if (previous && input.expectedUpdatedAt && !sameVersion(previous.updatedAt, input.expectedUpdatedAt)) {
      throw new OrdersValidationError("Otro usuario (o una sincronización) modificó este lote mientras lo editabas (conflicto de versión). Recargá antes de guardar.");
    }
    if (previous) {
      const traceChanged = [...LOT_TRACE_FIELDS].some((f) => String(previous[f as keyof AsignacionLote] ?? "").trim() !== String((input as Record<string, unknown>)[f] ?? "").trim() && (input as Record<string, unknown>)[f] !== undefined);
      const locked = traceChanged ? await lockedLotUsageReason(previous.lote) : null;
      if (locked) throw new OrdersValidationError(locked);
    }

    const duplicate = useNeon()
      ? await findDuplicateNeon(input.lote, input.codigo, input.producto, { excludeId: input.id })
      : findDuplicateMem(input.lote, input.codigo, input.producto, { excludeId: input.id });
    if (duplicate) {
      throw new OrdersValidationError(
        `Ya existe el lote ${duplicate.lote} para el código ${duplicate.codigo} y producto ${duplicate.producto}.`
      );
    }

    return this.writeRecord(actor, input, previous, { audit: true });
  }

  /**
   * Inserta/actualiza sin exigir campos — reutilizado por upsert() (que ya
   * validó lote/fecha/producto antes de llegar acá) e import() (carga
   * flexible: celdas vacías se persisten como ""/null, nunca se inventan).
   */
  private async writeRecord(
    actor: AsignacionLotesActor,
    input: AsignacionLoteUpsertInput,
    previous: AsignacionLote | null | undefined,
    options: { audit?: boolean } = {}
  ): Promise<AsignacionLote> {
    const now = new Date().toISOString();
    const updatedBy = input.updatedBy.trim() || actor.displayName;
    const record: AsignacionLote = {
      id: previous?.id ?? input.id ?? makeId(),
      // Carga flexible (import): una celda vacía en una edición sobre un
      // registro existente NO debe borrar el valor ya cargado — solo un
      // alta nueva (sin previous) persiste "" para un campo vacío.
      lote: input.lote.trim() || previous?.lote || "",
      fecha: input.fecha?.trim()
        ? (parseFlexibleDate(input.fecha) ?? input.fecha.trim())
        : previous?.fecha ?? null,
      producto: input.producto.trim() || previous?.producto || "",
      codigo: input.codigo.trim() || previous?.codigo || "",
      marca: input.marca?.trim() ?? previous?.marca ?? "",
      cantidades: Number.isFinite(input.cantidades) && input.cantidades >= 0 ? input.cantidades : 0,
      vto: input.vto ?? previous?.vto ?? null,
      muestras: input.muestras?.trim() ?? previous?.muestras ?? "",
      cjMuestra: input.cjMuestra?.trim() ?? previous?.cjMuestra ?? "",
      fechaAnalisis: input.fechaAnalisis ?? previous?.fechaAnalisis ?? null,
      observaciones: input.observaciones?.trim() ?? previous?.observaciones ?? "",
      createdAt: previous?.createdAt ?? now,
      createdBy: previous?.createdBy ?? input.createdBy ?? updatedBy,
      updatedAt: now,
      updatedBy,
      archived: input.archived ?? previous?.archived ?? false,
      sourceId: input.sourceId !== undefined ? input.sourceId : (previous?.sourceId ?? null),
      sourceSheetTab:
        input.sourceSheetTab !== undefined ? input.sourceSheetTab : (previous?.sourceSheetTab ?? null),
      datosIncompletos: input.datosIncompletos ?? previous?.datosIncompletos ?? false,
      camposIncompletos:
        input.camposIncompletos !== undefined ? input.camposIncompletos : (previous?.camposIncompletos ?? null),
    };

    if (useNeon()) {
      const db = getDb();
      const values = domainToInsert(record);
      if (previous && options.audit) {
        // Edición manual (formulario): actualización condicionada a la versión leída + auditoría campo a campo,
        // en la MISMA transacción (mismo registro que la edición por celda).
        const changed = ASIGNACION_CELL_FIELDS.filter((f) => auditText(currentCellValue(previous, f)) !== auditText(currentCellValue(record, f)));
        const nowDate = new Date(Math.max(Date.now(), new Date(previous.updatedAt).getTime() + 1));
        const batchId = `form-${nowDate.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
        record.updatedAt = nowDate.toISOString();
        const v = domainToInsert(record);
        await db.transaction(async (tx) => {
          const res = await tx
            .update(asignacionLotes)
            .set({
              lote: v.lote, fecha: v.fecha, producto: v.producto, codigo: v.codigo, marca: v.marca, cantidades: v.cantidades, vto: v.vto,
              muestras: v.muestras, cjMuestra: v.cjMuestra, fechaAnalisis: v.fechaAnalisis, observaciones: v.observaciones,
              updatedAt: nowDate, updatedBy: v.updatedBy,
            })
            .where(sql`${asignacionLotes.id} = ${record.id} and date_trunc('milliseconds', ${asignacionLotes.updatedAt}) = ${new Date(previous.updatedAt)}`)
            .returning({ id: asignacionLotes.id });
          if (res.length === 0) throw new OrdersValidationError("Otro usuario (o una sincronización) modificó este lote mientras lo editabas (conflicto de versión). Recargá antes de guardar.");
          if (changed.length > 0) {
            await tx.insert(asignacionLotesCellAudit).values(
              changed.map((field) => ({
                batchId,
                recordId: record.id,
                lote: previous.lote,
                field,
                oldValue: auditText(currentCellValue(previous, field)),
                newValue: auditText(currentCellValue(record, field)),
                actorEmail: actor.email,
                actorSector: actor.sector,
                actorName: actor.displayName,
                createdAt: nowDate,
              }))
            );
          }
        });
      } else if (previous) {
        await db
          .update(asignacionLotes)
          .set({
            lote: values.lote,
            fecha: values.fecha,
            producto: values.producto,
            codigo: values.codigo,
            marca: values.marca,
            cantidades: values.cantidades,
            vto: values.vto,
            muestras: values.muestras,
            cjMuestra: values.cjMuestra,
            fechaAnalisis: values.fechaAnalisis,
            observaciones: values.observaciones,
            archived: values.archived,
            updatedAt: values.updatedAt,
            updatedBy: values.updatedBy,
            sourceId: values.sourceId,
            sourceSheetTab: values.sourceSheetTab,
            datosIncompletos: values.datosIncompletos,
            camposIncompletos: values.camposIncompletos,
          })
          .where(eq(asignacionLotes.id, record.id));
      } else {
        await db.insert(asignacionLotes).values(values);
      }
      // Sincronización retroactiva (caso "se asigna sin lote/VTO, después
      // se carga en Asignación de Lotes") — best-effort, nunca puede tirar
      // abajo el alta/edición de la asignación en sí.
      try {
        await fillBareWorkItemsFromAsignacionLote(record, actor.sector);
      } catch {
        // No-op: el guardado de la asignación ya se confirmó arriba.
      }
      return record;
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === record.id);
    if (idx >= 0) items[idx] = record;
    else items.push(record);
    return record;
  }

  /**
   * Identidad estable de sincronización (ver resolve-for-work-item.ts del
   * pedido de vínculo con Producción, mismo espíritu): mover una fila en la
   * Sheet no cambia lote+código, así que reordenar NUNCA duplica. Solo
   * busca DENTRO de la misma fuente — nunca "adopta" un registro manual o
   * de otra fuente aunque coincida lote+código (ese caso es justamente el
   * conflicto entre fuentes que hay que reportar, no fusionar en silencio).
   */
  private async findBySourceKey(
    sourceId: string,
    lote: string,
    codigo: string,
    producto: string
  ): Promise<AsignacionLote | null> {
    const key = duplicateKey(lote, codigo, producto);
    if (useNeon()) {
      const db = getDb();
      const rows = await db.select().from(asignacionLotes).where(eq(asignacionLotes.sourceId, sourceId));
      const match = rows.find((row) => duplicateKey(row.lote, row.codigo, row.producto) === key);
      return match ? rowToDomain(match) : null;
    }
    return (
      mem().find(
        (item) => item.sourceId === sourceId && duplicateKey(item.lote, item.codigo, item.producto) === key
      ) ?? null
    );
  }

  /**
   * Detecta si lote+código ya existe en una fuente DISTINTA (manual, Excel,
   * u otra fuente Google Sheets) — usado por el motor de sync para nunca
   * elegir en silencio entre fuentes en conflicto (pedido #16-17).
   */
  async findConflictingRecord(
    sourceId: string,
    lote: string,
    codigo: string,
    producto: string
  ): Promise<AsignacionLote | null> {
    if (useNeon()) {
      return findDuplicateNeon(lote, codigo, producto).then((match) =>
        match && match.sourceId !== sourceId ? match : null
      );
    }
    const match = findDuplicateMem(lote, codigo, producto);
    return match && match.sourceId !== sourceId ? match : null;
  }

  /**
   * Cualquier registro activo con este lote+código, sin importar su fuente
   * — usado por la vista previa de importación de una fuente TODAVÍA NO
   * conectada (sección "importación inicial segura"): antes de crear la
   * fuente no hay sourceId con el que comparar, así que se busca contra
   * TODA Asignación de Lotes existente (manual/Excel/otra Sheets).
   */
  async findExistingRecordByKey(lote: string, codigo: string, producto: string): Promise<AsignacionLote | null> {
    return useNeon() ? findDuplicateNeon(lote, codigo, producto) : findDuplicateMem(lote, codigo, producto);
  }

  /**
   * Upsert usado EXCLUSIVAMENTE por el motor de sincronización de Google
   * Sheets — nunca por un request de usuario. No pasa por `assertMutate`
   * (RBAC de sector humano) porque el proceso de sync ya fue autorizado al
   * conectar la fuente (RBAC de `asignacion-lote-sources-rbac.ts`); es un
   * proceso de servidor confiable, no un endpoint expuesto a cualquier
   * sector. Reutiliza `writeRecord` así que hereda gratis: carga flexible,
   * fill-once de WorkItem y detección de inconsistencia (PR #95).
   *
   * CAUSA RAÍZ (hotfix reconciliación): `findBySourceKey` encuentra el
   * registro aunque esté archivado (a propósito, para revivirlo en vez de
   * crear un duplicado con otro id). Antes de este fix, si ese registro
   * archivado tenía el MISMO contenido que la fila actual, se devolvía tal
   * cual (`changed: false`) sin pasar por `writeRecord` — quedaba archivado
   * PARA SIEMPRE aunque la fila siguiera presente en la Sheet, invisible en
   * el listado activo sin ningún aviso. La Sheet es la fuente de verdad
   * para sus propios registros: si la fila está presente en esta corrida,
   * nunca puede quedar archivada.
   */
  async upsertFromSource(
    sourceId: string,
    actorAttribution: { email: string; displayName: string },
    input: Omit<AsignacionLoteUpsertInput, "sourceId" | "sourceSheetTab">,
    sourceSheetTab?: string | null,
    runStartedAt?: string | null
  ): Promise<{ record: AsignacionLote; created: boolean; changed: boolean }> {
    const previous = await this.findBySourceKey(sourceId, input.lote, input.codigo, input.producto);
    // Opción C: si GENUS escribió esta fila en la Sheet (en curso, o confirmada
    // DESPUÉS de que esta corrida empezó a leer), la lectura que trae el sync
    // puede ser anterior a esa escritura → no se pisa; la próxima corrida ya
    // lee el valor nuevo desde Google.
    if (previous && (await hasWritebackSince(previous.id, runStartedAt ?? null))) {
      return { record: previous, created: false, changed: false };
    }
    const revivingArchived = previous?.archived === true;
    if (previous && !revivingArchived && !fieldsDiffer(previous, input)) {
      return { record: previous, created: false, changed: false };
    }
    const systemActor: AsignacionLotesActor = {
      email: actorAttribution.email,
      sector: "PRODUCCION",
      displayName: actorAttribution.displayName,
    };
    const record = await this.writeRecord(
      systemActor,
      { ...input, id: previous?.id, sourceId, sourceSheetTab: sourceSheetTab ?? null, archived: false },
      previous
    );
    return { record, created: !previous, changed: true };
  }

  /** Todos los registros activos que pertenecen a una fuente — usado al final de un sync para detectar bajas. */
  async listBySource(sourceId: string): Promise<AsignacionLote[]> {
    if (useNeon()) {
      const db = getDb();
      const rows = await db.select().from(asignacionLotes).where(eq(asignacionLotes.sourceId, sourceId));
      return rows.filter((r) => !r.archived).map(rowToDomain);
    }
    return mem().filter((item) => item.sourceId === sourceId && !item.archived);
  }

  /**
   * Sección 13 del pedido: una fila que desaparece de la Sheet nunca se
   * borra físicamente — se archiva con motivo, igual que `delete()`, pero
   * sin exigir RBAC de sector humano (lo dispara el propio motor de sync).
   */
  async archiveRemovedFromSource(id: string, sourceName: string): Promise<void> {
    const reason = `Ya no está presente en la fuente Google Sheets · ${sourceName}.`;
    const now = new Date().toISOString();
    if (useNeon()) {
      const db = getDb();
      await db
        .update(asignacionLotes)
        .set({ archived: true, deletedReason: reason, updatedAt: new Date(now) })
        .where(eq(asignacionLotes.id, id));
      return;
    }
    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) return;
    items[idx] = { ...items[idx]!, archived: true, updatedAt: now };
  }


  /**
   * Edición por celda (grilla tipo Excel) — PATCH PARCIAL y ATÓMICO.
   *
   * - Solo se escribe cada campo editado (+ updatedAt/updatedBy): NUNCA se
   *   reenvía la fila completa, así que LOTE/VTO/PRODUCTO/etc. no editados
   *   no pueden pisarse con datos viejos.
   * - Todo el lote de celdas se valida primero (permisos, protección de
   *   registros sincronizados desde Google, tipos, duplicados, versión). Si
   *   UNA falla no se guarda NINGUNA y se informan todas las fallas.
   * - Concurrencia optimista: `expectedVersion` = updatedAt que vio el
   *   cliente; si otro usuario/sync modificó el registro → CONFLICT.
   * - Auditoría (usuario, registro, campo, antes, después) en la misma
   *   transacción que el UPDATE.
   */
  async patchCells(
    actor: AsignacionLotesActor,
    changes: AsignacionCellChange[],
    options: {
      /**
       * USO INTERNO (orquestador de write-back): ids de registros de Google cuya
       * celda YA fue escrita y confirmada en la Sheet — recién entonces se
       * refleja en Neon. Nunca se llena desde un request de usuario.
       */
      bypassSourceProtection?: ReadonlySet<string>;
      /** Solo valida (permisos/tipos/versión/duplicados) sin escribir. */
      dryRun?: boolean;
    } = {}
  ): Promise<{ items: AsignacionLote[]; changedCells: number; unchangedCells: number }> {
    assertMutate(actor);
    if (!Array.isArray(changes) || changes.length === 0) {
      throw new OrdersValidationError("No hay cambios para guardar.");
    }
    if (changes.length > MAX_CELL_CHANGES_PER_REQUEST) {
      throw new OrdersValidationError(
        `Máximo ${MAX_CELL_CHANGES_PER_REQUEST} celdas por operación. Dividí el pegado.`
      );
    }

    const ids = [...new Set(changes.map((c) => String(c?.id ?? "")))];
    const records = new Map<string, AsignacionLote>();
    let activeRows: AsignacionLote[];
    if (useNeon()) {
      const db = getDb();
      const rows = await db.select().from(asignacionLotes).where(inArray(asignacionLotes.id, ids));
      for (const row of rows) records.set(row.id, rowToDomain(row));
      const active = await db.select().from(asignacionLotes).where(eq(asignacionLotes.archived, false));
      activeRows = active.map(rowToDomain);
    } else {
      for (const item of mem()) if (ids.includes(item.id)) records.set(item.id, item);
      activeRows = mem().filter((item) => !item.archived);
    }

    const failures: AsignacionCellFailure[] = [];
    const fail = (index: number, change: AsignacionCellChange, code: AsignacionCellFailure["code"], message: string) => {
      failures.push({ index, id: String(change?.id ?? ""), field: String(change?.field ?? ""), code, message });
    };

    type Pending = {
      record: AsignacionLote;
      patch: Partial<Record<AsignacionCellField, string | number | null>>;
    };
    const pending = new Map<string, Pending>();
    let unchangedCells = 0;

    changes.forEach((change, index) => {
      if (!change || !isAsignacionCellField(change.field)) {
        fail(index, change, "INVALID_FIELD", "Columna no editable.");
        return;
      }
      const record = records.get(change.id);
      if (!record) {
        fail(index, change, "NOT_FOUND", "El registro ya no existe.");
        return;
      }
      const bypass = options.bypassSourceProtection?.has(record.id) === true;
      const reason = cellProtectionReason(bypass ? { ...record, sourceId: null } : record, change.field, actor.sector);
      if (reason) {
        const code = record.archived ? "ARCHIVED" : record.sourceId && !bypass ? "PROTECTED_SOURCE" : "FORBIDDEN_FIELD";
        fail(index, change, code, reason);
        return;
      }
      if (!change.expectedVersion || !sameVersion(record.updatedAt, change.expectedVersion)) {
        fail(
          index,
          change,
          "CONFLICT",
          "Otro usuario (o una sincronización) modificó este registro. Recargá antes de editar."
        );
        return;
      }
      const validation = validateCellValue(change.field, change.value);
      if (!validation.ok) {
        fail(index, change, "INVALID_VALUE", validation.message);
        return;
      }
      const entry = pending.get(record.id) ?? { record, patch: {} };
      const current = currentCellValue(record, change.field);
      if (auditText(current) === auditText(validation.value)) {
        // Mismo valor que el guardado: nada que escribir (pero un pegado posterior en la misma celda sí cuenta).
        delete entry.patch[change.field];
        unchangedCells += 1;
      } else {
        entry.patch[change.field] = validation.value;
      }
      pending.set(record.id, entry);
    });

    // Identidad (lote, código, producto): no puede duplicar otro registro activo ni otro del mismo lote de cambios.
    if (failures.length === 0) {
      const claimed = new Map<string, string>();
      for (const [id, entry] of pending) {
        if (!Object.keys(entry.patch).some((f) => IDENTITY_FIELDS.has(f as AsignacionCellField))) continue;
        const next = {
          lote: String(entry.patch.lote ?? entry.record.lote),
          codigo: String(entry.patch.codigo ?? entry.record.codigo),
          producto: String(entry.patch.producto ?? entry.record.producto),
        };
        const key = duplicateKey(next.lote, next.codigo, next.producto);
        const clash = activeRows.find(
          (row) => row.id !== id && !pending.has(row.id) && duplicateKey(row.lote, row.codigo, row.producto) === key
        );
        const sibling = claimed.get(key);
        if (clash || (sibling && sibling !== id)) {
          changes.forEach((change, index) => {
            if (change.id === id && IDENTITY_FIELDS.has(change.field)) {
              fail(index, change, "DUPLICATE", `Ya existe el lote ${next.lote} para el código ${next.codigo} y producto ${next.producto}.`);
            }
          });
        }
        claimed.set(key, id);
        // Otro registro del mismo lote de cambios que ya existía y también cambia: chequeado vía `claimed`.
        for (const [otherId, other] of pending) {
          if (otherId === id || Object.keys(other.patch).some((f) => IDENTITY_FIELDS.has(f as AsignacionCellField))) continue;
          if (duplicateKey(other.record.lote, other.record.codigo, other.record.producto) === key) {
            changes.forEach((change, index) => {
              if (change.id === id && IDENTITY_FIELDS.has(change.field)) {
                fail(index, change, "DUPLICATE", `Ya existe el lote ${next.lote} para el código ${next.codigo} y producto ${next.producto}.`);
              }
            });
          }
        }
      }
    }

    // Lotes ya aprobados / entregados / cerrados: su trazabilidad no se sobrescribe (procedimiento de corrección).
    if (isDatabaseConfigured()) {
      for (const [id, entry] of pending) {
        const traceFields = Object.keys(entry.patch).filter((f) => LOT_TRACE_FIELDS.has(f));
        if (traceFields.length === 0) continue;
        const locked = await lockedLotUsageReason(entry.record.lote);
        if (!locked) continue;
        changes.forEach((change, index) => {
          if (change.id === id && LOT_TRACE_FIELDS.has(change.field)) fail(index, change, "FORBIDDEN_FIELD", locked);
        });
      }
    }

    if (failures.length > 0) throw new AsignacionCellPatchError(failures);

    if (options.dryRun) return { items: [...records.values()], changedCells: 0, unchangedCells };

    const toWrite = [...pending.values()].filter((entry) => Object.keys(entry.patch).length > 0);
    const changedCells = toWrite.reduce((n, entry) => n + Object.keys(entry.patch).length, 0);
    if (toWrite.length === 0) {
      return { items: [...records.values()], changedCells: 0, unchangedCells };
    }

    // updatedAt es la "versión" del registro: debe cambiar SIEMPRE, aunque dos
    // ediciones caigan en el mismo milisegundo.
    const latestPrev = Math.max(...toWrite.map((entry) => new Date(entry.record.updatedAt).getTime()));
    const nowDate = new Date(Math.max(Date.now(), latestPrev + 1));
    const now = nowDate.toISOString();
    const updatedBy = actor.displayName;
    const batchId = `cb-${nowDate.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const auditRows: AsignacionCellAuditEntry[] = [];
    const updated: AsignacionLote[] = [];

    for (const entry of toWrite) {
      for (const [field, value] of Object.entries(entry.patch) as [AsignacionCellField, string | number | null][]) {
        auditRows.push({
          batchId,
          recordId: entry.record.id,
          lote: entry.record.lote,
          field,
          oldValue: auditText(currentCellValue(entry.record, field)),
          newValue: auditText(value),
          actorEmail: actor.email,
          actorSector: actor.sector,
          actorName: actor.displayName,
          createdAt: now,
        });
      }
      updated.push({ ...entry.record, ...(entry.patch as Partial<AsignacionLote>), updatedAt: now, updatedBy });
    }

    if (useNeon()) {
      const db = getDb();
      try {
      await db.transaction(async (tx) => {
        for (const entry of toWrite) {
          const set: Record<string, unknown> = { updatedAt: nowDate, updatedBy };
          for (const [field, value] of Object.entries(entry.patch)) {
            set[field] =
              ASIGNACION_CELL_KIND[field as AsignacionCellField] === "number" ? String(value) : value;
          }
          const res = await tx
            .update(asignacionLotes)
            .set(set)
            .where(
              sql`${asignacionLotes.id} = ${entry.record.id}
                and ${asignacionLotes.archived} = false
                and (${options.bypassSourceProtection?.has(entry.record.id) ? sql`true` : sql`${asignacionLotes.sourceId} is null`})
                and date_trunc('milliseconds', ${asignacionLotes.updatedAt}) = ${new Date(entry.record.updatedAt)}`
            )
            .returning({ id: asignacionLotes.id });
          if (res.length === 0) {
            // Perdió la carrera: otro writer cambió el registro entre la lectura y el UPDATE → rollback total.
            throw new AsignacionCellPatchError([
              {
                index: changes.findIndex((c) => c.id === entry.record.id),
                id: entry.record.id,
                field: Object.keys(entry.patch)[0] ?? "",
                code: "CONFLICT",
                message: "Otro usuario (o una sincronización) modificó este registro. Recargá antes de editar.",
              },
            ]);
          }
        }
        await tx.insert(asignacionLotesCellAudit).values(
          auditRows.map((row) => ({
            batchId: row.batchId,
            recordId: row.recordId,
            lote: row.lote,
            field: row.field,
            oldValue: row.oldValue,
            newValue: row.newValue,
            actorEmail: row.actorEmail,
            actorSector: row.actorSector,
            actorName: row.actorName,
            createdAt: nowDate,
          }))
        );
      });
      } catch (err) {
        // Dos usuarios cambiando la identidad (lote/código/producto) a la vez: gana el índice único
        // parcial (lote,codigo,producto WHERE NOT archived); el perdedor recibe DUPLICATE, no un 500.
        if (isUniqueViolation(err)) {
          const idChange = changes.findIndex((c) => IDENTITY_FIELDS.has(c.field));
          throw new AsignacionCellPatchError([
            { index: Math.max(0, idChange), id: changes[Math.max(0, idChange)]?.id ?? "", field: changes[Math.max(0, idChange)]?.field ?? "", code: "DUPLICATE", message: "Otro usuario acaba de crear/cambiar un registro con el mismo lote, código y producto. No se guardó nada." },
          ]);
        }
        throw err;
      }
      // Sincronización retroactiva a WorkItems "pelados" — best-effort, igual que writeRecord().
      for (const record of updated) {
        try {
          await fillBareWorkItemsFromAsignacionLote(record, actor.sector);
        } catch {
          // No-op: el guardado de la celda ya se confirmó.
        }
      }
    } else {
      const items = mem();
      // Re-chequeo SÍNCRONO de identidad (sin await entre el chequeo y la escritura): equivale al
      // índice único de Neon cuando dos pegados concurrentes cambian la identidad a la vez.
      for (const record of updated) {
        const key = duplicateKey(record.lote, record.codigo, record.producto);
        const clash = items.find((it) => it.id !== record.id && !it.archived && duplicateKey(it.lote, it.codigo, it.producto) === key && !updated.some((u) => u.id === it.id));
        if (clash) {
          const i = changes.findIndex((c) => c.id === record.id && IDENTITY_FIELDS.has(c.field));
          throw new AsignacionCellPatchError([{ index: Math.max(0, i), id: record.id, field: changes[Math.max(0, i)]?.field ?? "lote", code: "DUPLICATE", message: `Ya existe el lote ${record.lote} para el código ${record.codigo} y producto ${record.producto}.` }]);
        }
        const cur = items.find((it) => it.id === record.id);
        if (cur && cur.updatedAt !== toWrite.find((w) => w.record.id === record.id)!.record.updatedAt) {
          throw new AsignacionCellPatchError([{ index: changes.findIndex((c) => c.id === record.id), id: record.id, field: changes.find((c) => c.id === record.id)?.field ?? "", code: "CONFLICT", message: "Otro usuario modificó este registro. Recargá antes de editar." }]);
        }
      }
      for (const record of updated) {
        const idx = items.findIndex((item) => item.id === record.id);
        if (idx >= 0) items[idx] = record;
      }
      getAsignacionCellAuditMemory().push(...auditRows);
    }

    return { items: updated, changedCells, unchangedCells };
  }

  /** Restaura filas archivadas/eliminadas (incl. bajas con deleted_reason). */
  async restore(actor: AsignacionLotesActor, id: string): Promise<AsignacionLote> {
    assertMutate(actor);
    const now = new Date().toISOString();
    const updatedBy = actor.displayName;

    if (useNeon()) {
      const db = getDb();
      const [existing] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!existing) throw new OrdersNotFoundError("Asignación no encontrada.");
      await db
        .update(asignacionLotes)
        .set({ archived: false, deletedReason: null, updatedAt: new Date(now), updatedBy })
        .where(eq(asignacionLotes.id, id));
      return { ...rowToDomain(existing), archived: false, updatedAt: now, updatedBy };
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    items[idx] = { ...items[idx], archived: false, updatedAt: now, updatedBy };
    return items[idx];
  }

  async delete(actor: AsignacionLotesActor, id: string, reason?: string): Promise<void> {
    assertMutate(actor);
    const trimmed = normalizeOptionalReason(reason);
    const now = new Date().toISOString();

    if (useNeon()) {
      const db = getDb();
      const [existing] = await db.select().from(asignacionLotes).where(eq(asignacionLotes.id, id));
      if (!existing) throw new OrdersNotFoundError("Asignación no encontrada.");
      if (existing.archived) return;
      await db
        .update(asignacionLotes)
        .set({
          archived: true,
          deletedReason: trimmed,
          updatedAt: new Date(now),
          updatedBy: actor.displayName,
        })
        .where(eq(asignacionLotes.id, id));
      return;
    }

    const items = mem();
    const idx = items.findIndex((item) => item.id === id);
    if (idx < 0) throw new OrdersNotFoundError("Asignación no encontrada.");
    if (items[idx].archived) return;
    items[idx] = {
      ...items[idx],
      archived: true,
      updatedAt: now,
      updatedBy: actor.displayName,
    };
  }

  async import(
    actor: AsignacionLotesActor,
    rows: AsignacionLoteUpsertInput[]
  ): Promise<AsignacionLoteImportResult> {
    assertMutate(actor);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    const errors: AsignacionLoteImportResult["errors"] = [];
    const seen = new Set<string>();

    // Carga flexible: ningún campo bloquea la fila por estar vacío — solo
    // se rechaza si el dato SÍ vino y tiene formato inválido (fecha
    // ilegible). Celdas vacías se persisten como ""/null en writeRecord.
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowIndex = index + 1;
      const key = duplicateKey(row.lote, row.codigo, row.producto);
      if (row.fecha?.trim() && !parseFlexibleDate(row.fecha)) {
        errors.push({ rowIndex, field: "fecha", message: "Fecha inválida." });
      }
      if (errors.some((error) => error.rowIndex === rowIndex)) {
        skipped += 1;
        continue;
      }

      const dup = useNeon()
        ? await findDuplicateNeon(row.lote, row.codigo, row.producto)
        : findDuplicateMem(row.lote, row.codigo, row.producto);
      if (seen.has(key) || dup) {
        duplicates += 1;
        skipped += 1;
        continue;
      }

      await this.writeRecord(
        actor,
        {
          ...row,
          updatedBy: row.updatedBy || actor.displayName,
          createdBy: row.createdBy ?? actor.displayName,
        },
        undefined
      );
      imported += 1;
      seen.add(key);
    }

    return { imported, skipped, duplicates, errors };
  }

  /** Hidrata memoria desde registros migrados (sync cliente → servidor). Solo path in-memory. */
  async replaceAll(actor: AsignacionLotesActor, records: unknown[]): Promise<number> {
    assertMutate(actor);
    if (useNeon()) {
      const db = getDb();
      const migrated = records.map((record) => migrateRecord(record));
      await db.delete(asignacionLotes);
      for (const record of migrated) {
        await db.insert(asignacionLotes).values(domainToInsert(record));
      }
      return migrated.length;
    }
    g.__genusAsignacionLotesMem = records.map((record) => migrateRecord(record));
    return g.__genusAsignacionLotesMem.length;
  }
}

let singleton: AsignacionLotesService | null = null;

export function getAsignacionLotesService(): AsignacionLotesService {
  if (!singleton) singleton = new AsignacionLotesService();
  return singleton;
}
