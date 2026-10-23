/**
 * DIFERENCIA de INGRESOS ME — lado servidor (Postgres). Control de recepción contra el pedido, SIN usar el saldo de
 * Stock ME (ver me-diferencia.ts). Solo escribe el vínculo ingreso ↔ pedido, el consumo por producto y los snapshots,
 * siempre con auditoría; nunca stock, movimientos ni cantidades de pedidos.
 *
 * Los pedidos solo los lee Producción: Depósito recibe únicamente lo calculado y, para vincular, los pedidos ACTIVOS del
 * cliente del ingreso (producto y unidades).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invAudit, invMeIngresos, invMeMaterials, meMaterialPedidoLinks, productionPedidos } from "@/lib/db/schema";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError, type InventoryActor } from "./inventory-service";
import { normalizeMeCodigo } from "./me-codigo";
import { acumuladoPorIngreso, computeMeDiferencia, type IngresoDiferenciaRow, type IngresoDiferenciasPayload } from "./me-diferencia";
import { normText, pedidoActivo, reprocessIngreso, syncMaterialProducto, takeSnapshots } from "./me-producto-link";
import { canReadInventory, canWriteInventory } from "./rbac";
import type { MeIngresoRow, MeMaterial } from "./types";

function assertRead(actor: InventoryActor) {
  if (!actor.isSuperadmin && !canReadInventory(actor.sector, "me_ingresos")) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede ver me_ingresos.`);
}
function assertWrite(actor: InventoryActor) {
  if (!actor.isSuperadmin && !canWriteInventory(actor.sector, "me_ingresos")) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede modificar me_ingresos.`);
}

export async function listIngresoDiferenciasDb(actor: InventoryActor): Promise<IngresoDiferenciasPayload> {
  assertRead(actor);
  const db = getDb();
  const [ingRows, matRows, links, peds] = await Promise.all([
    db.select({ id: invMeIngresos.id, payload: invMeIngresos.payload }).from(invMeIngresos),
    db.select({ payload: invMeMaterials.payload }).from(invMeMaterials),
    db.select().from(meMaterialPedidoLinks),
    db.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto, q: productionPedidos.q }).from(productionPedidos).where(pedidoActivo).limit(5000),
  ]);
  const ingresos = ingRows.map((r) => ({ id: r.id, p: r.payload as MeIngresoRow }));
  const mats = matRows.map((r) => r.payload as MeMaterial);
  const matById = new Map(mats.map((m) => [m.id, m]));
  const codeOfMat = (id: string) => normalizeMeCodigo(matById.get(id)?.codigo);
  const ratio = (codigo: string, pedidoId: string) => links.find((l) => l.pedidoId === pedidoId && codeOfMat(l.materialId) === codigo && l.unitsPerProduct != null)?.unitsPerProduct ?? null;
  const pedById = new Map(peds.map((p) => [p.id, p]));
  const acum = acumuladoPorIngreso(ingresos.map(({ id, p }) => ({ id, codigo: normalizeMeCodigo(p.codigo), pedidoId: p.pedidoId, total: p.total, createdAt: p.createdAt, anulado: p.anulado })));

  const out: Record<string, IngresoDiferenciaRow> = {};
  for (const { id, p } of ingresos) {
    if (p.anulado) continue;
    const codigo = normalizeMeCodigo(p.codigo);
    const mat = (p.materialId ? matById.get(p.materialId) : undefined) ?? mats.find((m) => normalizeMeCodigo(m.codigo) === codigo);
    const cliente = (p.cliente ?? "").trim() || mat?.cliente || "";
    const producto = (p.producto ?? "").trim();
    const candidatos = producto ? peds.filter((x) => normText(x.cliente) === normText(cliente) && normText(x.producto) === normText(producto)).length : 0;
    const ped = p.pedidoId ? pedById.get(p.pedidoId) : undefined;
    const r = p.pedidoId ? ratio(codigo, p.pedidoId) : null;
    const acumulado = acum.get(id) ?? null;
    let actual: IngresoDiferenciaRow["actual"] = { estado: "SIN_DATOS", diferencia: null };
    let necesario: number | null = null;
    if (ped && acumulado != null) {
      const d = computeMeDiferencia(acumulado, [{ pedidoId: ped.id, pedidoUnidades: ped.q, unidadesPorProducto: r }]);
      actual = { estado: d.estado, diferencia: d.diferencia };
      necesario = d.necesario;
    } else if (!p.pedidoId && candidatos > 1) actual = { estado: "ELEGIR_PEDIDO", diferencia: null };
    out[id] = {
      estado: actual.estado,
      diferencia: actual.diferencia,
      stock: acumulado ?? 0,
      necesario,
      acumulado,
      pedidoId: p.pedidoId ?? null,
      pedidoUnidades: ped?.q ?? null,
      unidadesPorProducto: r,
      snapshot: p.difSnapshot ?? null,
      actual,
      candidatos,
    };
  }
  const payload: IngresoDiferenciasPayload = { ingresos: out };
  if (actor.isSuperadmin || canWriteInventory(actor.sector, "me_ingresos")) {
    const clientes = new Set([...mats.map((m) => normText(m.cliente)), ...ingresos.map((i) => normText(i.p.cliente))].filter(Boolean));
    const acumulados: Record<string, number> = {};
    const consumos: Record<string, number | null> = {};
    for (const { id, p } of ingresos) {
      if (p.anulado || !p.pedidoId) continue;
      const k = `${normalizeMeCodigo(p.codigo)}|${p.pedidoId}`;
      acumulados[k] = Math.max(acumulados[k] ?? 0, acum.get(id) ?? 0);
      consumos[k] = ratio(normalizeMeCodigo(p.codigo), p.pedidoId);
    }
    for (const l of links) {
      const k = `${codeOfMat(l.materialId)}|${l.pedidoId}`;
      if (!(k in consumos)) consumos[k] = l.unitsPerProduct;
    }
    payload.previsto = { pedidos: peds.filter((x) => clientes.has(normText(x.cliente))).map((x) => ({ id: x.id, cliente: x.cliente ?? "", producto: x.producto ?? "", unidades: x.q })), acumulados, consumos };
  }
  return payload;
}

async function loadIngreso(tx: ReturnType<typeof getDb>, ingresoId: string) {
  const [row] = await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos).where(eq(invMeIngresos.id, ingresoId));
  const ing = row?.payload as MeIngresoRow | undefined;
  if (!ing) throw new InventoryNotFoundError("Ingreso ME no encontrado.");
  return ing;
}

/** Pedidos activos del MISMO cliente del ingreso (coincidencia exacta normalizada; nunca por parecido). */
export async function candidatePedidosDb(actor: InventoryActor, ingresoId: string): Promise<Array<{ pedidoId: string; cliente: string; producto: string; unidades: number | null; estado: string }>> {
  assertWrite(actor);
  const db = getDb();
  const ing = await loadIngreso(db, ingresoId);
  const mats = (await db.select({ payload: invMeMaterials.payload }).from(invMeMaterials)).map((r) => r.payload as MeMaterial);
  const mat = mats.find((m) => m.id === ing.materialId) ?? mats.find((m) => normalizeMeCodigo(m.codigo) === normalizeMeCodigo(ing.codigo));
  const cliente = normText(ing.cliente) || normText(mat?.cliente);
  if (!cliente) return [];
  const rows = await db.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto, q: productionPedidos.q, estado: productionPedidos.estado }).from(productionPedidos).where(pedidoActivo).limit(5000);
  return rows.filter((r) => normText(r.cliente) === cliente).map((r) => ({ pedidoId: r.id, cliente: r.cliente ?? "", producto: r.producto ?? "", unidades: r.q, estado: r.estado ?? "" }));
}

export interface IngresoLinkInput {
  ingresoId: string;
  pedidoId: string;
  /** Unidades de este material por producto terminado; null = sin configurar. undefined = conservar el ya configurado. */
  unidadesPorProducto?: number | null;
}

/** Vincula el ingreso con un pedido (y fija el consumo por producto del material para ese pedido). No toca stock ni pedidos. */
export async function linkIngresoPedidoDb(actor: InventoryActor, input: IngresoLinkInput): Promise<void> {
  assertWrite(actor);
  const ratio = input.unidadesPorProducto;
  if (ratio != null && !(Number.isFinite(ratio) && ratio > 0)) throw new InventoryValidationError("El consumo por producto debe ser mayor que 0.");
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos).where(eq(invMeIngresos.id, input.ingresoId)).for("update");
    const ing = row?.payload as MeIngresoRow | undefined;
    if (!ing) throw new InventoryNotFoundError("Ingreso ME no encontrado.");
    if (ing.anulado) throw new InventoryValidationError("Ingreso anulado: no se vincula.");
    const codigo = normalizeMeCodigo(ing.codigo);
    const mats = (await tx.select({ payload: invMeMaterials.payload }).from(invMeMaterials)).map((r) => r.payload as MeMaterial).filter((m) => normalizeMeCodigo(m.codigo) === codigo);
    const mat = mats.find((m) => m.id === ing.materialId) ?? mats[0];
    if (!mat) throw new InventoryNotFoundError("Material ME no encontrado.");
    const [ped] = await tx.select({ id: productionPedidos.id, cliente: productionPedidos.cliente, producto: productionPedidos.producto }).from(productionPedidos).where(and(eq(productionPedidos.id, input.pedidoId), pedidoActivo));
    if (!ped) throw new InventoryNotFoundError("Pedido activo no encontrado.");
    if (normText(ped.cliente) !== (normText(ing.cliente) || normText(mat.cliente))) throw new InventoryValidationError("El pedido es de otro cliente: no se mezclan ingresos de clientes distintos.");
    const [prevLink] = await tx.select().from(meMaterialPedidoLinks).where(and(eq(meMaterialPedidoLinks.materialId, mat.id), eq(meMaterialPedidoLinks.pedidoId, ped.id)));
    if (ratio !== undefined) {
      await tx
        .insert(meMaterialPedidoLinks)
        .values({ materialId: mat.id, pedidoId: ped.id, unitsPerProduct: ratio, createdBy: actor.email, updatedBy: actor.email })
        .onConflictDoUpdate({ target: [meMaterialPedidoLinks.materialId, meMaterialPedidoLinks.pedidoId], set: { unitsPerProduct: ratio, updatedBy: actor.email, updatedAt: new Date() } });
    } else {
      await tx.insert(meMaterialPedidoLinks).values({ materialId: mat.id, pedidoId: ped.id, unitsPerProduct: null, createdBy: actor.email, updatedBy: actor.email }).onConflictDoNothing();
    }
    // Volver a vincular a propósito (otro pedido, producto o consumo) recalcula SU snapshot; el anterior queda en la auditoría.
    const cambia = ing.pedidoId !== ped.id || (ing.producto ?? "").trim() !== (ped.producto ?? "").trim() || (ratio !== undefined && (prevLink?.unitsPerProduct ?? null) !== ratio);
    const next: MeIngresoRow = { ...ing, producto: ped.producto ?? ing.producto ?? "", pedidoId: ped.id, difSnapshot: cambia ? null : (ing.difSnapshot ?? null) };
    await tx.update(invMeIngresos).set({ payload: next }).where(eq(invMeIngresos.id, input.ingresoId));
    const a = { id: crypto.randomUUID(), module: "me_ingresos", entityId: input.ingresoId, action: "pedido_link", actor: actor.email, actorSector: actor.sector, reason: "Vínculo del ingreso con el pedido para DIFERENCIA", before: { pedidoId: ing.pedidoId ?? null, producto: ing.producto ?? "", difSnapshot: ing.difSnapshot ?? null }, after: { pedidoId: ped.id, producto: next.producto, unidadesPorProducto: ratio ?? null }, createdAt: new Date().toISOString() };
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
    await syncMaterialProducto(tx, mat.id, next.producto);
    await takeSnapshots(tx, actor, codigo);
  });
}

export async function unlinkIngresoPedidoDb(actor: InventoryActor, ingresoId: string): Promise<void> {
  assertWrite(actor);
  await getDb().transaction(async (tx) => {
    const [row] = await tx.select({ payload: invMeIngresos.payload }).from(invMeIngresos).where(eq(invMeIngresos.id, ingresoId)).for("update");
    const ing = row?.payload as MeIngresoRow | undefined;
    if (!ing || (!ing.pedidoId && !ing.difSnapshot)) return;
    await tx.update(invMeIngresos).set({ payload: { ...ing, pedidoId: null, difSnapshot: null } }).where(eq(invMeIngresos.id, ingresoId));
    const a = { id: crypto.randomUUID(), module: "me_ingresos", entityId: ingresoId, action: "pedido_unlink", actor: actor.email, actorSector: actor.sector, reason: "Se quitó el vínculo del ingreso con el pedido", before: { pedidoId: ing.pedidoId ?? null, difSnapshot: ing.difSnapshot ?? null }, after: null, createdAt: new Date().toISOString() };
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
  });
}

/**
 * Tras crear/editar un ingreso por el servicio en memoria (altas desde filas nuevas / formulario): resuelve su pedido y toma el
 * snapshot. Best-effort: un fallo acá nunca deshace el ingreso ya registrado (queda SIN DATOS).
 */
export async function syncIngresoAfterWrite(actor: InventoryActor, ingresoId: string | null | undefined, opts: { resetSnapshot?: boolean } = {}): Promise<void> {
  if (!ingresoId) return;
  try {
    await getDb().transaction(async (tx) => {
      await reprocessIngreso(tx, actor, ingresoId, opts);
    });
  } catch (err) {
    console.error("[inventory] ingreso→pedido", err);
  }
}

