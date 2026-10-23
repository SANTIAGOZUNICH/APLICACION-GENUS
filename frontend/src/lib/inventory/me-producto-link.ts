/**
 * Ingresos ME → pedido (control de recepción). Reglas, SIN tocar stock ni movimientos:
 *  - El pedido de un ingreso sale de SU cliente + SU producto: solo pedidos ACTIVOS (no eliminados, no entregados) con
 *    igualdad exacta normalizada (nunca por parecido). Un único candidato → se vincula solo; varios → hay que elegir
 *    (ELEGIR PEDIDO); ninguno → SIN DATOS.
 *  - Cada ingreso guarda un snapshot del resultado del momento en que se pudo calcular (pedido + consumo conocidos).
 *    No se reescribe solo: cambia únicamente al editar el propio ingreso o al volver a vincularlo, y queda auditado.
 * Corre dentro de la transacción del llamador.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { getDb } from "@/lib/db/client";
import { invAudit, invMeIngresos, invMeMaterials, meMaterialPedidoLinks, productionPedidos } from "@/lib/db/schema";
import type { InventoryActor } from "./inventory-service";
import type { MeIngresoRow, MeMaterial } from "./types";
import { normalizeMeCodigo } from "./me-codigo";
import { acumuladoPorIngreso, computeMeDiferencia, type IngresoDifSnapshot } from "./me-diferencia";

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export const normText = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toUpperCase();
export const pedidoActivo = and(isNull(productionPedidos.deletedAt), sql`coalesce(${productionPedidos.estado}, '') <> 'ENTREGADO'`);

async function audit(tx: Tx, actor: InventoryActor, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, reason: string) {
  const a = { id: randomUUID(), module: "me_ingresos", entityId, action, actor: actor.email, actorSector: actor.sector, reason, before, after, createdAt: new Date().toISOString() };
  await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
}

/** Pedidos activos candidatos de un cliente + producto (igualdad exacta normalizada). */
export async function candidatesFor(tx: Tx, cliente: string, producto: string) {
  const c = normText(cliente);
  const p = normText(producto);
  if (!c || !p) return [];
  const rows = await tx.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto, q: productionPedidos.q, estado: productionPedidos.estado }).from(productionPedidos).where(pedidoActivo).limit(5000);
  return rows.filter((r) => normText(r.cliente) === c && normText(r.producto) === p);
}

async function materialsOf(tx: Tx, codigo: string): Promise<MeMaterial[]> {
  const rows = await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials);
  return rows.map((r) => r.payload as MeMaterial).filter((m) => normalizeMeCodigo(m.codigo) === codigo);
}

/** Si el material todavía no tiene producto, hereda el del ingreso (solo etiqueta de Stock ME: no vincula nada). */
export async function syncMaterialProducto(tx: Tx, materialId: string | null | undefined, producto: string | null | undefined): Promise<void> {
  const prod = (producto ?? "").trim();
  if (!materialId || !prod) return;
  const [row] = await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials).where(eq(invMeMaterials.id, materialId)).for("update");
  const mat = row?.payload as MeMaterial | undefined;
  if (!mat || (mat.producto ?? "").trim()) return;
  await tx.update(invMeMaterials).set({ payload: { ...mat, producto: prod, updatedAt: new Date(Math.max(Date.now(), new Date(mat.updatedAt).getTime() + 1)).toISOString() }, updatedAt: new Date() }).where(eq(invMeMaterials.id, materialId));
}

/**
 * Resuelve el pedido de UN ingreso (por su cliente + producto) y, si corresponde, toma los snapshots pendientes de su código.
 * `resetSnapshot`: el ingreso se editó (cantidad, producto, código…): su snapshot se recalcula y el cambio queda auditado.
 */
export async function reprocessIngreso(tx: Tx, actor: InventoryActor, ingresoId: string, opts: { resetSnapshot?: boolean } = {}): Promise<void> {
  const [row] = await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos).where(eq(invMeIngresos.id, ingresoId)).for("update");
  const ing = row?.payload as MeIngresoRow | undefined;
  if (!ing || ing.anulado) return;
  const codigo = normalizeMeCodigo(ing.codigo);
  const mats = codigo ? await materialsOf(tx, codigo) : [];
  const mat = mats.find((m) => m.id === ing.materialId) ?? mats[0];
  const cliente = (ing.cliente ?? "").trim() || mat?.cliente || "";
  const producto = (ing.producto ?? "").trim();
  let pedidoId: string | null = null;
  if (producto) {
    const cands = await candidatesFor(tx, cliente, producto);
    pedidoId = cands.some((c) => c.id === ing.pedidoId) ? (ing.pedidoId as string) : cands.length === 1 ? cands[0]!.id : null;
  }
  const dropSnapshot = Boolean(ing.difSnapshot) && (opts.resetSnapshot || pedidoId !== (ing.pedidoId ?? null));
  if (pedidoId !== (ing.pedidoId ?? null) || dropSnapshot) {
    const next: MeIngresoRow = { ...ing, pedidoId, difSnapshot: dropSnapshot ? null : (ing.difSnapshot ?? null) };
    await tx.update(invMeIngresos).set({ payload: next }).where(eq(invMeIngresos.id, ingresoId));
    if (dropSnapshot) await audit(tx, actor, ingresoId, "dif_snapshot_recalculado", { difSnapshot: ing.difSnapshot ?? null, pedidoId: ing.pedidoId ?? null }, { difSnapshot: null, pedidoId }, "El ingreso se editó: se recalcula su DIFERENCIA (el resultado anterior queda en la auditoría)");
  }
  await syncMaterialProducto(tx, ing.materialId ?? mat?.id, producto);
  if (codigo) await takeSnapshots(tx, actor, codigo);
}

/** Toma el snapshot de los ingresos del código que ya se pueden calcular y todavía no tienen. Devuelve cuántos. */
export async function takeSnapshots(tx: Tx, actor: InventoryActor, codigo: string): Promise<number> {
  const cod = normalizeMeCodigo(codigo);
  const all = (await tx.select({ id: invMeIngresos.id, payload: invMeIngresos.payload }).from(invMeIngresos)).filter((r) => normalizeMeCodigo((r.payload as MeIngresoRow).codigo) === cod);
  const rows = all.map((r) => ({ id: r.id, p: r.payload as MeIngresoRow }));
  const pending = rows.filter((r) => !r.p.anulado && r.p.pedidoId && !r.p.difSnapshot);
  if (!pending.length) return 0;
  const acum = acumuladoPorIngreso(rows.map((r) => ({ id: r.id, codigo: cod, pedidoId: r.p.pedidoId, total: r.p.total, createdAt: r.p.createdAt, anulado: r.p.anulado })));
  const mats = await materialsOf(tx, cod);
  const links = mats.length ? await tx.select().from(meMaterialPedidoLinks).where(inArray(meMaterialPedidoLinks.materialId, mats.map((m) => m.id))) : [];
  const ratioOf = (pedidoId: string) => links.find((l) => l.pedidoId === pedidoId && l.unitsPerProduct != null)?.unitsPerProduct ?? null;
  const pedidoIds = [...new Set(pending.map((r) => r.p.pedidoId as string))];
  const peds = await tx.select({ id: productionPedidos.id, q: productionPedidos.q }).from(productionPedidos).where(and(inArray(productionPedidos.id, pedidoIds), pedidoActivo));
  let n = 0;
  for (const r of pending) {
    const ped = peds.find((x) => x.id === r.p.pedidoId);
    const ratio = ratioOf(r.p.pedidoId as string);
    const acumulado = acum.get(r.id);
    if (!ped || ped.q == null || ratio == null || acumulado == null) continue;
    const d = computeMeDiferencia(acumulado, [{ pedidoId: ped.id, pedidoUnidades: ped.q, unidadesPorProducto: ratio }]);
    if (d.estado !== "FALTAN" && d.estado !== "SOBRAN" && d.estado !== "JUSTO") continue;
    const snapshot: IngresoDifSnapshot = { pedidoId: ped.id, acumulado, necesario: d.necesario!, diferencia: d.diferencia!, estado: d.estado, pedidoUnidades: ped.q, unidadesPorProducto: ratio, calculadoAt: new Date().toISOString() };
    await tx.update(invMeIngresos).set({ payload: { ...r.p, difSnapshot: snapshot } }).where(eq(invMeIngresos.id, r.id));
    await audit(tx, actor, r.id, "dif_snapshot", null, { difSnapshot: snapshot }, "DIFERENCIA del ingreso al momento de poder calcularla");
    n += 1;
  }
  return n;
}
