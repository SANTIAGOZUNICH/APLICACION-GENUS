/** Ledger stock MP por código — puro + servicio con memoria/Neon. */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import {
  assertFeatureWritesEnabled,
  isFeatureMemoryAllowed,
  isFeatureSchemaReady,
  SchemaPendingError,
} from "@/lib/db/feature-schema";
import { mpStockBalances, mpStockMovements, osNotifications } from "@/lib/db/schema";
import type { SectorId } from "@/types/operational/sector";

export type MpStockMovementKind =
  | "SALDO_INICIAL"
  | "INGRESO"
  | "CONSUMO_OE"
  | "AJUSTE"
  | "REVERSO";

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
};

type Mem = {
  balances: Map<string, MpStockBalance>;
  movements: MpStockMovement[];
  seededKeys: Set<string>;
};

const g = globalThis as unknown as { __genusMpStockMem?: Mem };
function mem(): Mem {
  if (!g.__genusMpStockMem) {
    g.__genusMpStockMem = {
      balances: new Map(),
      movements: [],
      seededKeys: new Set(),
    };
  }
  return g.__genusMpStockMem;
}

export function buildOeConsumptionKey(
  oeId: string,
  oeVersion: number,
  codigo: string
): string {
  return `${buildOeConsumptionPositionKey(oeId, codigo)}:v${oeVersion}`;
}

/** Clave estable por OE+código (consolidado; sin línea). */
export function buildOeConsumptionPositionKey(
  oeId: string,
  codigo: string
): string {
  return `oe-consumo:${oeId}:cod:${codigo.trim().toUpperCase()}`;
}

/** @deprecated mantener compat tests antiguos — preferir clave sin lineId */
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
      });
      return;
    } catch {
      /* ignore */
    }
  }
  void params.idempotencyHint;
}

export class MpStockLedgerService {
  async getBalance(codigo: string): Promise<MpStockBalance | null> {
    const code = codigo.trim().toUpperCase();
    if (!code) return null;
    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
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
        const db = getDb();
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
   * Consumo OE: solo COMPLETA / COMPLETA_CON_PENDIENTES.
   * kgReal = kgAPesar + ajuste.
   * Idempotente: misma OE+línea+código no descuenta dos veces;
   * re-entrega/corrección aplica únicamente el delta.
   */
  async applyOeConsumption(
    actor: MpStockActor,
    params: {
      oeId: string;
      oeVersion: number;
      oeStatus: string;
      lines: Array<{
        lineId: string;
        codigo: string;
        kgReal: number;
      }>;
      allowNegative?: boolean;
    }
  ): Promise<{ applied: number; skippedNoCode: number; warnings: string[] }> {
    if (
      params.oeStatus !== "COMPLETA" &&
      params.oeStatus !== "COMPLETA_CON_PENDIENTES"
    ) {
      return { applied: 0, skippedNoCode: 0, warnings: [] };
    }
    await assertFeatureWritesEnabled();
    let applied = 0;
    let skippedNoCode = 0;
    const warnings: string[] = [];

    // Consolidar por código (suma kg reales de líneas repetidas).
    const byCode = new Map<string, { kgReal: number; lineIds: string[] }>();
    for (const line of params.lines) {
      const code = normalizeMpCodigo(line.codigo);
      if (!code) {
        skippedNoCode += 1;
        warnings.push("Sin código — stock no actualizado");
        await notify({
          kind: "oe_mp_sin_codigo",
          title: "OE con MP sin código",
          message: `OE ${params.oeId}: línea sin código — stock no actualizado`,
          sectors: ["MATERIA_PRIMA"],
          href: "/ordenes-elaboracion",
          idempotencyHint: `oe-sin-cod:${params.oeId}:${line.lineId}`,
        });
        continue;
      }
      const prev = byCode.get(code);
      if (prev) {
        prev.kgReal += Math.abs(line.kgReal);
        prev.lineIds.push(line.lineId);
      } else {
        byCode.set(code, {
          kgReal: Math.abs(line.kgReal),
          lineIds: [line.lineId],
        });
      }
    }

    for (const [code, agg] of byCode) {
      const positionKey = buildOeConsumptionPositionKey(params.oeId, code);
      const related = await this.listMovementsByPositionPrefix(positionKey);
      const netQty = related
        .filter((m) => !m.reversed)
        .reduce((s, m) => s + m.quantity, 0);
      const targetQty = -agg.kgReal;
      const delta = Math.round((targetQty - netQty) * 1000) / 1000;
      if (delta === 0) continue;

      const applyKey = buildOeConsumptionKey(params.oeId, params.oeVersion, code);
      const already = await this.findByIdempotency(applyKey);
      if (already && !already.reversed) continue;

      await this.applyMovement(actor, {
        codigo: code,
        kind: "CONSUMO_OE",
        quantity: delta,
        reason:
          netQty === 0
            ? `Consumo OE consolidado (kg real)${agg.lineIds.length > 1 ? ` · ${agg.lineIds.length} líneas` : ""}`
            : "Corrección consumo OE (delta)",
        idempotencyKey: applyKey,
        refType: "oe",
        refId: params.oeId,
        allowNegative: params.allowNegative,
      });
      applied += 1;
    }
    return { applied, skippedNoCode, warnings };
  }

  async reverseOeConsumption(
    actor: MpStockActor,
    oeId: string,
    _oeVersion?: number
  ): Promise<number> {
    await assertFeatureWritesEnabled();
    const all = await this.listMovementsByRef("oe", oeId);
    let n = 0;
    for (const m of all) {
      if (!m.idempotencyKey.startsWith(`oe-consumo:${oeId}:`) || m.reversed) {
        continue;
      }
      await this.applyMovement(actor, {
        codigo: m.codigo,
        kind: "REVERSO",
        quantity: -m.quantity,
        reason: "Reverso consumo OE (anular/reabrir)",
        idempotencyKey: `${m.idempotencyKey}:reverso`,
        refType: "oe",
        refId: oeId,
        reverseOfKey: m.idempotencyKey,
      });
      n += 1;
    }
    return n;
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

  private async listMovementsByPositionPrefix(
    positionKey: string
  ): Promise<MpStockMovement[]> {
    if (isDatabaseConfigured() && (await isFeatureSchemaReady())) {
      try {
        const db = getDb();
        const rows = await db.select().from(mpStockMovements);
        return rows
          .filter((r) => r.idempotencyKey.startsWith(positionKey))
          .map((r) => ({
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
        /* fallthrough */
      }
    }
    if (!isFeatureMemoryAllowed()) return [];
    return mem().movements.filter((m) => m.idempotencyKey.startsWith(positionKey));
  }

  private async listMovementsByRef(
    refType: string,
    refId: string
  ): Promise<MpStockMovement[]> {
    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
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
        const db = getDb();
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
    }
  ): Promise<MpStockBalance> {
    await assertFeatureWritesEnabled();
    const existing = await this.findByIdempotency(input.idempotencyKey);
    if (existing && !existing.reversed) {
      const bal = await this.getBalance(input.codigo);
      if (bal) return bal;
    }

    let bal = await this.getBalance(input.codigo);
    if (!bal) {
      bal = {
        codigo: input.codigo,
        descripcion: input.descripcion ?? "",
        saldoInicial: input.kind === "SALDO_INICIAL" ? input.quantity : 0,
        stockActual: 0,
        seededAt:
          input.kind === "SALDO_INICIAL" ? new Date().toISOString() : null,
      };
    }

    const nextStock = Math.round((bal.stockActual + input.quantity) * 1000) / 1000;
    if (nextStock < 0 && !input.allowNegative) {
      await notify({
        kind: "mp_stock_negativo",
        title: "Stock insuficiente",
        message: `Código ${input.codigo}: el movimiento dejaría stock negativo.`,
        sectors: ["MATERIA_PRIMA", "PRODUCCION"],
        idempotencyHint: `neg:${input.idempotencyKey}`,
      });
      throw new Error(
        "Stock insuficiente — confirmá allowNegative para registrar negativo con auditoría."
      );
    }
    if (nextStock < 0 && input.allowNegative) {
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
    };

    const nextBal: MpStockBalance = {
      ...bal,
      descripcion: input.descripcion || bal.descripcion,
      saldoInicial:
        input.kind === "SALDO_INICIAL" ? input.quantity : bal.saldoInicial,
      stockActual: nextStock,
      seededAt:
        input.kind === "SALDO_INICIAL"
          ? movement.createdAt
          : bal.seededAt,
    };

    if (isDatabaseConfigured()) {
      try {
        const db = getDb();
        await db
          .insert(mpStockBalances)
          .values({
            codigo: nextBal.codigo,
            descripcion: nextBal.descripcion,
            saldoInicial: nextBal.saldoInicial,
            saldoInicialSeededAt: nextBal.seededAt
              ? new Date(nextBal.seededAt)
              : null,
            stockActual: nextBal.stockActual,
            updatedAt: new Date(),
            payload: {},
          })
          .onConflictDoUpdate({
            target: mpStockBalances.codigo,
            set: {
              descripcion: nextBal.descripcion,
              stockActual: nextBal.stockActual,
              saldoInicial: nextBal.saldoInicial,
              saldoInicialSeededAt: nextBal.seededAt
                ? new Date(nextBal.seededAt)
                : null,
              updatedAt: new Date(),
            },
          });
        await db.insert(mpStockMovements).values({
          id: movement.id,
          codigo: movement.codigo,
          kind: movement.kind,
          quantity: movement.quantity,
          balanceAfter: movement.balanceAfter,
          reason: movement.reason,
          refType: movement.refType,
          refId: movement.refId,
          lote: movement.lote,
          proveedor: movement.proveedor,
          documento: movement.documento,
          actorEmail: movement.actorEmail,
          actorSector: movement.actorSector,
          idempotencyKey: movement.idempotencyKey,
          reversed: false,
          payload: {},
        });
        if (input.reverseOfKey) {
          await db
            .update(mpStockMovements)
            .set({ reversed: true })
            .where(eq(mpStockMovements.idempotencyKey, input.reverseOfKey));
        }
        return nextBal;
      } catch {
        if (!isFeatureMemoryAllowed()) {
          throw new SchemaPendingError();
        }
      }
    }

    if (!isFeatureMemoryAllowed()) {
      throw new SchemaPendingError();
    }

    mem().balances.set(nextBal.codigo, nextBal);
    mem().movements.push(movement);
    if (input.reverseOfKey) {
      const orig = mem().movements.find(
        (m) => m.idempotencyKey === input.reverseOfKey
      );
      if (orig) orig.reversed = true;
    }
    return nextBal;
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
  };
  singleton = null;
}
