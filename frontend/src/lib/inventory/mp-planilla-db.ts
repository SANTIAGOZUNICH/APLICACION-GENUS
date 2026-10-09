/**
 * Materias Primas sobre Postgres — TODA operación de MP en UNA transacción (Etapa 3).
 *
 * Antes cada request hidrataba una copia en memoria compartida, la modificaba y re-escribía TODAS las filas de MP; el
 * libro mayor se escribía aparte, en otra conexión. Dos usuarios a la vez se pisaban («gana el último») y un error a
 * mitad de camino dejaba el lote y el libro mayor distintos.
 *
 * Ahora `runMpInventoryOp`:
 *  1. abre una transacción y toma un candado de MP (pg_advisory_xact_lock): las escrituras de MP se serializan;
 *  2. lee las tablas de MP DENTRO de la transacción en un repositorio propio del request (no compartido);
 *  3. ejecuta el MISMO servicio de siempre (`InventoryService`: reglas de lotes, código pendiente, productos
 *     asociados, auditoría) — no hay una segunda implementación de las reglas;
 *  4. los movimientos del libro mayor que dispara el servicio usan esa misma transacción (transacción ambiente);
 *  5. cada ajuste de kg de un lote (celda con motivo, «Ajustar stock», alta manual) se registra también en el libro
 *     mayor, con el mismo delta;
 *  6. escribe SOLO las filas que cambiaron, condicionadas a que nadie las haya tocado desde la lectura, más la auditoría
 *     y los ajustes. O se confirma todo o nada.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invAjustes, invAudit, invMpCompras, invMpControl, invMpIngresos, invMpStock } from "@/lib/db/schema";
import { runWithTx, type DbTx } from "@/lib/db/tx-context";
import { MAX_INVENTORY_CELL_CHANGES, type InventoryCellChange, type InventoryCellResult } from "./cell-edit";
import {
  createInventoryService,
  InventoryValidationError,
  type InventoryActor,
  type InventoryNotificationPayload,
  type InventoryService,
} from "./inventory-service";
import { MemoryInventoryRepo } from "./memory-repo";
import {
  MAX_MP_SHEET_CHANGES,
  MIN_MP_CORRECCION_MOTIVO,
  mpSheetNeedsReason,
  mpSheetProtection,
  validateMpSheetValue,
  type MpSheetChange,
  type MpSheetResource,
  type MpSheetResult,
} from "./mp-sheet-edit";
import { normalizeMpIngresoPayload, normalizeMpStockPayload } from "./neon-persist";
import type { MpCompraRow, MpControlRow, MpIngresoRow, MpStockRow } from "./types";

/** Alguien guardó la misma fila entre la lectura y la escritura (no debería pasar con el candado; red de seguridad). */
export class MpConflictError extends Error {
  status = 409;
  code = "CONFLICT";
  constructor(message = "Otro usuario modificó este registro mientras editabas. Recargá y revisá antes de guardar.") {
    super(message);
    this.name = "MpConflictError";
  }
}

/** Celdas rechazadas: nada se escribió. */
export class MpSheetPatchError extends Error {
  status: number;
  code = "CELLS_REJECTED";
  constructor(readonly results: Array<MpSheetResult | InventoryCellResult>) {
    const first =
      results.find((r) => !r.ok && !r.message.startsWith("No se guardó: otra celda")) ?? results.find((r) => !r.ok);
    super(first && !first.ok ? first.message : "No se guardó.");
    this.status = results.some((r) => !r.ok && r.code === "CONFLICT")
      ? 409
      : results.some((r) => !r.ok && r.code === "PROTECTED")
        ? 403
        : 422;
  }
}

type Tables = {
  mpStock: typeof invMpStock;
  mpIngresos: typeof invMpIngresos;
  mpCompras: typeof invMpCompras;
  mpControl: typeof invMpControl;
};
const TABLES: Tables = { mpStock: invMpStock, mpIngresos: invMpIngresos, mpCompras: invMpCompras, mpControl: invMpControl };
type RepoKey = keyof Tables;

export interface MpOpContext {
  service: InventoryService;
  repo: MemoryInventoryRepo;
  tx: DbTx;
}

/**
 * Ejecuta una operación de MP con el servicio de inventario, atómica y serializada. `notify` recibe los avisos que
 * emitió el servicio, DESPUÉS de confirmar (un aviso nunca se manda por algo que se deshizo).
 */
export async function runMpInventoryOp<T>(
  actor: InventoryActor,
  op: (ctx: MpOpContext) => Promise<T> | T,
  options: { notify?: (payload: InventoryNotificationPayload) => Promise<void> | void } = {}
): Promise<T> {
  const notifications: InventoryNotificationPayload[] = [];
  const result = await getDb().transaction((tx) =>
    runWithTx(tx, async () => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('genus-mp-inventory'))`);
      const [stock, ingresos, compras, control] = await Promise.all([
        tx.select().from(invMpStock),
        tx.select().from(invMpIngresos),
        tx.select().from(invMpCompras),
        tx.select().from(invMpControl),
      ]);
      const repo = new MemoryInventoryRepo();
      repo.mpStock = stock.map((r) => normalizeMpStockPayload(r.payload));
      repo.mpIngresos = ingresos.map((r) => normalizeMpIngresoPayload(r.payload));
      repo.mpCompras = compras.map((r) => r.payload as MpCompraRow);
      repo.mpControl = control.map((r) => r.payload as MpControlRow);
      // Versión de base de cada fila (updated_at de la tabla) y su contenido, para escribir solo lo que cambió.
      const loaded: Record<RepoKey, Map<string, { json: string; dbUpdatedAt: Date }>> = {
        mpStock: new Map(stock.map((r, i) => [r.id, { json: JSON.stringify(repo.mpStock[i]), dbUpdatedAt: r.updatedAt }])),
        mpIngresos: new Map(ingresos.map((r, i) => [r.id, { json: JSON.stringify(repo.mpIngresos[i]), dbUpdatedAt: r.updatedAt }])),
        mpCompras: new Map(compras.map((r, i) => [r.id, { json: JSON.stringify(repo.mpCompras[i]), dbUpdatedAt: r.updatedAt }])),
        mpControl: new Map(control.map((r, i) => [r.id, { json: JSON.stringify(repo.mpControl[i]), dbUpdatedAt: r.updatedAt }])),
      };

      const service = createInventoryService(repo);
      service.onNotify((p) => void notifications.push(p));
      const out = await op({ service, repo, tx });

      const { getMpStockLedger } = await import("@/lib/mp-stock/mp-stock-ledger");
      // Operaciones de libro mayor de la planilla Stock MP (misma transacción): corrección de código (traspaso de
      // saldo + alias) y edición de «Stock código» (ajuste por la diferencia; conflicto si el saldo cambió).
      for (const op of repo.mpLedgerOps) {
        if (op.kind === "reclasificacion") {
          await getMpStockLedger().reclassifyCodigo(
            { email: actor.email, sector: actor.sector },
            { from: op.from, to: op.to, mode: op.mode, quantity: op.quantity, reason: op.reason, refId: op.refId, lote: op.lote, descripcion: op.descripcion }
          );
        } else {
          await getMpStockLedger().adjustCodigoBalance(
            { email: actor.email, sector: actor.sector },
            { codigo: op.codigo, target: op.target, expected: op.expected, reason: op.reason, refId: op.refId }
          );
        }
      }
      // Cada ajuste de kg de un lote → mismo delta en el libro mayor (misma transacción).
      for (const aj of repo.ajustes) {
        if (aj.module !== "MP" || !aj.diferencia) continue;
        const lot = repo.mpStock.find((l) => l.id === aj.entityId);
        if (!lot?.codigo?.trim()) continue;
        await getMpStockLedger().applyLotAdjustment(
          { email: actor.email, sector: actor.sector },
          {
            codigo: lot.codigo,
            quantity: aj.diferencia,
            reason: `${aj.motivo} (lote ${lot.lote || lot.id.slice(0, 8)})`,
            ajusteId: aj.id,
            lote: lot.lote,
            descripcion: lot.descripcion,
          }
        );
      }

      const now = new Date();
      for (const key of Object.keys(TABLES) as RepoKey[]) {
        const table = TABLES[key];
        for (const row of repo[key] as Array<{ id: string }>) {
          const before = loaded[key].get(row.id);
          if (before && before.json === JSON.stringify(row)) continue;
          if (before) {
            const res = await tx
              .update(table)
              .set({ payload: row as never, updatedAt: now })
              // Comparación al milisegundo: JS lee updated_at truncado a ms, pero una fila escrita por SQL (now(),
              // migración, importación) guarda microsegundos; con igualdad exacta esa fila NUNCA se podía editar
              // (siempre «otro usuario la modificó»). Las operaciones de MP ya están serializadas por el candado.
              .where(and(eq(table.id, row.id), sql`date_trunc('milliseconds', ${table.updatedAt}) = ${before.dbUpdatedAt.toISOString()}::timestamptz`))
              .returning({ id: table.id });
            if (res.length === 0) throw new MpConflictError();
          } else {
            await tx.insert(table).values({ id: row.id, payload: row as never, updatedAt: now });
          }
        }
      }
      for (const aj of repo.ajustes) {
        await tx.insert(invAjustes).values({ id: aj.id, payload: aj, createdAt: new Date(aj.createdAt) });
      }
      for (const a of repo.audit) {
        await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
      }
      return out;
    })
  );
  if (options.notify) {
    for (const n of notifications) {
      try {
        await options.notify(n);
      } catch (err) {
        console.warn("[inventory] aviso MP no enviado", err);
      }
    }
  }
  return result;
}

const sameVersion = (a: unknown, b: unknown) => String(a ?? "") === String(b ?? "");

/**
 * Edición por celda de Ingresos y Compras MP. Todo-o-nada: si una celda se rechaza no se guarda ninguna.
 * Ingresos: borradores se editan libres (no mueven stock); en confirmados, código/bultos/cantidad/lote son una
 * corrección con motivo que mueve stock por delta (lote + libro mayor en la misma transacción).
 */
export async function patchMpSheetCells(
  actor: InventoryActor,
  resource: MpSheetResource,
  changes: MpSheetChange[]
): Promise<{ items: Array<MpIngresoRow | MpCompraRow> }> {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_MP_SHEET_CHANGES) {
    throw new InventoryValidationError(`Entre 1 y ${MAX_MP_SHEET_CHANGES} celdas por operación.`);
  }
  return runMpInventoryOp(actor, async ({ service, repo }) => {
    const find = (id: string) =>
      resource === "mp_ingresos" ? repo.getMpIngreso(id) : (repo.getMpCompra(id) as (MpCompraRow & { status?: string }) | null);
    const results: MpSheetResult[] = changes.map(() => ({ ok: true }));
    const patches = new Map<string, { patch: Record<string, unknown>; reason: string }>();
    changes.forEach((c, i) => {
      const row = find(String(c?.id ?? ""));
      if (!row) return void (results[i] = { ok: false, code: "NOT_FOUND", message: "El registro ya no existe." });
      const prot = mpSheetProtection(resource, row as never, c.field, actor.sector, actor.isSuperadmin);
      if (prot) return void (results[i] = { ok: false, code: "PROTECTED", message: prot });
      if (!sameVersion(row.updatedAt, c.expectedVersion)) {
        return void (results[i] = {
          ok: false,
          code: "CONFLICT",
          message: "Otro usuario modificó este registro mientras editabas. Recargá y revisá antes de guardar.",
        });
      }
      const v = validateMpSheetValue(resource, c.field, c.value);
      if (!v.ok) return void (results[i] = { ok: false, code: "INVALID", message: v.message });
      const reason = String(c.reason ?? "").trim();
      if (mpSheetNeedsReason(resource, row as never, c.field) && reason.length < MIN_MP_CORRECCION_MOTIVO) {
        return void (results[i] = {
          ok: false,
          code: "INVALID",
          message: `Corregir un ingreso confirmado mueve el stock: indicá el motivo (mín. ${MIN_MP_CORRECCION_MOTIVO} caracteres).`,
        });
      }
      const entry = patches.get(row.id) ?? { patch: {}, reason: "" };
      entry.patch[c.field] = v.value;
      if (reason) entry.reason = reason;
      patches.set(row.id, entry);
    });
    const reject = () => {
      changes.forEach((_, i) => {
        if (results[i]!.ok) results[i] = { ok: false, code: "INVALID", message: "No se guardó: otra celda del mismo cambio fue rechazada." };
      });
      throw new MpSheetPatchError(results);
    };
    if (results.some((r) => !r.ok)) reject();

    const items: Array<MpIngresoRow | MpCompraRow> = [];
    for (const [id, { patch, reason }] of patches) {
      try {
        if (resource === "mp_ingresos") {
          const current = repo.getMpIngreso(id)!;
          // El estado se conserva explícitamente: editar un borrador NO lo confirma (antes, cualquier guardado con
          // cantidad lo confirmaba y movía stock). Confirmar es una acción aparte.
          items.push(
            await service.upsertMpIngreso(actor, {
              id,
              ...(patch as Partial<MpIngresoRow>),
              status: current.status === "CONFIRMADO" ? "CONFIRMADO" : "BORRADOR",
              auditReason: reason || undefined,
            })
          );
        } else {
          items.push(service.upsertMpCompra(actor, { id, ...(patch as Partial<MpCompraRow>) }).compra);
        }
      } catch (err) {
        if (!(err instanceof InventoryValidationError)) throw err;
        const code = /^Duplicado/.test(err.message) ? "DUPLICATE" : "INVALID";
        changes.forEach((c, i) => {
          if (c.id === id) results[i] = { ok: false, code, message: err.message };
        });
      }
    }
    if (results.some((r) => !r.ok)) reject();
    return { items };
  });
}

/** Stock MP por celda (proveedor, cliente, descripción, ubicación, lote, vencimiento, kg con motivo → ajuste). */
export async function patchMpStockCells(actor: InventoryActor, changes: InventoryCellChange[]): Promise<{ items: MpStockRow[] }> {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_INVENTORY_CELL_CHANGES) {
    throw new InventoryValidationError(`Entre 1 y ${MAX_INVENTORY_CELL_CHANGES} celdas por operación.`);
  }
  const { MpLedgerConflictError } = await import("@/lib/mp-stock/mp-stock-ledger");
  try {
    return await patchMpStockCellsTx(actor, changes);
  } catch (err) {
    if (err instanceof MpLedgerConflictError) {
      throw new MpSheetPatchError(changes.map(() => ({ ok: false as const, code: "CONFLICT" as const, message: err.message })));
    }
    throw err;
  }
}

async function patchMpStockCellsTx(actor: InventoryActor, changes: InventoryCellChange[]): Promise<{ items: MpStockRow[] }> {
  return runMpInventoryOp(actor, ({ service, repo }) => {
    const results = service.patchInventoryCells(actor, "mp_stock", changes);
    if (!results.every((r) => r.ok)) {
      // Todo-o-nada: cualquier rechazo deshace la transacción completa.
      throw new MpSheetPatchError(
        results.map((r) => (r.ok ? { ok: false as const, code: "INVALID" as const, message: "No se guardó: otra celda del mismo cambio fue rechazada." } : r))
      );
    }
    const ids = new Set(changes.map((c) => c.id));
    return { items: repo.listMpStock().filter((l) => ids.has(l.id)) };
  });
}

/** Confirma ingresos en BORRADOR (alta por pegado/planilla): recién ahí suman al stock (lote + libro mayor). */
export async function confirmMpIngresos(
  actor: InventoryActor,
  items: Array<{ id: string; expectedVersion: string }>
): Promise<{ items: MpIngresoRow[] }> {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_MP_SHEET_CHANGES) {
    throw new InventoryValidationError(`Entre 1 y ${MAX_MP_SHEET_CHANGES} ingresos por operación.`);
  }
  return runMpInventoryOp(actor, async ({ service, repo }) => {
    const out: MpIngresoRow[] = [];
    for (const it of items) {
      const row = repo.getMpIngreso(it.id);
      if (!row) throw new InventoryValidationError("Un ingreso ya no existe. Recargá.");
      if (!sameVersion(row.updatedAt, it.expectedVersion)) throw new MpConflictError(`El ingreso ${row.ingresoNro} cambió mientras confirmabas. Recargá.`);
      if (row.status === "ANULADO") throw new InventoryValidationError(`El ingreso ${row.ingresoNro} está anulado.`);
      if (row.status === "CONFIRMADO") {
        out.push(row);
        continue;
      }
      out.push(await service.upsertMpIngreso(actor, { id: row.id, status: "CONFIRMADO" }));
    }
    return { items: out };
  });
}
