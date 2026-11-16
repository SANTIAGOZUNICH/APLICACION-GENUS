/**
 * Entregas Producción ↔ stock ME.
 *
 * Cada despacho (fila de `deposito_despachos`) descuenta stock mediante UNA salida de `inv_me_salidas`
 * (motivo ENTREGA_PRODUCCION, `despachoId`, `idempotencyKey: despacho:<id>`). El stock NO se guarda: se sigue calculando de los
 * movimientos (ver me-stock-calc), de modo que INGRESOS queda intacto y STOCK refleja el saldo.
 *
 * Reglas:
 *  - Material = por cliente + descripción (producto de la entrega). Si no hay UN único material que coincida, la entrega queda
 *    «SIN_MATERIAL»: no descuenta nada y Depósito elige el código (assign). Nunca se inventa.
 *  - Idempotente: reintentar / recargar / sincronizar no crea otra salida (búsqueda por despachoId + clave).
 *  - Editar cantidad/código/fecha de la entrega corrige la MISMA salida; borrar la entrega ANULA la salida (reverted, con historial):
 *    no se borra físicamente nada que haya afectado inventario.
 *  - Entregas anteriores a esta función (`HISTORICO`) no se tocan hasta que Depósito las aplique explícitamente (informe previo).
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { depositoDespachos, invAudit, invMeMaterials, invMeSalidas } from "@/lib/db/schema";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersValidationError } from "@/lib/orders/types";
import { auditRow, loadLedgerInputs, lockCodigos, stockOf } from "@/lib/inventory/me-planilla-db";
import { normalizeMeCodigo } from "@/lib/inventory/me-codigo";
import type { InventoryActor } from "@/lib/inventory/inventory-service";
import type { MeMaterial, MeSalidaRow } from "@/lib/inventory/types";
import { canAccessDespachos, canMutateDespachos } from "./despachos-rbac";
import type { DespachosActor } from "./types";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type DespachoRow = typeof depositoDespachos.$inferSelect;

export const DESPACHO_STOCK_STATUS = {
  VINCULADO: "VINCULADO",
  SIN_MATERIAL: "SIN_MATERIAL",
  HISTORICO: "HISTORICO",
  ANULADO: "ANULADO",
} as const;

const norm = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Materiales (no archivados) cuyo cliente + descripción coinciden con la entrega. Devuelve los CÓDIGOS distintos. */
export function matchMaterialCodigos(materials: ReadonlyArray<Pick<MeMaterial, "codigo" | "descripcion" | "cliente" | "archived">>, cliente: string, producto: string): string[] {
  const c = norm(cliente);
  const p = norm(producto);
  if (!p) return [];
  const out = new Set<string>();
  for (const m of materials) {
    if (m.archived) continue;
    if (norm(m.descripcion) !== p) continue;
    // Cliente vacío en cualquiera de los lados no habilita mezclar clientes: debe coincidir exactamente.
    if (norm(m.cliente) !== c) continue;
    const code = normalizeMeCodigo(m.codigo);
    if (code) out.add(code);
  }
  return [...out];
}

const toActor = (a: DespachosActor): InventoryActor => ({ email: a.email, sector: a.sector } as InventoryActor);

async function loadMaterials(tx: Tx | ReturnType<typeof getDb>): Promise<MeMaterial[]> {
  return (await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials)).map((r) => r.payload as MeMaterial);
}

async function findSalida(tx: Tx, despachoId: string): Promise<{ id: string; row: MeSalidaRow } | null> {
  const rows = await tx
    .select({ id: invMeSalidas.id, payload: invMeSalidas.payload })
    .from(invMeSalidas)
    .where(sql`${invMeSalidas.payload}->>'despachoId' = ${despachoId}`)
    .for("update");
  const hit = rows.find((r) => !(r.payload as MeSalidaRow).reverted) ?? rows[0];
  return hit ? { id: hit.id, row: hit.payload as MeSalidaRow } : null;
}

const nextVersion = (prev: string) => new Date(Math.max(Date.now(), new Date(prev).getTime() + 1)).toISOString();

export type SyncOutcome = { status: string | null; codigo: string | null; salidaId: string | null; changed: boolean };

/** Núcleo (dentro de una transacción): deja la salida ME de UN despacho en el estado que corresponde. Idempotente. */
async function syncInTx(tx: Tx, actor: DespachosActor, despachoId: string, opts: { force?: boolean } = {}): Promise<SyncOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-despacho-stock:${despachoId}`}))`);
  const [d] = await tx.select().from(depositoDespachos).where(eq(depositoDespachos.id, despachoId)).for("update");
  if (!d) return { status: null, codigo: null, salidaId: null, changed: false };
  const existing = await findSalida(tx, despachoId);
  const none: SyncOutcome = { status: d.meStockStatus ?? null, codigo: d.meCodigo ?? null, salidaId: d.meSalidaId ?? null, changed: false };

  // Entrega anterior a esta función: no se toca nada salvo aplicación explícita.
  if (d.meStockStatus === DESPACHO_STOCK_STATUS.HISTORICO && !existing && !opts.force) return none;

  const deleted = d.deletedAt != null;
  const qty = Number(d.cantidadTotal) || 0;
  let codigo = normalizeMeCodigo(d.meCodigo ?? "") || (existing ? normalizeMeCodigo(existing.row.codigo) : "");
  if (!codigo && !deleted) {
    const matches = matchMaterialCodigos(await loadMaterials(tx), d.cliente, d.producto);
    if (matches.length === 1) codigo = matches[0]!;
  }

  const inv = toActor(actor);
  const wantActive = !deleted && qty > 0 && Boolean(codigo);
  await lockCodigos(tx, [codigo, existing?.row.codigo ?? ""]);
  const now = new Date();
  let status: string | null;
  let salidaId: string | null = existing?.id ?? d.meSalidaId ?? null;
  let changed = false;

  if (existing) {
    const cur = existing.row;
    if (wantActive) {
      const next: MeSalidaRow = {
        ...cur,
        fecha: d.fecha ?? cur.fecha,
        egresoNro: d.egreso || cur.egresoNro,
        cliente: d.cliente,
        remitoNro: d.remito,
        descripcion: d.producto,
        bultos: Number(d.bultos) || null,
        cantidad: d.cantidad == null ? Number(d.cantidadTotal) : Number(d.cantidad),
        total: qty,
        codigo,
        materialId: cur.codigo === codigo ? cur.materialId : null,
        comentarios: `Entrega a Producción${d.pedidoOp ? ` · ${d.pedidoOp}` : ""}${d.comentarios ? ` · ${d.comentarios}` : ""}`,
        descuentaStock: true,
        reverted: false,
        revertedAt: null,
        revertReason: null,
      };
      const keys: Array<keyof MeSalidaRow> = ["fecha", "egresoNro", "cliente", "remitoNro", "descripcion", "bultos", "cantidad", "total", "codigo", "comentarios", "reverted"];
      const diff = keys.filter((k) => JSON.stringify(cur[k] ?? null) !== JSON.stringify(next[k] ?? null));
      if (diff.length > 0) {
        if (next.codigo !== cur.codigo) {
          const mat = (await loadMaterials(tx)).find((m) => normalizeMeCodigo(m.codigo) === codigo && !m.archived);
          next.materialId = mat?.id ?? null;
        }
        next.updatedBy = actor.email;
        next.updatedAt = nextVersion(cur.updatedAt);
        await tx.update(invMeSalidas).set({ payload: next, updatedAt: now }).where(eq(invMeSalidas.id, existing.id));
        const a = auditRow(inv, "me_salidas", existing.id, cur.reverted ? "restore" : "update", Object.fromEntries(diff.map((k) => [k, cur[k] ?? null])), Object.fromEntries(diff.map((k) => [k, next[k] ?? null])), `Entrega Producción ${d.egreso || d.id}`);
        await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
        changed = true;
      }
      status = DESPACHO_STOCK_STATUS.VINCULADO;
    } else {
      if (!cur.reverted) {
        const next: MeSalidaRow = { ...cur, reverted: true, revertedAt: now.toISOString(), revertReason: deleted ? "Entrega a Producción eliminada" : "Entrega a Producción sin cantidad/código", updatedBy: actor.email, updatedAt: nextVersion(cur.updatedAt) };
        await tx.update(invMeSalidas).set({ payload: next, updatedAt: now }).where(eq(invMeSalidas.id, existing.id));
        const a = auditRow(inv, "me_salidas", existing.id, "revert", { reverted: false, total: cur.total }, { reverted: true }, next.revertReason);
        await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
        changed = true;
      }
      status = deleted ? DESPACHO_STOCK_STATUS.ANULADO : codigo ? DESPACHO_STOCK_STATUS.VINCULADO : DESPACHO_STOCK_STATUS.SIN_MATERIAL;
    }
  } else if (wantActive) {
    const id = randomUUID();
    const mat = (await loadMaterials(tx)).find((m) => normalizeMeCodigo(m.codigo) === codigo && !m.archived);
    const stamp = now.toISOString();
    const row: MeSalidaRow = {
      id,
      fecha: d.fecha ?? stamp.slice(0, 10),
      egresoNro: d.egreso,
      cliente: d.cliente,
      remitoNro: d.remito,
      descripcion: d.producto,
      bultos: Number(d.bultos) || null,
      cantidad: d.cantidad == null ? qty : Number(d.cantidad),
      total: qty,
      control: false,
      entregado: false,
      comentarios: `Entrega a Producción${d.pedidoOp ? ` · ${d.pedidoOp}` : ""}${d.comentarios ? ` · ${d.comentarios}` : ""}`,
      materialId: mat?.id ?? null,
      codigo,
      unidad: mat?.unidad || "u",
      origen: "MANUAL",
      descuentaStock: true,
      motivoSalida: "ENTREGA_PRODUCCION",
      despachoId,
      oaId: null,
      oaNumber: null,
      oaVersion: null,
      materialLineId: null,
      idempotencyKey: `despacho:${despachoId}`,
      reverted: false,
      revertedAt: null,
      revertReason: null,
      createdBy: actor.email,
      updatedBy: actor.email,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await tx.insert(invMeSalidas).values({ id, payload: row, updatedAt: now });
    const a = auditRow(inv, "me_salidas", id, "create", null, { despachoId, codigo, total: qty, motivoSalida: "ENTREGA_PRODUCCION" }, `Entrega Producción ${d.egreso || d.id}`);
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
    salidaId = id;
    status = DESPACHO_STOCK_STATUS.VINCULADO;
    changed = true;
  } else {
    status = deleted ? DESPACHO_STOCK_STATUS.ANULADO : DESPACHO_STOCK_STATUS.SIN_MATERIAL;
  }

  // updatedAt de la entrega NO se toca: es su versión para concurrencia optimista (la planilla no debe dar CONFLICT por esto).
  if (status !== (d.meStockStatus ?? null) || codigo !== (d.meCodigo ?? "") || salidaId !== (d.meSalidaId ?? null)) {
    await tx.update(depositoDespachos).set({ meStockStatus: status, meCodigo: codigo || null, meSalidaId: salidaId }).where(eq(depositoDespachos.id, despachoId));
  }
  return { status, codigo: codigo || null, salidaId, changed };
}

/** Sincroniza UN despacho con el stock ME (en su propia transacción). */
export async function syncDespachoStock(actor: DespachosActor, despachoId: string): Promise<SyncOutcome> {
  return getDb().transaction((tx) => syncInTx(tx, actor, despachoId));
}

/** Variante tolerante para los hooks de alta/edición/baja: la entrega ya está guardada; si el vínculo falla queda «pendiente» y se reintenta. */
export async function syncDespachosStockSafe(actor: DespachosActor, ids: string[]): Promise<void> {
  for (const id of new Set(ids)) {
    try {
      await syncDespachoStock(actor, id);
    } catch (e) {
      console.error("[despachos] no se pudo vincular la entrega con el stock ME", { despachoId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export type DespachoStockReportRow = {
  id: string;
  fecha: string | null;
  egreso: string;
  cliente: string;
  producto: string;
  cantidadTotal: number;
  status: string | null;
  codigo: string | null;
  candidatos: string[];
  /** Qué haría «aplicar»: descuenta stock del código / necesita elegir material / nada. */
  accion: "DESCONTAR" | "ELEGIR_MATERIAL" | "NADA";
  stockActual: number | null;
};

/** Informe de diferencias (solo lectura): qué entregas ya descuentan, cuáles son históricas y qué pasaría al aplicarlas. */
export async function despachoStockReport(actor: DespachosActor): Promise<{ rows: DespachoStockReportRow[]; resumen: { vinculadas: number; historicas: number; sinMaterial: number; pendientes: number; unidadesHistoricas: number } }> {
  if (!canAccessDespachos(actor.sector)) throw new OrdersForbiddenError("Sin acceso a Entregas Producción.");
  const db = getDb();
  const [list, materials, data] = await Promise.all([
    db.select().from(depositoDespachos).where(isNull(depositoDespachos.deletedAt)),
    loadMaterials(db),
    loadLedgerInputs(db),
  ]);
  const rows: DespachoStockReportRow[] = list.map((d: DespachoRow) => {
    const candidatos = d.meCodigo ? [normalizeMeCodigo(d.meCodigo)] : matchMaterialCodigos(materials, d.cliente, d.producto);
    const codigo = candidatos.length === 1 ? candidatos[0]! : null;
    const qty = Number(d.cantidadTotal) || 0;
    const accion: DespachoStockReportRow["accion"] = d.meStockStatus === DESPACHO_STOCK_STATUS.VINCULADO || qty <= 0 ? "NADA" : codigo ? "DESCONTAR" : "ELEGIR_MATERIAL";
    return {
      id: d.id,
      fecha: d.fecha,
      egreso: d.egreso,
      cliente: d.cliente,
      producto: d.producto,
      cantidadTotal: qty,
      status: d.meStockStatus ?? null,
      codigo,
      candidatos,
      accion,
      stockActual: codigo ? stockOf(codigo, data).stock : null,
    };
  });
  return {
    rows,
    resumen: {
      vinculadas: rows.filter((r) => r.status === DESPACHO_STOCK_STATUS.VINCULADO).length,
      historicas: rows.filter((r) => r.status === DESPACHO_STOCK_STATUS.HISTORICO).length,
      sinMaterial: rows.filter((r) => r.status === DESPACHO_STOCK_STATUS.SIN_MATERIAL).length,
      pendientes: rows.filter((r) => r.status == null).length,
      unidadesHistoricas: rows.filter((r) => r.status === DESPACHO_STOCK_STATUS.HISTORICO).reduce((a, r) => a + r.cantidadTotal, 0),
    },
  };
}

function assertMutate(a: DespachosActor) {
  if (!canMutateDespachos(a.sector)) throw new OrdersForbiddenError("Solo Depósito puede vincular entregas al stock.");
}

/** Depósito elige el material (código) de una entrega que no se pudo identificar; descuenta (también para entregas históricas, de forma explícita). */
export async function assignDespachoMaterial(actor: DespachosActor, despachoId: string, codigoRaw: string): Promise<SyncOutcome> {
  assertMutate(actor);
  const codigo = normalizeMeCodigo(codigoRaw);
  if (!codigo) throw new OrdersValidationError("Elegí el código del material.");
  return getDb().transaction(async (tx) => {
    const mats = await loadMaterials(tx);
    if (!mats.some((m) => !m.archived && normalizeMeCodigo(m.codigo) === codigo)) throw new OrdersValidationError(`El código ${codigo} no existe en Depósito ME (o está archivado).`);
    const [d] = await tx.select().from(depositoDespachos).where(and(eq(depositoDespachos.id, despachoId), isNull(depositoDespachos.deletedAt))).for("update");
    if (!d) throw new OrdersNotFoundError("Entrega no encontrada.");
    await tx.update(depositoDespachos).set({ meCodigo: codigo }).where(eq(depositoDespachos.id, despachoId));
    return syncInTx(tx, actor, despachoId, { force: true });
  });
}

/** Aplica el descuento a las entregas históricas indicadas (o a todas las que tienen material identificable). Cada una es independiente e idempotente. */
export async function applyHistoricoDespachos(actor: DespachosActor, ids?: string[]): Promise<{ aplicadas: string[]; omitidas: Array<{ id: string; motivo: string }> }> {
  assertMutate(actor);
  const db = getDb();
  const list = await db.select().from(depositoDespachos).where(and(isNull(depositoDespachos.deletedAt), ids?.length ? inArray(depositoDespachos.id, ids) : sql`true`));
  const aplicadas: string[] = [];
  const omitidas: Array<{ id: string; motivo: string }> = [];
  for (const d of list) {
    if (d.meStockStatus === DESPACHO_STOCK_STATUS.VINCULADO) { omitidas.push({ id: d.id, motivo: "Ya descuenta stock." }); continue; }
    try {
      const out = await getDb().transaction((tx) => syncInTx(tx, actor, d.id, { force: true }));
      if (out.status === DESPACHO_STOCK_STATUS.VINCULADO) aplicadas.push(d.id);
      else omitidas.push({ id: d.id, motivo: "Sin material identificado: elegí el código." });
    } catch (e) {
      omitidas.push({ id: d.id, motivo: e instanceof Error ? e.message : "Error" });
    }
  }
  return { aplicadas, omitidas };
}

/** Materiales ME (activos) para el selector «elegir material» de una entrega. */
export async function listMaterialesParaEntrega(actor: DespachosActor): Promise<Array<{ codigo: string; descripcion: string; cliente: string }>> {
  if (!canAccessDespachos(actor.sector)) throw new OrdersForbiddenError("Sin acceso a Entregas Producción.");
  const seen = new Set<string>();
  const out: Array<{ codigo: string; descripcion: string; cliente: string }> = [];
  for (const m of await loadMaterials(getDb())) {
    const codigo = normalizeMeCodigo(m.codigo);
    if (m.archived || !codigo || seen.has(codigo)) continue;
    seen.add(codigo);
    out.push({ codigo, descripcion: m.descripcion, cliente: m.cliente });
  }
  return out.sort((a, b) => a.codigo.localeCompare(b.codigo));
}
