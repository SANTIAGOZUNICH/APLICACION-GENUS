/**
 * DIFERENCIA ME contra el pedido — lado servidor (Postgres). SOLO LECTURA sobre el libro de stock: usa el mismo
 * `computeMeStock` que STOCK ME (loadLedgerInputs/stockOf) y nunca escribe movimientos ni cantidades de pedidos.
 * Lo único que escribe es el vínculo material ↔ pedido (+ consumo por producto), con auditoría.
 *
 * Los pedidos solo los lee Producción: acá el servidor devuelve a Depósito únicamente lo calculado y, para vincular,
 * los pedidos ACTIVOS del mismo cliente del material (producto y unidades).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invAudit, meMaterialPedidoLinks, productionPedidos } from "@/lib/db/schema";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError, type InventoryActor } from "./inventory-service";
import { computeMeDiferencia, type MeDiferenciaLink, type MeDiferenciaRow } from "./me-diferencia";
import { auditRow, loadLedgerInputs, lockCodigos, stockOf } from "./me-planilla-db";
import { canReadInventory, canWriteInventory } from "./rbac";

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
/** Pedido activo = no eliminado, no entregado (cancelados se eliminan lógicamente). */
const activo = and(isNull(productionPedidos.deletedAt), sql`coalesce(${productionPedidos.estado}, '') <> 'ENTREGADO'`);

function assertRead(actor: InventoryActor) {
  if (!actor.isSuperadmin && !canReadInventory(actor.sector, "me_stock")) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede ver me_stock.`);
}
function assertWrite(actor: InventoryActor) {
  if (!actor.isSuperadmin && !canWriteInventory(actor.sector, "me_stock")) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede modificar me_stock.`);
}

/** DIFERENCIA de todos los materiales ME con al menos un pedido vinculado (el resto es «SIN DATOS» en la UI). */
export async function listMeDiferenciasDb(actor: InventoryActor): Promise<Record<string, MeDiferenciaRow>> {
  assertRead(actor);
  const db = getDb();
  const [data, links] = await Promise.all([
    loadLedgerInputs(db),
    db
      .select({ materialId: meMaterialPedidoLinks.materialId, pedidoId: meMaterialPedidoLinks.pedidoId, ratio: meMaterialPedidoLinks.unitsPerProduct, producto: productionPedidos.producto, q: productionPedidos.q })
      .from(meMaterialPedidoLinks)
      .innerJoin(productionPedidos, eq(productionPedidos.id, meMaterialPedidoLinks.pedidoId))
      .where(activo),
  ]);
  const byMaterial = new Map<string, typeof links>();
  for (const l of links) byMaterial.set(l.materialId, [...(byMaterial.get(l.materialId) ?? []), l]);
  const out: Record<string, MeDiferenciaRow> = {};
  for (const m of data.materials) {
    const ls = byMaterial.get(m.id) ?? [];
    const { stock } = stockOf(m.codigo, data);
    const calc: MeDiferenciaLink[] = ls.map((l) => ({ pedidoId: l.pedidoId, pedidoUnidades: l.q, unidadesPorProducto: l.ratio }));
    out[m.id] = {
      ...computeMeDiferencia(stock, calc),
      materialId: m.id,
      pedidos: ls.map((l) => ({ pedidoId: l.pedidoId, producto: l.producto ?? "", unidades: l.q, unidadesPorProducto: l.ratio })),
    };
  }
  return out;
}

/** Pedidos activos del MISMO cliente del material (coincidencia exacta normalizada; nunca por parecido). */
export async function candidatePedidosDb(actor: InventoryActor, materialId: string): Promise<Array<{ pedidoId: string; cliente: string; producto: string; unidades: number | null; estado: string }>> {
  assertWrite(actor);
  const { materials } = await loadLedgerInputs(getDb());
  const mat = materials.find((m) => m.id === materialId);
  if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
  const cliente = norm(mat.cliente);
  if (!cliente) return [];
  const rows = await getDb().select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto, q: productionPedidos.q, estado: productionPedidos.estado }).from(productionPedidos).where(activo).limit(2000);
  return rows.filter((r) => norm(r.cliente) === cliente).map((r) => ({ pedidoId: r.id, cliente: r.cliente ?? "", producto: r.producto ?? "", unidades: r.q, estado: r.estado ?? "" }));
}

export interface MeLinkInput {
  materialId: string;
  pedidoId: string;
  /** null = consumo sin configurar. */
  unidadesPorProducto: number | null;
}

/** Crea o actualiza el vínculo (idempotente por material+pedido). No toca stock ni pedidos. */
export async function upsertMePedidoLinkDb(actor: InventoryActor, input: MeLinkInput): Promise<void> {
  assertWrite(actor);
  const ratio = input.unidadesPorProducto;
  if (ratio != null && !(Number.isFinite(ratio) && ratio > 0)) throw new InventoryValidationError("El consumo por producto debe ser mayor que 0.");
  await getDb().transaction(async (tx) => {
    const { materials } = await loadLedgerInputs(tx);
    const mat = materials.find((m) => m.id === input.materialId);
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    await lockCodigos(tx, [mat.codigo]);
    const [ped] = await tx.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto }).from(productionPedidos).where(and(eq(productionPedidos.id, input.pedidoId), activo));
    if (!ped) throw new InventoryNotFoundError("Pedido activo no encontrado.");
    if (norm(ped.cliente) !== norm(mat.cliente)) throw new InventoryValidationError("El pedido es de otro cliente: no se mezclan materiales de clientes distintos.");
    const [prev] = await tx.select().from(meMaterialPedidoLinks).where(and(eq(meMaterialPedidoLinks.materialId, input.materialId), eq(meMaterialPedidoLinks.pedidoId, input.pedidoId)));
    await tx
      .insert(meMaterialPedidoLinks)
      .values({ materialId: input.materialId, pedidoId: input.pedidoId, unitsPerProduct: ratio, createdBy: actor.email, updatedBy: actor.email })
      .onConflictDoUpdate({ target: [meMaterialPedidoLinks.materialId, meMaterialPedidoLinks.pedidoId], set: { unitsPerProduct: ratio, updatedBy: actor.email, updatedAt: new Date() } });
    const a = auditRow(actor, "me_stock", input.materialId, prev ? "pedido_link_update" : "pedido_link_create", prev ? { pedidoId: input.pedidoId, unidadesPorProducto: prev.unitsPerProduct } : null, { pedidoId: input.pedidoId, producto: ped.producto, unidadesPorProducto: ratio }, "Vínculo material ↔ pedido para DIFERENCIA");
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
  });
}

export async function removeMePedidoLinkDb(actor: InventoryActor, materialId: string, pedidoId: string): Promise<void> {
  assertWrite(actor);
  await getDb().transaction(async (tx) => {
    const [prev] = await tx.select().from(meMaterialPedidoLinks).where(and(eq(meMaterialPedidoLinks.materialId, materialId), eq(meMaterialPedidoLinks.pedidoId, pedidoId)));
    if (!prev) return;
    await tx.delete(meMaterialPedidoLinks).where(and(eq(meMaterialPedidoLinks.materialId, materialId), eq(meMaterialPedidoLinks.pedidoId, pedidoId)));
    const a = auditRow(actor, "me_stock", materialId, "pedido_link_remove", { pedidoId, unidadesPorProducto: prev.unitsPerProduct }, null, "Se quitó el vínculo material ↔ pedido");
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
  });
}
