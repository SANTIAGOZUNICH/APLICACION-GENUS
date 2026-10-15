/**
 * Orden de carga de Materias Primas (hoja única) — columna `load_seq` (migración 0049).
 *
 * Reglas:
 *  - Las filas NUEVAS reciben `load_seq` de la base (IDENTITY): crecen siempre, sin repetirse aunque dos usuarios carguen
 *    a la vez. Editar una fila NO toca `load_seq` (el upsert solo reescribe payload/updated_at). Por eso una fila nunca se
 *    mueve por editarla, ingresar, egresar o ajustar.
 *  - Las filas HISTÓRICAS (anteriores a 0049) reciben un `load_seq` provisorio por el orden físico de la tabla, que NO es
 *    confiable (PostgreSQL mueve una fila de lugar cada vez que se actualiza). `ensureMpLoadOrderBackfill` las reordena
 *    UNA vez, de forma idempotente, con el criterio recuperable que hay en los datos: la fecha de creación registrada en
 *    el payload (`createdAt`). Filas sin esa fecha van primero (se asume que son las más antiguas) y se marcan aparte.
 *    Reordenar = permutar los `load_seq` que esas mismas filas ya tenían (ni se crean ni se pierden posiciones, y las filas
 *    nuevas quedan siempre después). No toca payload, kg, lotes, movimientos, saldos ni updated_at.
 *  - `seq_criterio`: NULL = histórica sin ordenar · 'historico:createdAt' · 'historico:sin-fecha' · 'alta' = fila nueva.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import type { DbTx } from "@/lib/db/tx-context";

/** Valor de `seq_criterio` de toda fila insertada por el código nuevo. */
export const MP_SEQ_ALTA = "alta";

export const MP_LOAD_ORDER_TABLES = ["inv_mp_stock", "inv_mp_ingresos", "inv_mp_compras", "inv_mp_control"] as const;
export type MpLoadOrderTable = (typeof MP_LOAD_ORDER_TABLES)[number];

export type MpLoadOrderBackfillResult = Record<MpLoadOrderTable, { reordenadas: number; porFecha: number; sinFecha: number }>;

const ISO_CREATED_AT = `^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T[0-9]{2}:[0-9]{2}:[0-9]{2}`;

/** Lecturas (GET): la verificación se repite a lo sumo cada 30 s por proceso; las escrituras de MP la hacen siempre. */
const CHECK_EVERY_MS = 30_000;
let lastCheckAt = 0;

/** Tests: vuelve a permitir la verificación. */
export function resetMpLoadOrderBackfillFlag() {
  lastCheckAt = 0;
}

/**
 * Reordena las filas históricas (seq_criterio NULL) de UNA tabla. Debe correr dentro de una transacción que ya tomó el
 * candado de MP. Idempotente: si no hay filas con seq_criterio NULL no hace nada.
 */
export async function backfillMpLoadOrderTable(tx: DbTx, table: MpLoadOrderTable): Promise<{ reordenadas: number; porFecha: number; sinFecha: number }> {
  const t = sql.raw(`"${table}"`);
  const pending = (await tx.execute(sql`select 1 as n from ${t} where seq_criterio is null limit 1`)) as unknown as {
    rows: Array<{ n: number }>;
  };
  if (pending.rows.length === 0) return { reordenadas: 0, porFecha: 0, sinFecha: 0 };

  // Paso 1: libera las posiciones (negativas, distintas entre sí y de cualquier positiva) para poder permutarlas sin
  // chocar con el índice único.
  await tx.execute(sql`update ${t} set load_seq = -load_seq where seq_criterio is null and load_seq > 0`);
  // Paso 2: ranking histórico (fecha de creación registrada; sin fecha primero; empate → posición provisoria) y reparto
  // de las MISMAS posiciones en ese orden.
  const res = (await tx.execute(sql`
    with h as (
      select id,
             -load_seq as orig,
             (case when (payload->>'createdAt') ~ ${ISO_CREATED_AT} then (payload->>'createdAt')::timestamptz end) as created,
             row_number() over (
               order by (case when (payload->>'createdAt') ~ ${ISO_CREATED_AT} then (payload->>'createdAt')::timestamptz end) asc nulls first,
                        -load_seq asc,
                        id asc
             ) as rn
      from ${t}
      where seq_criterio is null and load_seq < 0
    ),
    s as (select orig, row_number() over (order by orig) as rn from h)
    update ${t} x
       set load_seq = s.orig,
           seq_criterio = case when h.created is null then 'historico:sin-fecha' else 'historico:createdAt' end
      from h join s on s.rn = h.rn
     where x.id = h.id
    returning x.seq_criterio as criterio
  `)) as unknown as { rows: Array<{ criterio: string }> };
  const porFecha = res.rows.filter((r) => r.criterio === "historico:createdAt").length;
  return { reordenadas: res.rows.length, porFecha, sinFecha: res.rows.length - porFecha };
}

/** Variante dentro de una transacción ya abierta con el candado de MP (la usa `runMpInventoryOp`). */
export async function ensureMpLoadOrderBackfillInTx(tx: DbTx): Promise<MpLoadOrderBackfillResult> {
  const out = {} as MpLoadOrderBackfillResult;
  for (const table of MP_LOAD_ORDER_TABLES) out[table] = await backfillMpLoadOrderTable(tx, table);
  return out;
}

/**
 * Garantiza (como máximo cada 30 s por proceso) que las filas históricas tengan orden. Toma el mismo candado que las operaciones de MP,
 * así que nunca se cruza con una carga en curso. Sin base de datos no hace nada (el repositorio en memoria ya conserva el
 * orden de inserción).
 */
export async function ensureMpLoadOrderBackfill(): Promise<MpLoadOrderBackfillResult | null> {
  if (!isDatabaseConfigured() || Date.now() - lastCheckAt < CHECK_EVERY_MS) return null;
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('genus-mp-inventory'))`);
    return ensureMpLoadOrderBackfillInTx(tx);
  });
  lastCheckAt = Date.now();
  return result;
}
