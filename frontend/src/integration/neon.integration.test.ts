/**
 * Integración REAL contra una rama Neon DESCARTABLE. Se salta sin GENUS_IT_DATABASE_URL.
 * ⚠️ NO EJECUTADA en el entorno de desarrollo de este PR (sin acceso a Neon): ver docss/40 §7.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const URL_IT = process.env.GENUS_IT_DATABASE_URL?.trim();
const ENABLED = Boolean(URL_IT) && process.env.GENUS_IT_CONFIRM_DISPOSABLE_DB === "yes";

const produccion = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const calidad = { email: "it-cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "IT Calidad" };

describe.skipIf(!ENABLED)("Neon real: migraciones completas + persistencia + concurrencia", () => {
  let pool: import("@neondatabase/serverless").Pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_IT!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
    pool = new Pool({ connectionString: URL_IT });
    vi.resetModules();
  });
  afterAll(async () => {
    await pool?.end();
  });

  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];

  it("aplica TODAS las migraciones con el script real (2 corridas = idempotente) y crea las tablas/índices de #109", async () => {
    const script = path.resolve(__dirname, "../../scripts/migrate-if-database.mjs");
    for (let i = 0; i < 2; i += 1) {
      const r = spawnSync("node", [script], { env: { ...process.env, DATABASE_URL: URL_IT, DATABASE_URL_UNPOOLED: URL_IT }, encoding: "utf8" });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    const tables = (await q("select table_name from information_schema.tables where table_schema='public'")).map((r) => r.table_name);
    for (const t of ["asignacion_lotes", "asignacion_lotes_cell_audit", "asignacion_lotes_writeback_ops", "sheet_cell_edits"]) expect(tables).toContain(t);
    const idx = (await q("select indexname from pg_indexes where schemaname='public'")).map((r) => r.indexname);
    for (const i of ["asignacion_lotes_writeback_ops_open_uidx", "sheet_cell_edits_open_uidx", "asignacion_lotes_lote_codigo_producto_active_uidx"]) expect(idx).toContain(i);
  }, 120_000);

  it("una migración con `when` MENOR a la última aplicada es reaplicada por la reconciliación (no se saltea)", async () => {
    // Simula "otra rama con when menor mergeada después": borra la tabla y su registro, y deja una marca posterior.
    await q("drop table if exists sheet_cell_edits");
    await q('delete from "drizzle"."__drizzle_migrations" where hash = (select hash from "drizzle"."__drizzle_migrations" order by created_at desc limit 1 offset 0)');
    await q('insert into "drizzle"."__drizzle_migrations" ("hash","created_at") values ($1, $2)', ["it-future-marker", 9_999_999_999_999]);
    const script = path.resolve(__dirname, "../../scripts/migrate-if-database.mjs");
    const r = spawnSync("node", [script], { env: { ...process.env, DATABASE_URL: URL_IT, DATABASE_URL_UNPOOLED: URL_IT }, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const tables = (await q("select table_name from information_schema.tables where table_schema='public'")).map((x) => x.table_name);
    expect(tables).toContain("sheet_cell_edits");
    await q('delete from "drizzle"."__drizzle_migrations" where hash = $1', ["it-future-marker"]);
  }, 120_000);

  async function seed(lote: string) {
    const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    return getAsignacionLotesService().upsert(produccion, { lote, fecha: "2026-05-04", producto: `IT-${lote}`, codigo: "IT", cantidades: 100, updatedBy: "it" });
  }

  it("edición por celda persiste, versiona por updatedAt (date_trunc ms) y audita en la misma transacción", async () => {
    const { getAsignacionLotesService, AsignacionCellPatchError } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const svc = getAsignacionLotesService();
    const rec = await seed(`IT${Date.now()}`);
    const res = await svc.patchCells(produccion, [{ id: rec.id, field: "cantidades", value: "250", expectedVersion: rec.updatedAt }]);
    expect(res.changedCells).toBe(1);
    const row = (await q("select cantidades, producto, updated_by from asignacion_lotes where id=$1", [rec.id]))[0]!;
    expect(Number(row.cantidades)).toBe(250);
    expect(row.producto).toBe(rec.producto); // columnas vecinas intactas
    const audit = await q("select old_value, new_value, actor_email from asignacion_lotes_cell_audit where record_id=$1", [rec.id]);
    expect(audit).toEqual([{ old_value: "100", new_value: "250", actor_email: produccion.email }]);
    await expect(svc.patchCells(calidad, [{ id: rec.id, field: "cantidades", value: "1", expectedVersion: rec.updatedAt }])).rejects.toBeInstanceOf(AsignacionCellPatchError);
  });

  it("dos usuarios editan la MISMA celda a la vez: uno gana (CONFLICT al otro), sin pérdida", async () => {
    const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const svc = getAsignacionLotesService();
    const rec = await seed(`IT-C${Date.now()}`);
    const settled = await Promise.allSettled([
      svc.patchCells(produccion, [{ id: rec.id, field: "cantidades", value: "111", expectedVersion: rec.updatedAt }]),
      svc.patchCells(calidad, [{ id: rec.id, field: "cantidades", value: "222", expectedVersion: rec.updatedAt }]),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const final = Number((await q("select cantidades from asignacion_lotes where id=$1", [rec.id]))[0]!.cantidades);
    expect([111, 222]).toContain(final);
  });

  it("dos usuarios cambian la identidad de dos registros al MISMO lote: el índice único deja ganar a uno y el otro recibe DUPLICATE (no 500)", async () => {
    const { getAsignacionLotesService, AsignacionCellPatchError } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const svc = getAsignacionLotesService();
    const t = Date.now();
    const a = await svc.upsert(produccion, { lote: `IT-A${t}`, fecha: "2026-05-04", producto: "MISMO", codigo: "ID", cantidades: 1, updatedBy: "it" });
    const b = await svc.upsert(produccion, { lote: `IT-B${t}`, fecha: "2026-05-04", producto: "MISMO", codigo: "ID", cantidades: 1, updatedBy: "it" });
    const target = `IT-COMPARTIDO-${t}`;
    const settled = await Promise.allSettled([
      svc.patchCells(produccion, [{ id: a.id, field: "lote", value: target, expectedVersion: a.updatedAt }]),
      svc.patchCells(calidad, [{ id: b.id, field: "lote", value: target, expectedVersion: b.updatedAt }]),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((s) => s.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AsignacionCellPatchError);
    expect((rejected.reason as InstanceType<typeof AsignacionCellPatchError>).failures[0]!.code).toBe("DUPLICATE");
    expect(await q("select id from asignacion_lotes where lote=$1 and archived=false", [target])).toHaveLength(1);
  });

  it("lote atómico: una celda con versión vieja en el pegado revierte TODAS", async () => {
    const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const svc = getAsignacionLotesService();
    const t = Date.now();
    const a = await seed(`IT-T1${t}`);
    const b = await seed(`IT-T2${t}`);
    await svc.patchCells(produccion, [{ id: b.id, field: "cantidades", value: "5", expectedVersion: b.updatedAt }]); // b queda con versión nueva
    await expect(
      svc.patchCells(produccion, [
        { id: a.id, field: "cantidades", value: "999", expectedVersion: a.updatedAt },
        { id: b.id, field: "cantidades", value: "999", expectedVersion: b.updatedAt }, // vieja
      ])
    ).rejects.toBeTruthy();
    expect(Number((await q("select cantidades from asignacion_lotes where id=$1", [a.id]))[0]!.cantidades)).toBe(100);
  });

  it("write-back: índice único parcial impide dos operaciones abiertas sobre el mismo (registro, campo)", async () => {
    const { createOp, WritebackBusyError } = await import("@/lib/asignacion-lotes/writeback-ops");
    const base = { recordId: `rec-${Date.now()}`, lote: "L", field: "cantidades", spreadsheetId: "it", sheetTab: "T", a1: null, oldValue: "1", newValue: "2", actorEmail: "a", actorSector: "PRODUCCION", actorName: "A" };
    const settled = await Promise.allSettled([createOp({ ...base, idempotencyKey: `k1-${Date.now()}` }), createOp({ ...base, idempotencyKey: `k2-${Date.now()}` })]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect((settled.find((s) => s.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(WritebackBusyError);
  });
});
