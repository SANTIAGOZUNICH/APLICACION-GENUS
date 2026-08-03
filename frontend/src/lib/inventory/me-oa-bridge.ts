/**
 * Puente OA → Inventario ME.
 * STOCK = INGRESOS − salidas con origen OA (no salidas manuales).
 */

import { randomUUID } from "node:crypto";
import type { OrdersActor } from "@/lib/orders/types";
import type { OaContent, OaMaterialRow, OperationalOrderRecord } from "@/lib/orders/types";
import { parseOptionalNumber } from "@/lib/inventory/calcs";
import type { InventoryService, InventoryActor } from "@/lib/inventory/inventory-service";
import {
  InventoryValidationError,
} from "@/lib/inventory/inventory-service";
import type { MeSalidaRow } from "@/lib/inventory/types";

export type OaMeShortage = {
  codigo: string;
  material: string;
  materialId: string | null;
  stockDisponible: number;
  cantidadSolicitada: number;
  diferencia: number;
};

export type OaMeConsumptionLine = {
  materialLineId: string;
  codigo: string;
  material: string;
  cliente: string;
  cantidadUtilizada: number;
  cantidadDesechada: number;
  unidad: string;
  materialId: string | null;
};

function toInvActor(actor: OrdersActor): InventoryActor {
  return { email: actor.email, sector: actor.sector, displayName: actor.displayName };
}

function parseQty(raw: string): number {
  const n = parseOptionalNumber(raw);
  return n == null ? 0 : n;
}

export function extractOaMeConsumption(content: OaContent): OaMeConsumptionLine[] {
  const client = content.header.client ?? "";
  return content.materials
    .map((m: OaMaterialRow) => ({
      materialLineId: m.id,
      codigo: (m.codigo ?? "").trim(),
      material: (m.nombreInsumo ?? "").trim(),
      cliente: (m.cliente ?? client).trim(),
      cantidadUtilizada: parseQty(m.usados),
      cantidadDesechada: parseQty(m.desechados),
      unidad: (m.unidad ?? "u").trim() || "u",
      materialId: m.materialId ?? null,
    }))
    .filter((l) => l.codigo && l.cantidadUtilizada > 0);
}

export function buildOaMeIdempotencyKey(
  oaId: string,
  oaVersion: number,
  materialLineId: string
): string {
  return `${oaId}:${oaVersion}:${materialLineId}`;
}

/** Vista previa de faltantes antes de entregar. */
export function previewOaMeShortages(
  service: InventoryService,
  actor: OrdersActor,
  order: OperationalOrderRecord
): OaMeShortage[] {
  if (order.type !== "OA" || order.formData.kind !== "OA") return [];
  const lines = extractOaMeConsumption(order.formData);
  const invActor = toInvActor(actor);
  const shortages: OaMeShortage[] = [];

  for (const line of lines) {
    const mat =
      (line.materialId ? service.getMeMaterialById(invActor, line.materialId) : null) ??
      service.getMeMaterialByCodigo(invActor, line.codigo);
    const stock = mat?.stockActual ?? 0;
    if (stock < line.cantidadUtilizada) {
      shortages.push({
        codigo: line.codigo,
        material: line.material || mat?.descripcion || line.codigo,
        materialId: mat?.id ?? null,
        stockDisponible: stock,
        cantidadSolicitada: line.cantidadUtilizada,
        diferencia: line.cantidadUtilizada - stock,
      });
    }
  }
  return shortages;
}

/**
 * Aplica salidas ME por entrega OA (idempotente por oaId+version+lineId).
 * Si ya existía salida de versión anterior para la misma línea, aplica delta.
 */
export function applyOaDeliveryToMe(
  service: InventoryService,
  actor: OrdersActor,
  order: OperationalOrderRecord,
  opts?: {
    allowNegativeStock?: boolean;
    negativeReason?: string;
    includeDesechados?: boolean;
  }
): MeSalidaRow[] {
  if (order.type !== "OA" || order.formData.kind !== "OA") return [];
  const lines = extractOaMeConsumption(order.formData);
  const invActor = toInvActor(actor);
  const created: MeSalidaRow[] = [];

  for (const line of lines) {
    let qty = line.cantidadUtilizada;
    if (opts?.includeDesechados) qty += line.cantidadDesechada;
    if (qty <= 0) continue;

    const key = buildOaMeIdempotencyKey(order.id, order.version, line.materialLineId);
    const existingSameKey = service.findMeSalidaByIdempotencyKey(key);
    if (existingSameKey && !existingSameKey.reverted) {
      // Misma versión ya aplicada — no duplicar
      continue;
    }

    const priorActive = service.findActiveMeSalidaForOaLine(order.id, line.materialLineId);
    let delta = qty;
    if (priorActive && !priorActive.reverted) {
      delta = qty - (priorActive.total ?? priorActive.cantidad ?? 0);
      // Marcar anterior como revertida lógicamente (ajuste)
      service.markMeSalidaReplaced(invActor, priorActive.id, "Corrección OA — reemplazo por nueva versión");
    }

    if (delta === 0 && priorActive) {
      // Solo re-etiquetar con nueva key
      const updated = service.upsertMeSalida(
        invActor,
        {
          ...priorActive,
          id: priorActive.id,
          origen: "OA",
          oaId: order.id,
          oaNumber: order.orderNumber,
          oaVersion: order.version,
          materialLineId: line.materialLineId,
          idempotencyKey: key,
          codigo: line.codigo,
          unidad: line.unidad,
          cantidad: qty,
          bultos: 1,
          total: qty,
          descripcion: line.material,
          cliente: line.cliente,
          materialId: line.materialId ?? priorActive.materialId,
          comentarios: `Salida automática OA ${order.orderNumber}`,
          control: true,
          entregado: true,
          reverted: false,
        },
        { allowNegativeStock: true, negativeReason: "re-link" }
      );
      // No stock change for delta 0 — upsertMeSalida MANUAL path won't deduct OA wrongly
      created.push(updated);
      continue;
    }

    const mat = service.resolveMeMaterialByCodigo(invActor, {
      codigo: line.codigo,
      descripcion: line.material,
      cliente: line.cliente,
      materialId: line.materialId,
    });

    if (delta !== 0) {
      service.applyOaStockDelta(invActor, mat.id, -delta, {
        allowNegative: opts?.allowNegativeStock,
        reason: opts?.negativeReason,
      });
    }

    const row = service.createOaMeSalida(invActor, {
      codigo: line.codigo,
      descripcion: line.material,
      cliente: line.cliente,
      unidad: line.unidad,
      cantidad: qty,
      materialId: mat.id,
      oaId: order.id,
      oaNumber: order.orderNumber,
      oaVersion: order.version,
      materialLineId: line.materialLineId,
      idempotencyKey: key,
    });
    created.push(row);
    service.syncMeAlertsPublic(invActor, mat.id);
  }

  return created;
}

/** Revierte todas las salidas OA activas de una orden (anulación / devolución). */
export function reverseOaMeSalidas(
  service: InventoryService,
  actor: OrdersActor,
  orderId: string,
  reason: string
): number {
  if (!reason.trim()) {
    throw new InventoryValidationError("Motivo obligatorio para revertir salidas OA.");
  }
  const invActor = toInvActor(actor);
  const salidas = service.listMeSalidasByOaId(orderId).filter((s) => !s.reverted && s.origen === "OA");
  for (const s of salidas) {
    const qty = s.total ?? s.cantidad ?? 0;
    if (s.materialId && qty) {
      service.applyOaStockDelta(invActor, s.materialId, qty, { allowNegative: true, reason });
      service.syncMeAlertsPublic(invActor, s.materialId);
    }
    service.markMeSalidaReverted(invActor, s.id, reason);
  }
  return salidas.length;
}

export function assertNoSilentNegative(
  shortages: OaMeShortage[],
  opts?: { allowNegativeStock?: boolean; negativeReason?: string }
): void {
  if (shortages.length === 0) return;
  if (!opts?.allowNegativeStock) {
    const detail = shortages
      .map(
        (s) =>
          `${s.codigo} ${s.material}: stock ${s.stockDisponible}, solicitado ${s.cantidadSolicitada}, falta ${s.diferencia}`
      )
      .join("; ");
    throw new InventoryValidationError(
      `Stock ME insuficiente para entregar la OA. ${detail}`,
      shortages
    );
  }
  if (!opts.negativeReason?.trim()) {
    throw new InventoryValidationError(
      "Motivo obligatorio para entregar OA con stock ME insuficiente.",
      shortages
    );
  }
}

void randomUUID;
