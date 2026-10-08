/**
 * Bitácora idempotente del write-back a Google Sheets (opción C) +
 * habilitación/allowlist. Sin dependencias del servicio de lotes (evita ciclos:
 * el servicio la consulta para que el sync no revierta una escritura reciente).
 *
 * Estados de una operación:
 *   pending     — intención registrada, Google todavía no confirmó
 *   google_done — Google confirmó la celda; falta reflejarla en Neon (reconciliable)
 *   confirmed   — Google y Neon consistentes
 *   failed      — Google rechazó/falló; Neon NO se tocó
 *   conflict    — el valor remoto cambió desde la última lectura; nada se escribió
 */
import "server-only";

import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { asignacionLotesWritebackOps } from "@/lib/db/schema";

export type WritebackStatus = "pending" | "google_done" | "confirmed" | "failed" | "conflict";

export interface WritebackOp {
  id: string;
  idempotencyKey: string;
  recordId: string;
  lote: string;
  field: string;
  spreadsheetId: string;
  sheetTab: string;
  a1: string | null;
  oldValue: string | null;
  newValue: string | null;
  status: WritebackStatus;
  attempts: number;
  lastError: string | null;
  actorEmail: string;
  actorSector: string;
  actorName: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

const OPEN: WritebackStatus[] = ["pending", "google_done"];

const g = globalThis as unknown as { __genusWritebackOps?: WritebackOp[] };
function mem(): WritebackOp[] {
  if (!g.__genusWritebackOps) g.__genusWritebackOps = [];
  return g.__genusWritebackOps;
}
export function resetWritebackOpsMemoryForTests(): void {
  g.__genusWritebackOps = [];
}

/** El write-back exige DOS cosas explícitas: flag + allowlist de spreadsheets. Por defecto NADA se escribe. */
export function writebackAllowlist(): Set<string> {
  return new Set(
    (process.env.ASIGNACION_LOTES_WRITEBACK_SPREADSHEET_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}
export function isWritebackEnabledFor(spreadsheetId: string): boolean {
  // Nunca en Production (VERCEL_ENV=production), sin importar flags ni allowlist.
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.ASIGNACION_LOTES_WRITEBACK === "1" && writebackAllowlist().has(spreadsheetId);
}

export function idempotencyKeyFor(parts: { recordId: string; field: string; newValue: string; expectedVersion: string }): string {
  return createHash("sha256")
    .update(`${parts.recordId}\u0000${parts.field}\u0000${parts.newValue}\u0000${parts.expectedVersion}`)
    .digest("hex")
    .slice(0, 40);
}

function rowToOp(row: typeof asignacionLotesWritebackOps.$inferSelect): WritebackOp {
  return {
    ...row,
    status: row.status as WritebackStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

export async function findOpByKey(key: string): Promise<WritebackOp | null> {
  if (isDatabaseConfigured()) {
    const [row] = await getDb()
      .select()
      .from(asignacionLotesWritebackOps)
      .where(eq(asignacionLotesWritebackOps.idempotencyKey, key));
    return row ? rowToOp(row) : null;
  }
  return mem().find((o) => o.idempotencyKey === key) ?? null;
}

/** Una operación abierta más vieja que esto se considera abandonada. */
export const OPEN_OP_TTL_MS = 2 * 60 * 1000;

/** Hay otra operación ABIERTA (otra clave de idempotencia) sobre el mismo registro+campo → otro usuario está escribiendo esa celda. */
export async function findOtherOpenOp(recordId: string, field: string, idempotencyKey: string): Promise<WritebackOp | null> {
  const fresh = (o: WritebackOp) => Date.now() - new Date(o.updatedAt).getTime() < OPEN_OP_TTL_MS;
  if (isDatabaseConfigured()) {
    const rows = await getDb()
      .select()
      .from(asignacionLotesWritebackOps)
      .where(and(eq(asignacionLotesWritebackOps.recordId, recordId), eq(asignacionLotesWritebackOps.field, field), inArray(asignacionLotesWritebackOps.status, OPEN)));
    return rows.map(rowToOp).find((o) => o.idempotencyKey !== idempotencyKey && fresh(o)) ?? null;
  }
  return mem().find((o) => o.recordId === recordId && o.field === field && OPEN.includes(o.status) && o.idempotencyKey !== idempotencyKey && fresh(o)) ?? null;
}

/** Libera operaciones abiertas abandonadas del mismo registro+campo (para poder retomar la celda). */
export async function abandonStaleOps(recordId: string, field: string, idempotencyKey: string): Promise<void> {
  const stale = (o: WritebackOp) => o.idempotencyKey !== idempotencyKey && Date.now() - new Date(o.updatedAt).getTime() >= OPEN_OP_TTL_MS;
  const open = isDatabaseConfigured()
    ? (await getDb().select().from(asignacionLotesWritebackOps).where(and(eq(asignacionLotesWritebackOps.recordId, recordId), eq(asignacionLotesWritebackOps.field, field), inArray(asignacionLotesWritebackOps.status, OPEN)))).map(rowToOp)
    : mem().filter((o) => o.recordId === recordId && o.field === field && OPEN.includes(o.status));
  for (const o of open.filter(stale)) {
    // google_done abandonada NO se descarta: la reconciliación la completa. Solo se libera `pending` colgada.
    if (o.status === "pending") await updateOp(o.id, { status: "failed", lastError: "Operación abandonada (timeout)." });
  }
}

export class WritebackBusyError extends Error {
  constructor() {
    super("Otro usuario está escribiendo esta celda en este momento. Esperá unos segundos, recargá y reintentá.");
    this.name = "WritebackBusyError";
  }
}

export async function createOp(
  input: Omit<WritebackOp, "id" | "attempts" | "createdAt" | "updatedAt" | "confirmedAt" | "lastError" | "status">
): Promise<WritebackOp> {
  await abandonStaleOps(input.recordId, input.field, input.idempotencyKey);
  if (await findOtherOpenOp(input.recordId, input.field, input.idempotencyKey)) throw new WritebackBusyError();
  const now = new Date();
  const op: WritebackOp = {
    ...input,
    id: `wb-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    confirmedAt: null,
  };
  if (isDatabaseConfigured()) {
    try {
      await getDb()
        .insert(asignacionLotesWritebackOps)
        .values({ ...op, createdAt: now, updatedAt: now, confirmedAt: null })
        .onConflictDoNothing({ target: asignacionLotesWritebackOps.idempotencyKey });
    } catch (err) {
      // Índice único parcial (record_id, field) con status abierto: otro usuario la reservó primero.
      if ((err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") throw new WritebackBusyError();
      throw err;
    }
    return (await findOpByKey(input.idempotencyKey)) ?? op;
  }
  // Sección crítica síncrona (sin await): reserva atómica en memoria.
  if (mem().some((o) => o.recordId === input.recordId && o.field === input.field && OPEN.includes(o.status) && o.idempotencyKey !== input.idempotencyKey)) {
    throw new WritebackBusyError();
  }
  mem().push(op);
  return op;
}

export async function updateOp(
  id: string,
  patch: Partial<Pick<WritebackOp, "status" | "a1" | "lastError" | "attempts" | "oldValue">>
): Promise<void> {
  const now = new Date();
  const confirmedAt = patch.status === "confirmed" ? now : undefined;
  if (isDatabaseConfigured()) {
    await getDb()
      .update(asignacionLotesWritebackOps)
      .set({ ...patch, updatedAt: now, ...(confirmedAt ? { confirmedAt } : {}) })
      .where(eq(asignacionLotesWritebackOps.id, id));
    return;
  }
  const op = mem().find((o) => o.id === id);
  if (op) {
    Object.assign(op, patch, { updatedAt: now.toISOString() });
    if (confirmedAt) op.confirmedAt = now.toISOString();
  }
}

export async function listOpenOps(): Promise<WritebackOp[]> {
  if (isDatabaseConfigured()) {
    const rows = await getDb()
      .select()
      .from(asignacionLotesWritebackOps)
      .where(inArray(asignacionLotesWritebackOps.status, OPEN));
    return rows.map(rowToOp);
  }
  return mem().filter((o) => OPEN.includes(o.status));
}

/**
 * ¿Hay una escritura abierta, o confirmada después de `sinceIso`, para este
 * registro? El sync la usa para NO pisar con una lectura vieja de la Sheet lo
 * que GENUS acaba de escribir (evita que el cron revierta el cambio).
 */
export async function hasWritebackSince(recordId: string, sinceIso: string | null): Promise<boolean> {
  if (isDatabaseConfigured()) {
    const rows = await getDb()
      .select()
      .from(asignacionLotesWritebackOps)
      .where(
        and(
          eq(asignacionLotesWritebackOps.recordId, recordId),
          inArray(asignacionLotesWritebackOps.status, [...OPEN, "confirmed"])
        )
      );
    return rows.some(
      (r) => OPEN.includes(r.status as WritebackStatus) || (sinceIso && r.confirmedAt && r.confirmedAt.toISOString() >= sinceIso)
    );
  }
  return mem().some(
    (o) =>
      o.recordId === recordId &&
      (OPEN.includes(o.status) || (o.status === "confirmed" && sinceIso && o.confirmedAt && o.confirmedAt >= sinceIso))
  );
}

export function getWritebackOpsMemory(): WritebackOp[] {
  return mem();
}
