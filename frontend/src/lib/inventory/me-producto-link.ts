/**
 * CLIENTE + PRODUCTO → pedido (Depósito ME). Reglas de vinculación, SIN tocar stock ni movimientos:
 *  - Solo pedidos ACTIVOS (no eliminados, no entregados) del MISMO cliente y con el MISMO producto (igualdad exacta
 *    normalizada: nunca por parecido).
 *  - Un único candidato → se vincula solo (si el material ya tenía consumo por producto configurado, se conserva).
 *  - Varios candidatos → no se asume: queda ELEGIR PEDIDO hasta que Depósito elija.
 *  - Ninguno → el producto queda como texto y DIFERENCIA en SIN DATOS.
 *  - Un material tiene UN solo pedido vinculado a la vez: el mismo stock no se cuenta para varios pedidos.
 * Corre dentro de la transacción del llamador.
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { invAudit, invMeIngresos, invMeMaterials, meMaterialPedidoLinks, productionPedidos } from "@/lib/db/schema";
import type { InventoryActor } from "./inventory-service";
import type { MeIngresoRow, MeMaterial } from "./types";
import { normalizeMeCodigo } from "./me-codigo";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const normText = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export const pedidoActivo = and(isNull(productionPedidos.deletedAt), sql`coalesce(${productionPedidos.estado}, '') <> 'ENTREGADO'`);
const nextVersion = (prev: string | undefined) => new Date(Math.max(Date.now(), new Date(prev ?? 0).getTime() + 1 || 0)).toISOString();

async function audit(tx: Tx, actor: InventoryActor, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string) {
  const a = { id: randomUUID(), module: "me_stock", entityId, action, actor: actor.email, actorSector: actor.sector, reason, before, after, createdAt: new Date().toISOString() };
  await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
}

/** Deja UN solo vínculo material ↔ pedido (reemplaza los demás). `ratio === undefined` conserva el consumo previo. */
export async function setSingleLink(tx: Tx, actor: InventoryActor, materialId: string, pedidoId: string, ratio?: number | null): Promise<void> {
  const prev = await tx.select().from(meMaterialPedidoLinks).where(eq(meMaterialPedidoLinks.materialId, materialId));
  const keep = ratio === undefined ? (prev.find((p) => p.pedidoId === pedidoId)?.unitsPerProduct ?? prev.find((p) => p.unitsPerProduct != null)?.unitsPerProduct ?? null) : ratio;
  for (const p of prev) if (p.pedidoId !== pedidoId) await tx.delete(meMaterialPedidoLinks).where(eq(meMaterialPedidoLinks.id, p.id));
  await tx
    .insert(meMaterialPedidoLinks)
    .values({ materialId, pedidoId, unitsPerProduct: keep, createdBy: actor.email, updatedBy: actor.email })
    .onConflictDoUpdate({ target: [meMaterialPedidoLinks.materialId, meMaterialPedidoLinks.pedidoId], set: { unitsPerProduct: keep, updatedBy: actor.email, updatedAt: new Date() } });
  const same = prev.length === 1 && prev[0]!.pedidoId === pedidoId && prev[0]!.unitsPerProduct === keep;
  if (!same) await audit(tx, actor, materialId, prev.length ? "pedido_link_update" : "pedido_link_create", prev.length ? { pedidos: prev.map((p) => p.pedidoId) } : null, { pedidoId, unidadesPorProducto: keep }, "Vínculo material ↔ pedido para DIFERENCIA");
}

/** Pedidos activos candidatos de un cliente + producto (igualdad exacta normalizada). */
export async function candidatesFor(tx: Tx, cliente: string, producto: string) {
  const c = normText(cliente);
  const p = normText(producto);
  if (!c || !p) return [];
  const rows = await tx.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto, q: productionPedidos.q, estado: productionPedidos.estado }).from(productionPedidos).where(pedidoActivo).limit(5000);
  return rows.filter((r) => normText(r.cliente) === c && normText(r.producto) === p);
}

/**
 * Sincroniza producto/pedido de un material (y de sus ingresos) tras un cambio de cliente/producto o un alta.
 * `ingresoProducto`: el producto escrito en un ingreso; el material lo hereda solo si todavía no tiene uno.
 */
export async function resolveProductoLink(tx: Tx, actor: InventoryActor, materialId: string, opts: { ingresoProducto?: string } = {}): Promise<void> {
  const [row] = await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials).where(eq(invMeMaterials.id, materialId)).for("update");
  if (!row) return;
  const mat = row.payload as MeMaterial;
  let producto = (mat.producto ?? "").trim();
  if (!producto && opts.ingresoProducto?.trim()) producto = opts.ingresoProducto.trim();
  const links = await tx.select().from(meMaterialPedidoLinks).where(eq(meMaterialPedidoLinks.materialId, materialId));
  const cands = producto ? await candidatesFor(tx, mat.cliente, producto) : [];
  let pedidoId: string | null = null;
  if (cands.length) {
    const linked = links.find((l) => cands.some((c) => c.id === l.pedidoId));
    if (linked) pedidoId = linked.pedidoId;
    else if (cands.length === 1) {
      await setSingleLink(tx, actor, materialId, cands[0]!.id);
      pedidoId = cands[0]!.id;
    }
  }
  // Vínculos que ya no corresponden al cliente + producto (o con producto vaciado) se quitan; el stock no se toca.
  for (const l of links) {
    if (l.pedidoId === pedidoId) continue;
    await tx.delete(meMaterialPedidoLinks).where(eq(meMaterialPedidoLinks.id, l.id));
    await audit(tx, actor, materialId, "pedido_link_remove", { pedidoId: l.pedidoId, unidadesPorProducto: l.unitsPerProduct }, null, "El cliente/producto ya no coincide con el pedido vinculado");
  }
  if ((mat.producto ?? "") !== producto || (mat.pedidoId ?? null) !== pedidoId) {
    const next: MeMaterial = { ...mat, producto, pedidoId, updatedAt: nextVersion(mat.updatedAt) };
    await tx.update(invMeMaterials).set({ payload: next, updatedAt: new Date() }).where(eq(invMeMaterials.id, materialId));
    await audit(tx, actor, materialId, "producto_pedido", { producto: mat.producto ?? "", pedidoId: mat.pedidoId ?? null }, { producto, pedidoId }, "Producto/pedido del material");
  }
  // Los ingresos del mismo código con ese producto guardan la referencia estable al pedido (sin tocar su versión ni su cantidad).
  const codigo = normalizeMeCodigo(mat.codigo);
  if (codigo) {
    const ing = await tx.select({ id: invMeIngresos.id, payload: invMeIngresos.payload }).from(invMeIngresos);
    for (const r of ing) {
      const p = r.payload as MeIngresoRow;
      if (normalizeMeCodigo(p.codigo) !== codigo || p.anulado) continue;
      const want = pedidoId && normText(p.producto) === normText(producto) ? pedidoId : null;
      if ((p.pedidoId ?? null) !== want && (p.pedidoId || want)) await tx.update(invMeIngresos).set({ payload: { ...p, pedidoId: want } }).where(eq(invMeIngresos.id, r.id));
    }
  }
}
