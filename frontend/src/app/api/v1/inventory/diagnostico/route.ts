import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { inventoryErrorResponse, resolveInventoryActor } from "@/lib/inventory/http";
import { canReadInventory, canWriteInventory } from "@/lib/inventory/rbac";
import { sheetRowKindSql } from "@/lib/inventory/sheet-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLES = ["inv_mp_stock", "inv_mp_ingresos", "inv_me_ingresos", "inv_me_salidas", "inv_me_materials"] as const;
const rows = (r: unknown) => (r as { rows: Array<Record<string, unknown>> }).rows;

/**
 * DIAGNÓSTICO de solo lectura (no modifica nada): qué versión sirve esta instancia, qué permisos tiene el usuario, si las
 * columnas de orden existen en la base y dónde estaría la «primera fila vacía» de Stock MP / Ingresos MP según el servidor.
 * Abrir con la sesión iniciada: /api/v1/inventory/diagnostico
 */
export async function GET(request: Request) {
  try {
    const actor = await resolveInventoryActor(request);
    if (!actor.isSuperadmin && !canReadInventory(actor.sector, "mp_stock") && !canReadInventory(actor.sector, "me_stock")) {
      return NextResponse.json({ error: "Sin permiso de lectura." }, { status: 403 });
    }
    const out: Record<string, unknown> = {
      version: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
        entorno: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
        deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        region: process.env.VERCEL_REGION ?? null,
      },
      usuario: {
        email: actor.email,
        sector: actor.sector,
        superadmin: Boolean(actor.isSuperadmin),
        puedeEscribir: Object.fromEntries(
          (["mp_stock", "mp_ingresos", "me_ingresos", "me_salidas", "me_stock"] as const).map((m) => [m, Boolean(actor.isSuperadmin) || canWriteInventory(actor.sector, m)])
        ),
      },
      baseDeDatos: isDatabaseConfigured(),
    };
    if (isDatabaseConfigured()) {
      const db = getDb();
      const cols = rows(
        await db.execute(sql.raw(`select table_name, column_name from information_schema.columns where table_name in (${TABLES.map((t) => `'${t}'`).join(",")}) and column_name in ('load_seq','seq_criterio')`))
      );
      const tablas: Record<string, unknown> = {};
      for (const t of TABLES) {
        const c = rows(await db.execute(sql.raw(`select count(*)::int as total from "${t}"`)))[0];
        const tiene = cols.filter((x) => x.table_name === t).map((x) => x.column_name);
        let sinOrden: number | null = null;
        if (tiene.includes("seq_criterio")) sinOrden = Number(rows(await db.execute(sql.raw(`select count(*)::int as n from "${t}" where seq_criterio is null`)))[0]?.n ?? 0);
        tablas[t] = { filas: c?.total, columnasDeOrden: tiene, filasHistoricasSinOrdenar: sinOrden };
      }
      out.tablas = tablas;
      try {
        const m = rows(await db.execute(sql.raw(`select count(*)::int as aplicadas from drizzle.__drizzle_migrations`)))[0];
        out.migracionesAplicadas = m?.aplicadas ?? null;
      } catch {
        out.migracionesAplicadas = "no se pudo leer drizzle.__drizzle_migrations";
      }
      for (const [key, table] of [["stockMp", "inv_mp_stock"], ["ingresosMp", "inv_mp_ingresos"]] as const) {
        const list = rows(
          await db.execute(
            sql.raw(`select (${sheetRowKindSql(table)}) as kind, array(select k from jsonb_object_keys(payload) k where nullif(btrim(payload->>k), '') is not null and k not in ('id','createdBy','updatedBy','createdAt','updatedAt')) as llenas from "${table}" order by load_seq asc`)
          )
        ) as Array<{ kind: "hidden" | "blank" | "data"; llenas: string[] }>;
        const visibles = list.filter((r) => r.kind !== "hidden");
        let ultima = -1;
        visibles.forEach((r, i) => { if (r.kind === "data") ultima = i; });
        const cola = visibles.slice(ultima + 1).filter((r) => r.kind === "blank").length;
        out[key] = {
          totalEnBase: list.length,
          ocultas: list.length - visibles.length,
          posicionesVisibles: visibles.length,
          ultimaFilaConDatos: ultima + 1,
          vaciasPersistidasDespuesDeLaUltima: cola,
          proximoIngresoOcuparia: ultima + 2,
          ultimasFilasConDatos: visibles.slice(Math.max(0, ultima - 1), ultima + 1).map((r) => r.llenas),
          primerasFilasDespuesDeLaUltima: visibles.slice(ultima + 1, ultima + 4).map((r) => ({ clasificada: r.kind, columnasConContenido: r.llenas })),
        };
      }
    }
    out.rutasDeCreacion = "Todas las altas de Stock MP / Ingresos MP (manual, foto/remito, Excel, carga directa) pasan por runMpInventoryOp → placeNewRowsAfterLastWritten.";
    return NextResponse.json(out);
  } catch (err) {
    return inventoryErrorResponse(err);
  }
}
