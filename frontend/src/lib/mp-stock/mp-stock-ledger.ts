/** Ledger stock MP por código — puro + servicio con memoria/Neon. */

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { currentTx } from "@/lib/db/tx-context";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  SchemaPendingError,
} from "@/lib/db/feature-schema";
import { mpStockBalances, mpStockMovements, osNotifications } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";

export type MpStockMovementKind =
  | "SALDO_INICIAL"
  | "INGRESO"
  | "CONSUMO_OE"
  | "AJUSTE"
  | "REVERSO"
  /** Traspaso de saldo entre códigos al corregir el código de un lote (par salida/entrada; nunca reescribe historia). */
  | "RECLASIFICACION";

export type MpStockActor = { email: string; sector: SectorId };

export type MpStockBalance = {
  codigo: string;
  descripcion: string;
  saldoInicial: number;
  stockActual: number;
  seededAt: string | null;
};

export type MpStockMovement = {
  id: string;
  codigo: string;
  kind: MpStockMovementKind;
  quantity: number;
  balanceAfter: number | null;
  reason: string;
  refType: string | null;
  refId: string | null;
  lote: string | null;
  proveedor: string | null;
  documento: string | null;
  actorEmail: string;
  actorSector: string;
  idempotencyKey: string;
  reversed: boolean;
  createdAt: string;
  /** Datos extra del movimiento (p. ej. `lotId`: la fila de Stock MP afectada por un consumo de OE). */
  payload?: Record<string, unknown>;
};

type Mem = {
  balances: Map<string, MpStockBalance>;
  movements: MpStockMovement[];
  seededKeys: Set<string>;
  /** código viejo → código nuevo (reclasificación completa). */
  aliases: Map<string, string>;
};

const g = globalThis as unknown as { __genusMpStockMem?: Mem };
function mem(): Mem {
  if (!g.__genusMpStockMem) {
    g.__genusMpStockMem = {
      balances: new Map(),
      movements: [],
      seededKeys: new Set(),
      aliases: new Map(),
    };
  }
  return g.__genusMpStockMem;
}

/**
 * Posición de consumo de una OE: (código de Stock MP, lote). Los movimientos de una entrega llevan la versión de la
 * OE (`:v{n}`): un reintento de la MISMA entrega no vuelve a descontar. El separador «|lote:» evita que MP1 se confunda
 * con MP10 (antes la búsqueda por prefijo los mezclaba).
 */
export function buildOePositionId(codigo: string, lote: string | null | undefined): string {
  return `${normalizeMpCodigo(codigo)}|lote:${String(lote ?? "").trim().replace(/\s+/g, " ").toUpperCase()}`;
}

export function buildOeConsumptionKey(oeId: string, oeVersion: number, codigo: string, lote?: string | null): string {
  return `oe-consumo:${oeId}:cod:${buildOePositionId(codigo, lote)}:v${oeVersion}`;
}

export function buildOeReverseKey(oeId: string, oeVersion: number, codigo: string, lote?: string | null): string {
  return `oe-reverso:${oeId}:cod:${buildOePositionId(codigo, lote)}:v${oeVersion}`;
}

export function buildOeConsumptionKeyLegacy(
  oeId: string,
  oeVersion: number,
  lineId: string,
  codigo: string
): string {
  return `oe-consumo:${oeId}:line:${lineId}:cod:${codigo.trim().toUpperCase()}:v${oeVersion}`;
}

export function normalizeMpCodigo(codigo: string): string {
  return codigo.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildIngresoKey(ingresoId: string, versionTag: string): string {
  return `mp-ingreso:${ingresoId}:${versionTag}`;
}

export function buildAjusteKey(id: string): string {
  return `mp-ajuste:${id}`;
}

export function buildSeedKey(codigo: string): string {
  return `mp-seed-saldo-inicial:${codigo.trim().toUpperCase()}`;
}

async function notify(params: {
  kind: string;
  title: string;
  message: string;
  sectors: SectorId[];
  href?: string;
  idempotencyHint: string;
}) {
  if (isDatabaseConfigured()) {
    try {
      // Conexión propia a propósito: un aviso fallido nunca puede abortar la transacción del movimiento.
      const db = getDb();
      await db.insert(osNotifications).values({
        kind: params.kind,
        title: params.title,
        message: params.message,
        sectors: params.sectors,
        href: params.href ?? "/stock",
        orderId: null,
        readBy: [],
        dismissedBy: [],
        deletedBy: [],
      });
      return;
    } catch {
      /* ignore */
    }
  }
  void params.idempotencyHint;
}

/** El saldo del código cambió desde que el usuario lo vio (edición de «Stock código»). */
export class MpLedgerConflictError extends Error {
  status = 409;
  code = "CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "MpLedgerConflictError";
  }
}

export class MpStockLedgerService {
  /**
   * Código vigente: si el código fue reclasificado COMPLETO a otro (corrección del código de su lote), los movimientos
   * nuevos (consumo o reverso de una OE vieja, control semanal) van al código nuevo. La historia no se toca.
   */
  async resolveCodigo(codigo: string): Promise<string> {
    let code = normalizeMpCodigo(codigo);
    const seen = new Set<string>();
    for (let i = 0; i < 8 && code && !seen.has(code); i += 1) {
      seen.add(code);
      let next: string | null = null;
      if (isDatabaseConfigured()) {
        try {
          const db = currentTx() ?? getDb();
          const [row] = await db.select({ payload: mpStockBalances.payload }).from(mpStockBalances).where(eq(mpStockBalances.codigo, code)).limit(1);
          const target = (row?.payload as { reclasificadoA?: string | null } | undefined)?.reclasificadoA;
          next = target ? normalizeMpCodigo(target) : null;
        } catch (err) {
          if (!isMissingSchemaError(err) || !isFeatureMemoryAllowed()) throw err;
          next = mem().aliases.get(code) ?? null;
        }
      } else {
        next = mem().aliases.get(code) ?? null;
      }
      if (!next || next === code) break;
      code = next;
    }
    return code;
  }

  private async setAlias(from: string, to: string | null): Promise<void> {
    if (isDatabaseConfigured()) {
      const db = currentTx() ?? getDb();
      if (to) {
        await db
          .insert(mpStockBalances)
          .values({ codigo: from, payload: { reclasificadoA: to, reclasificadoAt: new Date().toISOString() } })
          .onConflictDoUpdate({
            target: mpStockBalances.codigo,
            set: { payload: sql`coalesce(${mpStockBalances.payload}, '{}'::jsonb) || ${JSON.stringify({ reclasificadoA: to, reclasificadoAt: new Date().toISOString() })}::jsonb` },
          });
      } else {
        await db.update(mpStockBalances).set({ payload: sql`coalesce(${mpStockBalances.payload}, '{}'::jsonb) - 'reclasificadoA'` }).where(eq(mpStockBalances.codigo, from));
      }
      return;
    }
    if (to) mem().aliases.set(from, to);
    else mem().aliases.delete(from);
  }

  /** Saldo actual de un código, con el candado del código tomado si hay transacción (para leer y decidir). */
  private async lockedBalance(code: string): Promise<number> {
    const tx = currentTx();
    if (isDatabaseConfigured() && tx) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-mp-stock:${code}`}))`);
      const [row] = await tx.select({ stock: mpStockBalances.stockActual }).from(mpStockBalances).where(eq(mpStockBalances.codigo, code)).for("update");
      return row?.stock ?? 0;
    }
    return (await this.getBalance(code))?.stockActual ?? 0;
  }

  /**
   * Corrección del CÓDIGO de un lote: traspasa saldo del código viejo al nuevo con un par de movimientos
   * RECLASIFICACION (salida / entrada), en la transacción ambiente. Si el lote era el único del código viejo
   * (`mode: "all"`) se traspasa TODO el saldo del código y queda un alias viejo → nuevo, para que el consumo o el
   * reverso de una OE anterior caigan en el código nuevo. Los movimientos históricos no se modifican.
   */
  async reclassifyCodigo(
    actor: MpStockActor,
    params: { from: string; to: string; mode: "all" | "quantity"; quantity?: number; reason: string; refId: string; lote?: string; descripcion?: string }
  ): Promise<{ moved: number }> {
    await assertFeatureWritesEnabled();
    const from = normalizeMpCodigo(params.from);
    const to = normalizeMpCodigo(params.to);
    if (!from || !to || from === to) return { moved: 0 };
    // Candados de los dos códigos en orden fijo: dos reclasificaciones cruzadas no se bloquean entre sí.
    const [a, b] = [from, to].sort();
    await this.lockedBalance(a!);
    await this.lockedBalance(b!);
    const current = await this.lockedBalance(from);
    const moved = Math.round((params.mode === "all" ? current : Number(params.quantity ?? 0)) * 1000) / 1000;
    const reason = `Reclasificación de código ${from} → ${to}${params.reason.trim() ? `: ${params.reason.trim()}` : ""}`;
    if (moved !== 0) {
      await this.applyMovement(actor, {
        codigo: from, kind: "RECLASIFICACION", quantity: -moved, reason, idempotencyKey: `mp-reclasif:${params.refId}:salida`,
        refType: "mp_reclasificacion", refId: params.refId, lote: params.lote, descripcion: params.descripcion, allowNegative: true, noAlias: true,
      });
      await this.applyMovement(actor, {
        codigo: to, kind: "RECLASIFICACION", quantity: moved, reason, idempotencyKey: `mp-reclasif:${params.refId}:entrada`,
        refType: "mp_reclasificacion", refId: params.refId, lote: params.lote, descripcion: params.descripcion, allowNegative: true, noAlias: true,
      });
    }
    // El código destino vuelve a estar vigente (si alguna vez se había reclasificado a otro), sin ciclos.
    await this.setAlias(to, null);
    if (params.mode === "all") await this.setAlias(from, to);
    return { moved };
  }

  /**
   * Edición de «Stock código»: lleva el saldo del código al valor pedido con UN movimiento de AJUSTE por la
   * diferencia (motivo obligatorio). Si el saldo cambió desde que el usuario lo vio → conflicto, no se pisa.
   */
  async adjustCodigoBalance(
    actor: MpStockActor,
    params: { codigo: string; target: number; expected: number | null; reason: string; refId: string }
  ): Promise<{ delta: number; balance: number }> {
    await assertFeatureWritesEnabled();
    const code = await this.resolveCodigo(params.codigo);
    if (!code) throw new Error("Código obligatorio.");
    if (!params.reason.trim()) throw new Error("Motivo obligatorio.");
    const current = await this.lockedBalance(code);
    if (params.expected != null && Math.abs(current - params.expected) > 0.0005) {
      throw new MpLedgerConflictError(`El saldo del código ${code} cambió (ahora ${current}). Recargá y reintentá.`);
    }
    const delta = Math.round((params.target - current) * 1000) / 1000;
    if (delta === 0) return { delta: 0, balance: current };
    const bal = await this.applyMovement(actor, {
      codigo: code, kind: "AJUSTE", quantity: delta, reason: `Saldo del código fijado en ${params.target}: ${params.reason.trim()}`,
      idempotencyKey: `mp-saldo-codigo:${params.refId}`, refType: "mp_saldo_codigo", refId: params.refId, allowNegative: true, noAlias: true,
    });
    return { delta, balance: bal.stockActual };
  }

  async getBalance(codigo: string): Promise<MpStockBalance | null> {
    const code = await this.resolveCodigo(codigo);
    if (!code) return null;
    if (isDatabaseConfigured()) {
      try {
        const db = currentTx() ?? getDb();
        const [row] = await db
          .select()
          .from(mpStockBalances)
          .where(eq(mpStockBalances.codigo, code))
          .limit(1);
        if (!row) return null;
        return {
          codigo: row.codigo,
          descripcion: row.descripcion,
          saldoInicial: row.saldoInicial,
          stockActual: row.stockActual,
          seededAt: row.saldoInicialSeededAt
            ? row.saldoInicialSeededAt.toISOString()
            : null,
        };
      } catch {
        /* mem */
      }
    }
    return mem().balances.get(code) ?? null;
  }

  async history(codigo: string): Promise<MpStockMovement[]> {
    const code = codigo.trim().toUpperCase();
    if (isDatabaseConfigured()) {
      try {
        const db = currentTx() ?? getDb();
        const rows = await db
          .select()
          .from(mpStockMovements)
          .where(eq(mpStockMovements.codigo, code))
          .orderBy(desc(mpStockMovements.createdAt));
        return rows.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          kind: r.kind as MpStockMovementKind,
          quantity: r.quantity,
          balanceAfter: r.balanceAfter,
          reason: r.reason,
          refType: r.refType,
          refId: r.refId,
          lote: r.lote,
          proveedor: r.proveedor,
          documento: r.documento,
          actorEmail: r.actorEmail,
          actorSector: r.actorSector,
          idempotencyKey: r.idempotencyKey,
          reversed: r.reversed,
          createdAt: r.createdAt.toISOString(),
        }));
      } catch {
        /* mem */
      }
    }
    return mem()
      .movements.filter((m) => m.codigo === code)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Una sola vez por código: registros actuales de Stock = saldo inicial. */
  async seedSaldoInicialOnce(
    actor: MpStockActor,
    codigo: string,
    cantidad: number,
    descripcion = ""
  ): Promise<MpStockBalance> {
    const code = codigo.trim().toUpperCase();
    if (!code) throw new Error("Código obligatorio.");
    const key = buildSeedKey(code);
    const existing = await this.findByIdempotency(key);
    if (existing) {
      const bal = await this.getBalance(code);
      if (bal) return bal;
    }
    return this.applyMovement(actor, {
      codigo: code,
      kind: "SALDO_INICIAL",
      quantity: cantidad,
      reason: "Saldo inicial (seed único desde Stock existente)",
      idempotencyKey: key,
      descripcion,
      refType: "seed",
      refId: code,
    });
  }

  async applyIngreso(
    actor: MpStockActor,
    params: {
      ingresoId: string;
      versionTag: string;
      codigo: string;
      quantity: number;
      previousQuantity?: number | null;
      lote?: string;
      proveedor?: string;
      documento?: string;
      descripcion?: string;
      anular?: boolean;
    }
  ): Promise<MpStockBalance | null> {
    const code = params.codigo.trim().toUpperCase();
    if (!code) {
      await notify({
        kind: "mp_sin_codigo",
        title: "Ingreso MP sin código",
        message: "Sin código — stock no actualizado",
        sectors: ["MATERIA_PRIMA"],
        idempotencyHint: `ingreso-sin-cod:${params.ingresoId}`,
      });
      return null;
    }
    if (params.anular) {
      const prevKey = buildIngresoKey(params.ingresoId, params.versionTag);
      const prev = await this.findByIdempotency(prevKey);
      if (!prev || prev.reversed) return this.getBalance(code);
      return this.applyMovement(actor, {
        codigo: code,
        kind: "REVERSO",
        quantity: -prev.quantity,
        reason: "Anulación/eliminación ingreso MP",
        idempotencyKey: `${prevKey}:reverso`,
        refType: "mp_ingreso",
        refId: params.ingresoId,
        reverseOfKey: prevKey,
      });
    }
    const prevQty = params.previousQuantity ?? 0;
    const delta = params.quantity - prevQty;
    if (delta === 0) {
      const bal = await this.getBalance(code);
      return bal;
    }
    const key = buildIngresoKey(params.ingresoId, params.versionTag);
    return this.applyMovement(actor, {
      codigo: code,
      kind: "INGRESO",
      quantity: delta,
      reason: "Ingreso MP",
      idempotencyKey: key,
      lote: params.lote,
      proveedor: params.proveedor,
      documento: params.documento,
      descripcion: params.descripcion,
      refType: "mp_ingreso",
      refId: params.ingresoId,
    });
  }

  /**
   * Consumo neto que una OE tiene registrado hoy en el libro mayor, por (código, lote): suma de TODOS sus movimientos
   * (consumos, correcciones y reversos, incluidos los de versiones anteriores de GENUS sin lote). Es la verdad del
   * saldo, no depende de marcas: así un segundo reverso o una re-entrega nunca descuentan ni devuelven de más.
   */
  async oeNetPositions(oeId: string): Promise<Map<string, { codigo: string; lote: string; net: number; lotId: string | null }>> {
    const out = new Map<string, { codigo: string; lote: string; net: number; lotId: string | null }>();
    const movs = (await this.listMovementsByRef("oe", oeId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const m of movs) {
      if (m.kind !== "CONSUMO_OE" && m.kind !== "REVERSO") continue;
      const lote = (m.lote ?? "").trim();
      // Código vigente: si el código se reclasificó (alias), lo consumido con el viejo cuenta en el nuevo.
      const codigo = await this.resolveCodigo(normalizeMpCodigo(m.codigo));
      const key = buildOePositionId(codigo, lote);
      const prev = out.get(key) ?? { codigo, lote, net: 0, lotId: null };
      prev.net = Math.round((prev.net + m.quantity) * 1000) / 1000;
      // Fila de Stock MP afectada (para devolver exactamente a la misma fila).
      const lotId = typeof m.payload?.lotId === "string" ? m.payload.lotId : null;
      if (lotId) prev.lotId = lotId;
      out.set(key, prev);
    }
    return out;
  }

  /**
   * Diferencias a aplicar para que la OE quede con exactamente `targets` consumidos (kg reales por código y lote).
   * Sin escribir: sirve para validar stock antes de entregar.
   */
  async planOeConsumptionDeltas(
    oeId: string,
    targets: Array<{ codigo: string; lote: string; kg: number; lotId?: string | null }>
  ): Promise<Array<{ codigo: string; lote: string; delta: number; net: number; lotId: string | null }>> {
    const wanted = new Map<string, { codigo: string; lote: string; qty: number; lotId: string | null }>();
    for (const t of targets) {
      const codigo = await this.resolveCodigo(normalizeMpCodigo(t.codigo));
      const key = buildOePositionId(codigo, t.lote);
      const prev = wanted.get(key);
      const qty = -Math.abs(t.kg);
      wanted.set(
        key,
        prev
          ? { ...prev, qty: Math.round((prev.qty + qty) * 1000) / 1000 }
          : { codigo, lote: t.lote.trim(), qty, lotId: t.lotId ?? null }
      );
    }
    const net = await this.oeNetPositions(oeId);
    const keys = new Set([...wanted.keys(), ...net.keys()]);
    const out: Array<{ codigo: string; lote: string; delta: number; net: number; lotId: string | null }> = [];
    for (const key of keys) {
      const w = wanted.get(key);
      const n = net.get(key);
      const target = w?.qty ?? 0;
      const current = n?.net ?? 0;
      const delta = Math.round((target - current) * 1000) / 1000;
      if (delta === 0) continue;
      out.push({ codigo: (w ?? n)!.codigo, lote: (w ?? n)!.lote, delta, net: current, lotId: n?.lotId ?? w?.lotId ?? null });
    }
    return out.sort((a, b) => (a.codigo + a.lote).localeCompare(b.codigo + b.lote));
  }

  /**
   * Consumo de una OE entregada: deja registrados exactamente los kg REALES por (código, lote).
   *  - primera entrega: un movimiento CONSUMO_OE por código y lote (las filas repetidas ya vienen sumadas);
   *  - re-entrega tras una devolución/corrección: solo la diferencia contra lo ya registrado;
   *  - reintento de la misma entrega (misma versión): no vuelve a descontar (clave idempotente).
   * Si hay una transacción ambiente (entrega de OE), todo se confirma o se descarta junto.
   */
  async applyOeConsumption(
    actor: MpStockActor,
    params: {
      oeId: string;
      oeVersion: number;
      oeStatus: string;
      lines: Array<{ codigo: string; lote: string; kg: number; lotId?: string | null }>;
      allowNegative?: boolean;
      orderNumber?: string;
    }
  ): Promise<Array<{ codigo: string; lote: string; delta: number; lotId: string | null }>> {
    if (params.oeStatus !== "COMPLETA" && params.oeStatus !== "COMPLETA_CON_PENDIENTES") return [];
    await assertFeatureWritesEnabled();
    const deltas = await this.planOeConsumptionDeltas(params.oeId, params.lines);
    const applied: Array<{ codigo: string; lote: string; delta: number; lotId: string | null }> = [];
    for (const d of deltas) {
      const key = buildOeConsumptionKey(params.oeId, params.oeVersion, d.codigo, d.lote);
      if (await this.findByIdempotency(key)) continue;
      await this.applyMovement(actor, {
        codigo: d.codigo,
        kind: "CONSUMO_OE",
        quantity: d.delta,
        reason:
          d.net === 0
            ? `Consumo ${params.orderNumber ?? "OE"} (kg real)${d.lote ? ` · lote ${d.lote}` : ""}`
            : `Corrección consumo ${params.orderNumber ?? "OE"} (diferencia)${d.lote ? ` · lote ${d.lote}` : ""}`,
        idempotencyKey: key,
        refType: "oe",
        refId: params.oeId,
        lote: d.lote || undefined,
        allowNegative: params.allowNegative,
        noAlias: true,
        payload: d.lotId ? { lotId: d.lotId } : undefined,
      });
      applied.push({ codigo: d.codigo, lote: d.lote, delta: d.delta, lotId: d.lotId });
    }
    return applied;
  }

  /**
   * Revierte TODO el consumo registrado de una OE (devolución para corrección o anulación): deja cada (código, lote)
   * en cero con un movimiento REVERSO por la diferencia. Idempotente por versión de la OE, y correcto en ciclos
   * entregar → anular → reabrir → entregar → anular (cada reverso devuelve lo que realmente estaba descontado).
   */
  async reverseOeConsumption(
    actor: MpStockActor,
    oeId: string,
    oeVersion: number,
    orderNumber?: string
  ): Promise<Array<{ codigo: string; lote: string; delta: number; lotId: string | null }>> {
    await assertFeatureWritesEnabled();
    const deltas = await this.planOeConsumptionDeltas(oeId, []);
    const applied: Array<{ codigo: string; lote: string; delta: number; lotId: string | null }> = [];
    for (const d of deltas) {
      const key = buildOeReverseKey(oeId, oeVersion, d.codigo, d.lote);
      if (await this.findByIdempotency(key)) continue;
      await this.applyMovement(actor, {
        codigo: d.codigo,
        kind: "REVERSO",
        quantity: d.delta,
        reason: `Reverso consumo ${orderNumber ?? "OE"} (kg reales)${d.lote ? ` · lote ${d.lote}` : ""}`,
        idempotencyKey: key,
        refType: "oe",
        refId: oeId,
        lote: d.lote || undefined,
        allowNegative: true,
        noAlias: true,
        payload: d.lotId ? { lotId: d.lotId } : undefined,
      });
      applied.push({ codigo: d.codigo, lote: d.lote, delta: d.delta, lotId: d.lotId });
    }
    return applied;
  }

  async registerAjuste(
    actor: MpStockActor,
    params: {
      codigo: string;
      quantity: number;
      reason: string;
      fecha?: string;
      allowNegative?: boolean;
    }
  ): Promise<MpStockBalance> {
    if (actor.sector !== "MATERIA_PRIMA") {
      throw new Error("Solo MP puede registrar ajustes.");
    }
    const code = params.codigo.trim().toUpperCase();
    if (!code) throw new Error("Código obligatorio.");
    if (!params.reason.trim()) throw new Error("Motivo obligatorio.");
    if (!Number.isFinite(params.quantity) || params.quantity === 0) {
      throw new Error("Cantidad inválida.");
    }
    const id = randomUUID();
    return this.applyMovement(actor, {
      codigo: code,
      kind: "AJUSTE",
      quantity: params.quantity,
      reason: params.reason.trim(),
      idempotencyKey: buildAjusteKey(id),
      refType: "ajuste",
      refId: id,
      allowNegative: params.allowNegative ?? true,
      documento: params.fecha,
    });
  }

  /**
   * Ajuste de kg de un LOTE de Stock MP (celda «Cantidad kg» con motivo, o «Ajustar stock»): el mismo delta queda en
   * el libro mayor del código, en la MISMA transacción que el lote (transacción ambiente). Antes el ajuste del lote
   * no llegaba al libro mayor y los dos stocks se separaban. Permisos: los valida el servicio de inventario.
   */
  async applyLotAdjustment(
    actor: MpStockActor,
    params: { codigo: string; quantity: number; reason: string; ajusteId: string; lote?: string; descripcion?: string }
  ): Promise<MpStockBalance | null> {
    const code = normalizeMpCodigo(params.codigo);
    if (!code || !Number.isFinite(params.quantity) || params.quantity === 0) return code ? this.getBalance(code) : null;
    return this.applyMovement(actor, {
      codigo: code,
      kind: "AJUSTE",
      quantity: Math.round(params.quantity * 1000) / 1000,
      reason: params.reason.trim() || "Ajuste de lote MP",
      idempotencyKey: `mp-lote-ajuste:${params.ajusteId}`,
      refType: "mp_stock_ajuste",
      refId: params.ajusteId,
      lote: params.lote,
      descripcion: params.descripcion,
      // Un conteo físico que deja el código en negativo se registra igual (visible, con aviso): nunca se oculta.
      allowNegative: true,
    });
  }

  private async listMovementsByRef(
    refType: string,
    refId: string
  ): Promise<MpStockMovement[]> {
    if (isDatabaseConfigured()) {
      try {
        const db = currentTx() ?? getDb();
        const rows = await db
          .select()
          .from(mpStockMovements)
          .where(
            and(
              eq(mpStockMovements.refType, refType),
              eq(mpStockMovements.refId, refId)
            )
          );
        return rows.map((r) => ({
          id: r.id,
          codigo: r.codigo,
          kind: r.kind as MpStockMovementKind,
          quantity: r.quantity,
          balanceAfter: r.balanceAfter,
          reason: r.reason,
          refType: r.refType,
          refId: r.refId,
          lote: r.lote,
          proveedor: r.proveedor,
          documento: r.documento,
          actorEmail: r.actorEmail,
          actorSector: r.actorSector,
          idempotencyKey: r.idempotencyKey,
          reversed: r.reversed,
          createdAt: r.createdAt.toISOString(),
          payload: (r.payload ?? {}) as Record<string, unknown>,
        }));
      } catch {
        /* mem */
      }
    }
    return mem().movements.filter(
      (m) => m.refType === refType && m.refId === refId
    );
  }

  private async findByIdempotency(
    key: string
  ): Promise<MpStockMovement | null> {
    if (isDatabaseConfigured()) {
      try {
        const db = currentTx() ?? getDb();
        const [row] = await db
          .select()
          .from(mpStockMovements)
          .where(eq(mpStockMovements.idempotencyKey, key))
          .limit(1);
        if (!row) return null;
        return {
          id: row.id,
          codigo: row.codigo,
          kind: row.kind as MpStockMovementKind,
          quantity: row.quantity,
          balanceAfter: row.balanceAfter,
          reason: row.reason,
          refType: row.refType,
          refId: row.refId,
          lote: row.lote,
          proveedor: row.proveedor,
          documento: row.documento,
          actorEmail: row.actorEmail,
          actorSector: row.actorSector,
          idempotencyKey: row.idempotencyKey,
          reversed: row.reversed,
          createdAt: row.createdAt.toISOString(),
        };
      } catch {
        /* mem */
      }
    }
    return mem().movements.find((m) => m.idempotencyKey === key) ?? null;
  }

  private async applyMovement(
    actor: MpStockActor,
    input: {
      codigo: string;
      kind: MpStockMovementKind;
      quantity: number;
      reason: string;
      idempotencyKey: string;
      descripcion?: string;
      refType?: string;
      refId?: string;
      lote?: string;
      proveedor?: string;
      documento?: string;
      allowNegative?: boolean;
      reverseOfKey?: string;
      /** Usar el código tal cual (reclasificación); por defecto un código reclasificado se resuelve al vigente. */
      noAlias?: boolean;
      payload?: Record<string, unknown>;
    }
  ): Promise<MpStockBalance> {
    await assertFeatureWritesEnabled();
    if (!input.noAlias) {
      const resolved = await this.resolveCodigo(input.codigo);
      if (resolved && resolved !== input.codigo) input = { ...input, codigo: resolved };
    }
    if (isDatabaseConfigured()) {
      try {
        return await this.applyMovementDb(actor, input);
      } catch (err) {
        // Solo "tabla/columna inexistente" es esquema pendiente; el resto (stock insuficiente, conflicto, red) se
        // informa tal cual. Antes TODO error se convertía en "esquema pendiente" y ocultaba la causa real.
        if (isMissingSchemaError(err) && isFeatureMemoryAllowed()) {
          /* tests sin 0005: cae a memoria */
        } else if (isMissingSchemaError(err)) {
          throw new SchemaPendingError();
        } else {
          throw err;
        }
      }
    }
    if (!isFeatureMemoryAllowed()) {
      throw new SchemaPendingError();
    }
    return this.applyMovementMemory(actor, input);
  }

  /**
   * Movimiento en Postgres, ATÓMICO y serializado por código:
   *  - candado transaccional por código (pg_advisory_xact_lock) + saldo leído con FOR UPDATE: dos movimientos del
   *    mismo código nunca leen el mismo saldo (antes se leía y reescribía el saldo absoluto sin transacción y uno de
   *    los dos se perdía);
   *  - idempotencia verificada DENTRO del candado;
   *  - si hay una transacción ambiente (operación de MP que también escribe el lote y la auditoría), se usa esa: o se
   *    confirma todo o nada.
   */
  private async applyMovementDb(actor: MpStockActor, input: Parameters<MpStockLedgerService["applyMovement"]>[1]): Promise<MpStockBalance> {
    const code = input.codigo;
    let negative: { balance: number; confirmed: boolean } | null = null;
    const run = async (tx: NonNullable<ReturnType<typeof currentTx>>): Promise<MpStockBalance> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`genus-mp-stock:${code}`}))`);
      const [balRow] = await tx.select().from(mpStockBalances).where(eq(mpStockBalances.codigo, code)).for("update");
      const current: MpStockBalance = balRow
        ? {
            codigo: balRow.codigo,
            descripcion: balRow.descripcion,
            saldoInicial: balRow.saldoInicial,
            stockActual: balRow.stockActual,
            seededAt: balRow.saldoInicialSeededAt ? balRow.saldoInicialSeededAt.toISOString() : null,
          }
        : {
            codigo: code,
            descripcion: input.descripcion ?? "",
            saldoInicial: 0,
            stockActual: 0,
            seededAt: null,
          };
      const [dup] = await tx
        .select({ reversed: mpStockMovements.reversed })
        .from(mpStockMovements)
        .where(eq(mpStockMovements.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (dup && !dup.reversed) return current;

      const nextStock = Math.round((current.stockActual + input.quantity) * 1000) / 1000;
      if (nextStock < 0) {
        negative = { balance: nextStock, confirmed: Boolean(input.allowNegative) };
        if (!input.allowNegative) {
          throw new MpStockInsufficientError(code, nextStock);
        }
      }
      const now = new Date();
      const next: MpStockBalance = {
        ...current,
        descripcion: input.descripcion || current.descripcion,
        saldoInicial: input.kind === "SALDO_INICIAL" ? input.quantity : current.saldoInicial,
        stockActual: nextStock,
        seededAt: input.kind === "SALDO_INICIAL" ? now.toISOString() : current.seededAt,
      };
      await tx
        .insert(mpStockBalances)
        .values({
          codigo: next.codigo,
          descripcion: next.descripcion,
          saldoInicial: next.saldoInicial,
          saldoInicialSeededAt: next.seededAt ? new Date(next.seededAt) : null,
          stockActual: next.stockActual,
          updatedAt: now,
          payload: {},
        })
        .onConflictDoUpdate({
          target: mpStockBalances.codigo,
          set: {
            descripcion: next.descripcion,
            stockActual: next.stockActual,
            saldoInicial: next.saldoInicial,
            saldoInicialSeededAt: next.seededAt ? new Date(next.seededAt) : null,
            updatedAt: now,
          },
        });
      await tx.insert(mpStockMovements).values({
        id: randomUUID(),
        codigo: code,
        kind: input.kind,
        quantity: input.quantity,
        balanceAfter: nextStock,
        reason: input.reason,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        lote: input.lote ?? null,
        proveedor: input.proveedor ?? null,
        documento: input.documento ?? null,
        actorEmail: actor.email,
        actorSector: actor.sector,
        idempotencyKey: input.idempotencyKey,
        reversed: false,
        payload: input.payload ?? {},
      });
      if (input.reverseOfKey) {
        await tx.update(mpStockMovements).set({ reversed: true }).where(eq(mpStockMovements.idempotencyKey, input.reverseOfKey));
      }
      return next;
    };
    const ambient = currentTx();
    try {
      return ambient ? await run(ambient) : await getDb().transaction((tx) => run(tx));
    } finally {
      const neg = negative as { balance: number; confirmed: boolean } | null;
      if (neg) {
        await notify({
          kind: neg.confirmed ? "mp_stock_negativo_confirmado" : "mp_stock_negativo",
          title: neg.confirmed ? "Stock negativo registrado" : "Stock insuficiente",
          message: neg.confirmed
            ? `Código ${code}: saldo ${neg.balance} (confirmado).`
            : `Código ${code}: el movimiento dejaría stock negativo.`,
          sectors: ["MATERIA_PRIMA", "PRODUCCION"],
          idempotencyHint: `${neg.confirmed ? "neg-ok" : "neg"}:${input.idempotencyKey}`,
        });
      }
    }
  }

  /** Modo memoria (tests / sin base): mismo cálculo, sin persistencia. */
  private async applyMovementMemory(actor: MpStockActor, input: Parameters<MpStockLedgerService["applyMovement"]>[1]): Promise<MpStockBalance> {
    const existing = mem().movements.find((m) => m.idempotencyKey === input.idempotencyKey);
    const bal: MpStockBalance = mem().balances.get(input.codigo) ?? {
      codigo: input.codigo,
      descripcion: input.descripcion ?? "",
      saldoInicial: 0,
      stockActual: 0,
      seededAt: null,
    };
    if (existing && !existing.reversed) return bal;
    const nextStock = Math.round((bal.stockActual + input.quantity) * 1000) / 1000;
    if (nextStock < 0 && !input.allowNegative) {
      await notify({
        kind: "mp_stock_negativo",
        title: "Stock insuficiente",
        message: `Código ${input.codigo}: el movimiento dejaría stock negativo.`,
        sectors: ["MATERIA_PRIMA", "PRODUCCION"],
        idempotencyHint: `neg:${input.idempotencyKey}`,
      });
      throw new MpStockInsufficientError(input.codigo, nextStock);
    }
    if (nextStock < 0) {
      await notify({
        kind: "mp_stock_negativo_confirmado",
        title: "Stock negativo registrado",
        message: `Código ${input.codigo}: saldo ${nextStock} (confirmado).`,
        sectors: ["MATERIA_PRIMA", "PRODUCCION"],
        idempotencyHint: `neg-ok:${input.idempotencyKey}`,
      });
    }
    const movement: MpStockMovement = {
      id: randomUUID(),
      codigo: input.codigo,
      kind: input.kind,
      quantity: input.quantity,
      balanceAfter: nextStock,
      reason: input.reason,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      lote: input.lote ?? null,
      proveedor: input.proveedor ?? null,
      documento: input.documento ?? null,
      actorEmail: actor.email,
      actorSector: actor.sector,
      idempotencyKey: input.idempotencyKey,
      reversed: false,
      createdAt: new Date().toISOString(),
      payload: input.payload ?? {},
    };
    const nextBal: MpStockBalance = {
      ...bal,
      descripcion: input.descripcion || bal.descripcion,
      saldoInicial: input.kind === "SALDO_INICIAL" ? input.quantity : bal.saldoInicial,
      stockActual: nextStock,
      seededAt: input.kind === "SALDO_INICIAL" ? movement.createdAt : bal.seededAt,
    };
    mem().balances.set(nextBal.codigo, nextBal);
    mem().movements.push(movement);
    if (input.reverseOfKey) {
      const orig = mem().movements.find((m) => m.idempotencyKey === input.reverseOfKey);
      if (orig) orig.reversed = true;
    }
    return nextBal;
  }
}

/** El movimiento dejaría el stock negativo y no se confirmó registrarlo así. */
export class MpStockInsufficientError extends Error {
  readonly code = "MP_STOCK_INSUFFICIENT" as const;
  constructor(
    readonly codigo: string,
    readonly balanceAfter: number
  ) {
    super("Stock insuficiente — confirmá allowNegative para registrar negativo con auditoría.");
    this.name = "MpStockInsufficientError";
  }
}

let singleton: MpStockLedgerService | null = null;
export function getMpStockLedger(): MpStockLedgerService {
  if (!singleton) singleton = new MpStockLedgerService();
  return singleton;
}

export function resetMpStockMemoryForTests(): void {
  g.__genusMpStockMem = {
    balances: new Map(),
    movements: [],
    seededKeys: new Set(),
    aliases: new Map(),
  };
  singleton = null;
}
