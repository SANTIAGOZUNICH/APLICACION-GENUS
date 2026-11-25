/**
 * Verificación de consistencia de ingresos por remito — SOLO LECTURA (no escribe nada, no mueve stock).
 * Cruza las recepciones (`inventory_receipts` + renglones), los ingresos de la planilla (`inv_me_ingresos` / `inv_mp_ingresos`) y las fotos
 * (`inventory_ingreso_adjuntos`) para detectar: renglones cuyo ingreso no existe, recepciones sin renglones, fotos huérfanas y recepciones sin foto.
 * Devuelve cantidades e ids (nunca contenido de remitos ni claves).
 */
import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import type { ReceiptModule } from "./receipt-rules";

export type IngresoConsistency = {
  module: ReceiptModule;
  ok: boolean;
  totals: { ingresosEnPlanilla: number; recepcionesEnPlanilla: number; recepcionesBorrador: number; fotosActivas: number };
  problems: {
    /** Renglones de una recepción ya pasada a la planilla cuyo ingreso NO existe en la planilla. */
    ingresosFaltantes: Array<{ receiptId: string; ingresoId: string }>;
    /** Recepciones pasadas a la planilla sin ningún renglón registrado. */
    recepcionesSinRenglones: string[];
    /** Fotos activas de una recepción que ya no existe. */
    fotosHuerfanas: Array<{ fotoId: string; receiptId: string }>;
    /** Recepciones pasadas a la planilla sin ninguna foto (informativo: puede ser carga manual sin foto). */
    recepcionesSinFoto: string[];
  };
};

export async function ingresoConsistency(module: ReceiptModule): Promise<IngresoConsistency> {
  const db = getDb();
  const table = module === "ME" ? sql.raw("inv_me_ingresos") : sql.raw("inv_mp_ingresos");
  const num = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as { n: number | string }).n);
  const rows = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];
  const done = sql`r.status in ('EN_PLANILLA', 'CONFIRMADO')`;
  const [ingresosEnPlanilla, recepcionesEnPlanilla, recepcionesBorrador, fotosActivas] = await Promise.all([
    num(sql`select count(*)::int n from ${table}`),
    num(sql`select count(*)::int n from inventory_receipts r where r.module = ${module} and ${done}`),
    num(sql`select count(*)::int n from inventory_receipts r where r.module = ${module} and r.status = 'BORRADOR'`),
    num(sql`select count(*)::int n from inventory_ingreso_adjuntos a where a.module = ${module} and a.deleted_at is null`),
  ]);
  const [faltantes, sinRenglones, huerfanas, sinFoto] = await Promise.all([
    rows<{ receipt_id: string; ingreso_id: string }>(sql`
      select l.receipt_id::text as receipt_id, l.ingreso_id::text as ingreso_id
        from inventory_receipt_lines l join inventory_receipts r on r.id = l.receipt_id
       where r.module = ${module} and ${done} and l.ingreso_id is not null
         and not exists (select 1 from ${table} i where i.id = l.ingreso_id)
       limit 200`),
    rows<{ id: string }>(sql`
      select r.id::text as id from inventory_receipts r
       where r.module = ${module} and ${done} and not exists (select 1 from inventory_receipt_lines l where l.receipt_id = r.id)
       limit 200`),
    rows<{ foto_id: string; receipt_id: string }>(sql`
      select a.id::text as foto_id, a.receipt_id::text as receipt_id from inventory_ingreso_adjuntos a
       where a.module = ${module} and a.deleted_at is null and a.receipt_id is not null
         and not exists (select 1 from inventory_receipts r where r.id = a.receipt_id)
       limit 200`),
    rows<{ id: string }>(sql`
      select r.id::text as id from inventory_receipts r
       where r.module = ${module} and ${done}
         and not exists (select 1 from inventory_ingreso_adjuntos a where a.receipt_id = r.id and a.deleted_at is null)
       limit 200`),
  ]);
  const problems = {
    ingresosFaltantes: faltantes.map((r) => ({ receiptId: r.receipt_id, ingresoId: r.ingreso_id })),
    recepcionesSinRenglones: sinRenglones.map((r) => r.id),
    fotosHuerfanas: huerfanas.map((r) => ({ fotoId: r.foto_id, receiptId: r.receipt_id })),
    recepcionesSinFoto: sinFoto.map((r) => r.id),
  };
  // «Sin foto» es informativo (carga manual): no marca la inconsistencia.
  const ok = problems.ingresosFaltantes.length === 0 && problems.recepcionesSinRenglones.length === 0 && problems.fotosHuerfanas.length === 0;
  return { module, ok, totals: { ingresosEnPlanilla, recepcionesEnPlanilla, recepcionesBorrador, fotosActivas }, problems };
}
