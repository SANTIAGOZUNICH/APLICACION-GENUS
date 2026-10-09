/**
 * 0043 — Lotes sincronizados desde Google editables en GENUS, contra un Postgres de PRUEBA real (mismo SQL que Neon):
 * la migración es aditiva e idempotente, el sync (misma función que usa el motor de sincronización) no pisa lo editado,
 * detecta conflictos, no duplica ni archiva al corregir la identidad, la decisión queda auditada y la concurrencia se
 * respeta. Nunca se usa Google: el «sync» llama a upsertFromSource con filas como las de la planilla.
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const calidad = { email: "it-cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "IT Calidad" };
const SYNC = { email: "sync@genus", displayName: "Sync" };
const SRC = "it-src-0043";
const row = (over: Record<string, unknown> = {}) => ({ lote: "IT-LE-001", fecha: "2026-08-03", producto: "CREMA IT", codigo: "IT-C1", marca: "MARCA IT", cantidades: 500, vto: "2028-08-01", updatedBy: "Sync", ...over });

describe.skipIf(Boolean(PROBLEM))(`Asignación de lotes: ediciones de GENUS sobre filas de Google (0043)${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => (await import("@/lib/asignacion-lotes/asignacion-lotes-service")).getAsignacionLotesService();
  const find = async (id: string) => (await (await svc()).list(prod, { includeArchived: true })).find((r) => r.id === id)!;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await q("delete from asignacion_lotes_local_edits where record_id in (select id from asignacion_lotes where lote like 'IT-LE-%')");
    await q("delete from asignacion_lotes_cell_audit where lote like 'IT-LE-%'");
    await q("delete from asignacion_lotes where lote like 'IT-LE-%'");
    // Fuente de PRUEBA (planilla inexistente, sin escritura): nunca se llama a Google en este test.
    await q("insert into asignacion_lote_sources (id, name, spreadsheet_id, enabled) values ($1, 'Planilla IT', 'it-no-es-una-planilla', false) on conflict (id) do nothing", [SRC]);
  }, 60_000);

  afterAll(async () => {
    await q("delete from asignacion_lotes_local_edits where record_id in (select id from asignacion_lotes where lote like 'IT-LE-%')").catch(() => undefined);
    await q("delete from asignacion_lotes_cell_audit where lote like 'IT-LE-%'").catch(() => undefined);
    await q("delete from asignacion_lotes where lote like 'IT-LE-%'").catch(() => undefined);
    await pool?.end();
  });

  it("la migración 0043 es aditiva e idempotente (se aplica dos veces sin error ni pérdida)", async () => {
    const before = Number((await q("select count(*)::int n from asignacion_lotes"))[0]!.n);
    const sqlText = readFileSync("drizzle/0043_asignacion_lotes_local_edits.sql", "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect(Number((await q("select count(*)::int n from asignacion_lotes"))[0]!.n)).toBe(before);
    const cols = (await q("select column_name from information_schema.columns where table_name = 'asignacion_lotes' and column_name like 'source_%'")).map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(["source_lote", "source_codigo", "source_producto"]));
  });

  it("editar una fila de Google, recargar (otra instancia) y re-sincronizar: el valor de GENUS persiste y queda auditado", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row(), "AGOSTO");
    await s.patchCells(prod, [{ id: record.id, field: "cantidades", value: "640", expectedVersion: record.updatedAt, reason: "Recuento físico" }]);
    vi.resetModules(); // "recargar": otra instancia del módulo lee de la base
    const s2 = await svc();
    await s2.upsertFromSource(SRC, SYNC, row({ marca: "MARCA IT 2" }), "AGOSTO");
    const r = await find(record.id);
    expect(r.cantidades).toBe(640);
    expect(r.marca).toBe("MARCA IT 2");
    expect(r.localEdits?.cantidades).toMatchObject({ status: "ACTIVE", sheetValue: "500", localValue: "640" });
    const audit = await q("select old_value, new_value, reason, actor_sector from asignacion_lotes_cell_audit where record_id = $1 and field = 'cantidades'", [record.id]);
    expect(audit[0]).toMatchObject({ old_value: "500", new_value: "640", reason: "Recuento físico", actor_sector: "PRODUCCION" });
  });

  it("la planilla cambia el mismo dato → CONFLICTO; decidir «usar planilla» lo aplica con auditoría y vuelve a sincronizar", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-002" }), "AGOSTO");
    await s.patchCells(calidad, [{ id: record.id, field: "vto", value: "2028-09-01", expectedVersion: record.updatedAt }]);
    await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-002", vto: "2028-10-01" }), "AGOSTO");
    let r = await find(record.id);
    expect(r.vto).toBe("2028-09-01");
    expect(r.localEdits?.vto).toMatchObject({ status: "CONFLICT", conflictSheetValue: "2028-10-01" });
    // decisión con versión vieja → rechazada
    await expect(s.resolveLocalEdit(prod, { editId: r.localEdits!.vto!.id, action: "USE_SHEET", expectedVersion: record.updatedAt })).rejects.toThrow(/conflicto de versión/);
    await s.resolveLocalEdit(prod, { editId: r.localEdits!.vto!.id, action: "USE_SHEET", expectedVersion: r.updatedAt });
    r = await find(record.id);
    expect(r.vto).toBe("2028-10-01");
    expect(r.localEdits).toBeUndefined();
    const closed = await q("select resolution, resolved_by from asignacion_lotes_local_edits where record_id = $1 and field = 'vto'", [record.id]);
    expect(closed[0]).toMatchObject({ resolution: "USE_SHEET", resolved_by: prod.email });
  });

  it("corregir el lote en GENUS no duplica ni archiva en el próximo sync (identidad de origen guardada)", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-003" }), "AGOSTO");
    await s.patchCells(prod, [{ id: record.id, field: "lote", value: "IT-LE-003-B", expectedVersion: record.updatedAt }]);
    const res = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-003" }), "AGOSTO");
    expect(res.record.id).toBe(record.id);
    expect(res.created).toBe(false);
    const rows = await q("select id, lote, source_lote, archived from asignacion_lotes where lote like 'IT-LE-003%'");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lote: "IT-LE-003-B", source_lote: "IT-LE-003", archived: false });
  });

  it("dos ediciones simultáneas de la misma celda: una gana, la otra recibe conflicto (sin escritura perdida)", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-004" }), "AGOSTO");
    const results = await Promise.allSettled([
      s.patchCells(prod, [{ id: record.id, field: "cantidades", value: "701", expectedVersion: record.updatedAt }]),
      s.patchCells(calidad, [{ id: record.id, field: "cantidades", value: "702", expectedVersion: record.updatedAt }]),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const open = await q("select count(*)::int n from asignacion_lotes_local_edits where record_id = $1 and resolved_at is null", [record.id]);
    expect(open[0]!.n).toBe(1);
  });

  it("fila que desaparece de la planilla con ediciones: no se archiva sola; archivar en GENUS no la revive el sync", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-005" }), "AGOSTO");
    await s.patchCells(prod, [{ id: record.id, field: "observaciones", value: "Revisado", expectedVersion: record.updatedAt }]);
    expect(await s.archiveRemovedFromSource(record.id, "Planilla IT")).toBe("kept_local_edits");
    expect((await find(record.id)).archived).toBeFalsy();
    const { record: other } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-006" }), "AGOSTO");
    await s.delete(prod, other.id, "Cargado por error");
    await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-006" }), "AGOSTO");
    expect((await find(other.id)).archived).toBe(true);
  });

  it("permisos: Codificado no edita cantidades; un sector sin acceso al módulo no edita nada", async () => {
    const s = await svc();
    const { record } = await s.upsertFromSource(SRC, SYNC, row({ lote: "IT-LE-007" }), "AGOSTO");
    await expect(s.patchCells({ ...prod, sector: "CODIFICADO" } as never, [{ id: record.id, field: "cantidades", value: "1", expectedVersion: record.updatedAt }])).rejects.toThrow();
    await expect(s.patchCells({ ...prod, sector: "ENVASADO_MASIVO" } as never, [{ id: record.id, field: "observaciones", value: "x", expectedVersion: record.updatedAt }])).rejects.toThrow();
    expect((await find(record.id)).cantidades).toBe(500);
  });
});
