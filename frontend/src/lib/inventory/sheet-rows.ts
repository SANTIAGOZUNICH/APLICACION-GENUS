/**
 * Filas de las planillas como en Excel: insertar una fila en blanco en cualquier lugar y mover filas, con orden manual
 * persistente (`load_seq`). Escribe en Postgres dentro de una transacción con el MISMO candado que las ediciones de la hoja
 * (MP: `genus-mp-inventory`; ME: `genus-me-sheet-order`), audita (usuario, fecha, antes/después) y NO toca stock ni payloads
 * existentes: mover solo reparte posiciones; insertar crea un registro vacío que no suma ni descuenta nada hasta que se lo completa.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { invAudit } from "@/lib/db/schema";
import { InventoryForbiddenError, InventoryNotFoundError, InventoryValidationError, type InventoryActor } from "./inventory-service";
import { canWriteInventory, type InventoryModule } from "./rbac";
import { ensureMpLoadOrderBackfill } from "./mp-load-order";
import { planMove, type SeqRow } from "./sheet-order";
import type { InventoryAudit } from "./types";

export const SHEET_ROW_RESOURCES = ["mp_stock", "mp_ingresos", "me_ingresos", "me_salidas", "me_inventario"] as const;
export type SheetRowResource = (typeof SHEET_ROW_RESOURCES)[number];

const TABLE: Record<SheetRowResource, string> = {
  mp_stock: "inv_mp_stock",
  mp_ingresos: "inv_mp_ingresos",
  me_ingresos: "inv_me_ingresos",
  me_salidas: "inv_me_salidas",
  me_inventario: "inv_me_materials",
};
const LOCK: Record<SheetRowResource, string> = {
  mp_stock: "genus-mp-inventory",
  mp_ingresos: "genus-mp-inventory",
  me_ingresos: "genus-me-sheet-order",
  me_salidas: "genus-me-sheet-order",
  me_inventario: "genus-me-sheet-order",
};
const MODULE: Record<SheetRowResource, InventoryModule> = {
  mp_stock: "mp_stock",
  mp_ingresos: "mp_ingresos",
  me_ingresos: "me_ingresos",
  me_salidas: "me_salidas",
  me_inventario: "me_stock",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSheetRowResource(v: unknown): v is SheetRowResource {
  return typeof v === "string" && (SHEET_ROW_RESOURCES as readonly string[]).includes(v);
}

/** Registro vacío de cada planilla: no tiene código, cantidad ni lote, por lo que no suma ni descuenta stock. */
export function blankSheetPayload(resource: SheetRowResource, id: string, actor: string, now: string): Record<string, unknown> {
  const base = { id, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now };
  switch (resource) {
    case "mp_stock":
      return {
        ...base, proveedor: "", cliente: "", descripcion: "", cantidadKg: null, ubicacion: "", lote: "", vencimiento: "", estadoStock: "",
        diasAlVence: null, estadoVencimiento: "", origen: "planilla", codigo: "", codigoPendiente: false, productosAsociados: "", producto: "",
        estadoStockManual: "", estadoVencimientoManual: "", archived: false, archivedAt: null, archivedBy: null, archivedReason: null,
      };
    case "mp_ingresos":
      return {
        ...base, fecha: "", ingresoNro: "", proveedor: "", cliente: "", remitoNro: "", codigo: "", producto: "", descripcion: "", bultos: null,
        cantidad: null, total: null, ubicacion: "", lote: "", vencimiento: "", stockLotId: null, status: "BORRADOR", stockImpacted: false,
      };
    case "me_ingresos":
      return {
        ...base, fecha: "", ingresoNro: "", proveedor: "", cliente: "", remitoNro: "", codigo: "", descripcionInsumo: "", bultos: null,
        cantidad: null, total: null, ubicacion: "", materialId: null,
      };
    case "me_salidas":
      return {
        ...base, fecha: "", egresoNro: "", cliente: "", remitoNro: "", descripcion: "", bultos: null, cantidad: null, total: null, control: false,
        entregado: false, comentarios: "", materialId: null, codigo: "", unidad: "", origen: "MANUAL", descuentaStock: false, motivoSalida: null,
        oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null,
      };
    case "me_inventario":
      return {
        id, codigo: "", descripcion: "", cliente: "", ubicacion: "", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null,
        puntoReposicion: null, responsable: "", observacion: "", updatedAt: now, archived: false,
      };
  }
}

function assertWrite(actor: InventoryActor, resource: SheetRowResource) {
  if (actor.isSuperadmin) return;
  if (!canWriteInventory(actor.sector, MODULE[resource])) throw new InventoryForbiddenError(`Sector ${actor.sector} no puede modificar ${MODULE[resource]}.`);
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function orderedRows(tx: Tx, table: string): Promise<SeqRow[]> {
  const res = (await tx.execute(sql.raw(`select id::text as id, load_seq::float8 as seq from "${table}" order by load_seq asc`))) as unknown as {
    rows: Array<{ id: string; seq: number }>;
  };
  return res.rows.map((r) => ({ id: r.id, seq: Number(r.seq) }));
}

/** Reparte posiciones sin chocar con el índice único: libera (negativas) y reasigna. */
async function applySeq(tx: Tx, table: string, changes: SeqRow[]) {
  if (changes.length === 0) return;
  for (const c of changes) if (!UUID.test(c.id) || !Number.isFinite(c.seq)) throw new InventoryValidationError("Orden inválido.");
  const ids = changes.map((c) => `'${c.id}'::uuid`).join(",");
  await tx.execute(sql.raw(`update "${table}" set load_seq = -load_seq where id in (${ids})`));
  const values = changes.map((c) => `('${c.id}'::uuid, ${Math.trunc(c.seq)})`).join(",");
  await tx.execute(sql.raw(`update "${table}" x set load_seq = v.seq from (values ${values}) as v(id, seq) where x.id = v.id`));
}

const audit = (actor: InventoryActor, resource: SheetRowResource, entityId: string, action: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null): InventoryAudit => ({
  id: randomUUID(), module: MODULE[resource], entityId, action, actor: actor.email, actorSector: actor.sector, reason: null, before, after, createdAt: new Date().toISOString(),
});

async function open(actor: InventoryActor, resource: SheetRowResource) {
  if (!isSheetRowResource(resource)) throw new InventoryValidationError("Planilla inválida.");
  assertWrite(actor, resource);
  if (resource.startsWith("mp_")) await ensureMpLoadOrderBackfill({ force: true });
}

/** Mueve la fila `id` para que quede justo antes de `beforeId` (null/undefined = al final). Devuelve la posición (1-based) resultante. */
export async function moveSheetRow(actor: InventoryActor, resource: SheetRowResource, id: string, beforeId: string | null): Promise<{ position: number; moved: number }> {
  await open(actor, resource);
  if (!UUID.test(id) || (beforeId != null && !UUID.test(beforeId))) throw new InventoryValidationError("Fila inválida.");
  const table = TABLE[resource];
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK[resource]}))`);
    const ordered = await orderedRows(tx, table);
    if (!ordered.some((r) => r.id === id)) throw new InventoryNotFoundError("La fila ya no existe.");
    if (beforeId != null && !ordered.some((r) => r.id === beforeId)) throw new InventoryNotFoundError("La fila de destino ya no existe.");
    const from = ordered.findIndex((r) => r.id === id) + 1;
    const changes = planMove(ordered, id, beforeId);
    await applySeq(tx, table, changes);
    const after = await orderedRows(tx, table);
    const position = after.findIndex((r) => r.id === id) + 1;
    if (changes.length > 0) {
      const a = audit(actor, resource, id, "move_row", { position: from }, { position });
      await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
    }
    return { position, moved: changes.length };
  });
}

/** Inserta una fila en blanco justo antes de `beforeId` (null/undefined = al final, sin mover ninguna otra). */
export async function insertBlankSheetRow(actor: InventoryActor, resource: SheetRowResource, beforeId: string | null): Promise<{ id: string; position: number }> {
  await open(actor, resource);
  if (beforeId != null && !UUID.test(beforeId)) throw new InventoryValidationError("Fila inválida.");
  const table = TABLE[resource];
  const id = randomUUID();
  const now = new Date().toISOString();
  const payload = blankSheetPayload(resource, id, actor.email, now);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK[resource]}))`);
    if (beforeId != null) {
      const ordered = await orderedRows(tx, table);
      if (!ordered.some((r) => r.id === beforeId)) throw new InventoryNotFoundError("La fila de destino ya no existe.");
    }
    await tx.execute(
      sql`insert into ${sql.raw(`"${table}"`)} (id, payload, updated_at, seq_criterio) values (${id}::uuid, ${JSON.stringify(payload)}::jsonb, now(), 'alta')`
    );
    if (beforeId != null) {
      const ordered = await orderedRows(tx, table);
      await applySeq(tx, table, planMove(ordered, id, beforeId));
    }
    const after = await orderedRows(tx, table);
    const position = after.findIndex((r) => r.id === id) + 1;
    const a = audit(actor, resource, id, "insert_row", null, { position, blank: true });
    await tx.insert(invAudit).values({ id: a.id, payload: a, createdAt: new Date(a.createdAt) });
    return { id, position };
  });
}

type NewRowTable = "inv_mp_stock" | "inv_mp_ingresos";

const TEXT_FIELDS: Record<NewRowTable, string[]> = {
  inv_mp_stock: ["proveedor", "cliente", "descripcion", "ubicacion", "lote", "vencimiento", "codigo", "producto"],
  inv_mp_ingresos: ["fecha", "ingresoNro", "proveedor", "cliente", "remitoNro", "codigo", "producto", "descripcion", "ubicacion", "lote", "vencimiento"],
};
const NUMBER_FIELDS: Record<NewRowTable, string[]> = {
  inv_mp_stock: ["cantidadKg"],
  inv_mp_ingresos: ["bultos", "cantidad", "total"],
};

/**
 * Clasificación SQL de una fila de la planilla según lo que el usuario VE escrito:
 *  - 'hidden': archivada / anulada (no se ve, no cuenta ni como escrita ni como vacía);
 *  - 'blank': ninguna columna cargada a mano tiene datos (las columnas calculadas — estado, días, productos asociados — NO cuentan);
 *  - 'data': cualquier dato escrito.
 */
export function sheetRowKindSql(table: NewRowTable): string {
  // Vacío = sin texto, o la «fecha cero» que dejan las hojas de Excel importadas (1899/1900) en las columnas de fecha.
  const text = TEXT_FIELDS[table].map((f) =>
    /^(fecha|vencimiento)$/.test(f)
      ? `(coalesce(nullif(btrim(payload->>'${f}'), ''), '') = '' or payload->>'${f}' ~ '^(1899|1900)-')`
      : `coalesce(nullif(btrim(payload->>'${f}'), ''), '') = ''`
  );
  const nums = NUMBER_FIELDS[table].map((f) => `coalesce(nullif(btrim(payload->>'${f}'), ''), '0') ~ '^-?0*[.,]?0*$'`);
  const hidden = table === "inv_mp_stock" ? `coalesce(payload->>'archived', 'false') = 'true'` : `payload->>'status' = 'ANULADO'`;
  const draftOnly = table === "inv_mp_ingresos" ? ` and coalesce(payload->>'status', 'BORRADOR') = 'BORRADOR'` : "";
  return `case when ${hidden} then 'hidden' when ${[...text, ...nums].join(" and ")}${draftOnly} then 'blank' else 'data' end`;
}

/**
 * Como en una hoja Excel: un registro NUEVO de Stock MP / Ingresos MP ocupa la PRIMERA fila vacía que hay inmediatamente
 * debajo de la última fila con datos (según el orden manual de la planilla), no el final de todos los registros guardados.
 *  - Se identifica la última fila con datos y las filas vacías persistidas que le siguen (las ocultas se saltean).
 *  - El registro nuevo toma la posición de la primera vacía y esa fila vacía (sin datos) se retira: ni se duplica ni crece la
 *    planilla, y las demás vacías siguen debajo. Si no hay vacías, el registro queda a continuación de la última escrita.
 *  - Nunca toca filas con datos ni cambia el orden relativo de las ya escritas.
 * Debe correr dentro de la transacción de la operación (con el candado de MP tomado).
 */
export async function placeNewRowsAfterLastWritten(tx: Tx, table: NewRowTable, newIds: string[]): Promise<void> {
  if (newIds.length === 0) return;
  const res = (await tx.execute(
    sql.raw(`select id::text as id, load_seq::float8 as seq, (${sheetRowKindSql(table)}) as kind from "${table}" order by load_seq desc`)
  )) as unknown as { rows: Array<{ id: string; seq: number; kind: "hidden" | "blank" | "data" }> };
  const fresh = new Set(newIds);
  const blanks: string[] = []; // de arriba hacia abajo
  for (const r of res.rows) {
    if (fresh.has(r.id) || r.kind === "hidden") continue;
    if (r.kind === "data") break;
    blanks.unshift(r.id);
  }
  if (blanks.length === 0) return;
  let current = await orderedRows(tx, table);
  const sortedNew = newIds
    .map((id) => current.find((r) => r.id === id))
    .filter((r): r is SeqRow => Boolean(r))
    .sort((a, b) => a.seq - b.seq);
  for (const n of sortedNew) {
    const target = blanks.shift();
    if (!target) break; // sin más vacías: el resto queda a continuación de la última escrita (final)
    await applySeq(tx, table, planMove(current, n.id, target));
    // Solo se retira la fila vacía si NADA la referencia (ingresos o controles vinculados a ese lote).
    const guard = table === "inv_mp_stock" ? ` and not exists (select 1 from inv_mp_ingresos i where i.payload->>'stockLotId' = '${target}') and not exists (select 1 from inv_mp_control c where c.payload->>'stockLotId' = '${target}')` : "";
    await tx.execute(sql.raw(`delete from "${table}" where id = '${target}'::uuid and (${sheetRowKindSql(table)}) = 'blank'${guard}`));
    current = await orderedRows(tx, table);
  }
}
