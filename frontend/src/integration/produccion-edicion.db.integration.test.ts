/**
 * Producción edita la planificación de los trabajos de cada sector — contra un Postgres de PRUEBA real (mismo SQL que
 * Neon): las MISMAS funciones que usan las tarjetas (PATCH /api/v1/work-items/cells) y Asignación de lotes.
 *  - corrección autorizada de la cantidad realizada (motivo, versión, valor visto, auditoría; no es un avance)
 *  - trabajos ya informados por el sector: se corrigen solo CON motivo
 *  - lote/VTO del trabajo: asignar, corregir y desasignar con motivo (auditado); decidido por Calidad → bloqueado
 *  - Asignación de lotes: edición por formulario auditada y con control de concurrencia, historial, lote ya aprobado
 *    no se sobrescribe, operarios sin permiso
 *  - avances y finalizaciones del sector siguen funcionando después
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const NOTE = "IT-PROD-EDIT";

describe.skipIf(Boolean(PROBLEM))(`Producción edita planificación en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};
  const version = async (id: string) => Number((await q("select version from work_items where id = $1", [id]))[0]!.version);
  const cells = async () => (await import("@/lib/planning/work-item-cells-service")).applyWorkItemCellChanges;
  const repo = async () => import("@/lib/planning/work-item-progress-repository");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const svc = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2026-11-02";
    const existing = await svc.listWeeks(weekStart);
    const week = existing[0] ?? (await svc.createWeek({ weekStart, label: "IT edición" }, prod));
    const mk = async (key: string, sector: "ELABORACION" | "ENVASADO_MASIVO", product: string, extra: Record<string, string> = {}) => {
      const it = await svc.createItem(week.id, { plannedDate: "2026-11-04", client: "IT CLIENTE", product, plannedQuantity: "500", unit: sector === "ELABORACION" ? "kg" : "un", sector, notes: NOTE, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }), ...extra }, prod);
      ids[key] = it.id;
    };
    await mk("elab", "ELABORACION", "CREMA IT");
    await mk("env", "ENVASADO_MASIVO", "SHAMPOO IT");
    await mk("aprobado", "ENVASADO_MASIVO", "ACONDICIONADOR IT");
    await q("update work_items set packaging_lote = 'IT-L-APROB', quality_status = 'aprobado' where id = $1", [ids.aprobado]);
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await q("delete from asignacion_lotes_cell_audit where lote like 'IT-L-%'").catch(() => undefined);
    await q("delete from asignacion_lotes where lote like 'IT-L-%'").catch(() => undefined);
    await pool?.end();
  });

  it("cantidad realizada: Producción la CORRIGE con motivo, versión y valor visto; queda auditada y no es un avance", async () => {
    const { saveWorkProgressDurable } = await repo();
    const apply = await cells();
    await saveWorkProgressDurable(ids.env, { finishedQty: "480", observation: "Avance del sector", updatedBy: "IT Envasado", sector: "ENVASADO_MASIVO" }, "ENVASADO_MASIVO");
    const [before] = await q("select operational_status, progress_updated_by from work_items where id = $1", [ids.env]);
    const v = await version(ids.env);
    const id = `native:${ids.env}`;
    // sin motivo → no se escribe
    expect((await apply(prod, [{ id, field: "finishedQty", value: "500", expectedVersion: v, expectedValue: "480" }])).results[0]).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    // el sector registró otro avance mientras Producción miraba 470 → conflicto, nada se pisa
    expect((await apply(prod, [{ id, field: "finishedQty", value: "500", expectedVersion: v, expectedValue: "470", reason: "Conteo físico corregido" }])).results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    const ok = await apply(prod, [{ id, field: "finishedQty", value: "500", expectedVersion: v, expectedValue: "480", reason: "Conteo físico corregido" }]);
    expect(ok.ok).toBe(true);
    const [after] = await q("select finished_qty, operational_status, progress_updated_by, version from work_items where id = $1", [ids.env]);
    expect(after).toMatchObject({ finished_qty: "500", operational_status: before!.operational_status, progress_updated_by: before!.progress_updated_by });
    expect(Number(after!.version)).toBe(v + 1);
    const ev = await q("select from_status, to_status, note, actor_sector, actor_email from operational_events where work_item_id = $1 and type = 'FINISHED_QTY_CORRECTED'", [ids.env]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ note: "Conteo físico corregido", actor_sector: "PRODUCCION" });
    expect(String(ev[0]!.from_status)).toContain("480");
    expect(String(ev[0]!.to_status)).toContain("500");
    // un operario no puede corregir (ni por la misma API)
    await expect(apply({ ...prod, sector: "ENVASADO_MASIVO" }, [{ id, field: "finishedQty", value: "1", expectedVersion: v + 1, expectedValue: "500", reason: "Intento del sector" }])).rejects.toThrow(/Solo Producción/);
  });

  it("lote / VTO del trabajo: asignar, corregir y desasignar con motivo (auditado); versión vieja → conflicto", async () => {
    const apply = await cells();
    const id = `native:${ids.env}`;
    const v = await version(ids.env);
    expect((await apply(prod, [{ id, field: "packagingLote", value: "IT-L-0001", expectedVersion: v, reason: "Asignación de lote" }])).ok).toBe(true);
    expect((await apply(prod, [{ id, field: "packagingVto", value: "30/11/2028", expectedVersion: v + 1, reason: "Vencimiento del lote" }])).ok).toBe(true);
    expect((await apply(prod, [{ id, field: "packagingLote", value: "IT-L-0002", expectedVersion: v + 1, reason: "Reasignación" }])).results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    expect((await apply(prod, [{ id, field: "packagingLote", value: "IT-L-0002", expectedVersion: v + 2, reason: "Reasignación de lote" }])).ok).toBe(true);
    expect((await apply(prod, [{ id, field: "packagingLote", value: "", expectedVersion: v + 3, reason: "Desasignar: lote equivocado" }])).ok).toBe(true);
    const [row] = await q("select packaging_lote, packaging_vto from work_items where id = $1", [ids.env]);
    expect(row).toMatchObject({ packaging_lote: null, packaging_vto: "2028-11-30" });
    const ev = await q("select note from operational_events where work_item_id = $1 and type = 'LOTE_VTO_CORRECTED' order by created_at", [ids.env]);
    expect(ev.map((e) => e.note)).toEqual(["Asignación de lote", "Vencimiento del lote", "Reasignación de lote", "Desasignar: lote equivocado"]);
  });

  it("trabajo informado por el sector: Producción corrige SOLO con motivo; decidido por Calidad → bloqueado con el procedimiento", async () => {
    const { completeWorkDurable } = await repo();
    const apply = await cells();
    await completeWorkDurable(ids.elab, { finishedQty: "500", observation: "Terminado IT", completedBy: "IT Elaboración" }, "ELABORACION");
    const [st] = await q("select operational_status from work_items where id = $1", [ids.elab]);
    const v = await version(ids.elab);
    const id = `native:${ids.elab}`;
    expect((await apply(prod, [{ id, field: "notes", value: "Corrección", expectedVersion: v }], "2026-11-01")).results[0]).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    const ok = await apply(prod, [{ id, field: "plannedQuantity", value: "520", expectedVersion: v, reason: "Se planificó mal la cantidad" }], "2026-11-01");
    expect(ok.ok).toBe(true);
    const [row] = await q("select planned_quantity, operational_status from work_items where id = $1", [ids.elab]);
    expect(row).toMatchObject({ planned_quantity: "520", operational_status: st!.operational_status });
    const blocked = await apply(prod, [{ id: `native:${ids.aprobado}`, field: "packagingLote", value: "OTRO", expectedVersion: await version(ids.aprobado), reason: "Intento sobre aprobado" }]);
    expect(blocked.results[0]).toMatchObject({ ok: false, code: "PROTECTED" });
    expect((blocked.results[0] as { message: string }).message).toMatch(/anulá la decisión de Calidad/);
  });

  it("avances y finalizaciones del sector siguen funcionando después de las ediciones de Producción", async () => {
    const { saveWorkProgressDurable, completeWorkDurable } = await repo();
    await saveWorkProgressDurable(ids.env, { finishedQty: "510", observation: "Avance posterior", updatedBy: "IT Envasado", sector: "ENVASADO_MASIVO" }, "ENVASADO_MASIVO");
    await completeWorkDurable(ids.env, { finishedQty: "510", observation: "Terminado", completedBy: "IT Envasado" }, "ENVASADO_MASIVO");
    const [row] = await q("select finished_qty, operational_status from work_items where id = $1", [ids.env]);
    expect(row!.finished_qty).toBe("510");
    expect(String(row!.operational_status)).not.toBe("pendiente");
  });

  it("Asignación de lotes: formulario auditado con concurrencia, historial, lote aprobado protegido, operario sin permiso", async () => {
    const { getAsignacionLotesService } = await import("@/lib/asignacion-lotes/asignacion-lotes-service");
    const svc = getAsignacionLotesService();
    const base = { fecha: "2026-11-01", producto: "SHAMPOO IT", codigo: "IT-01", marca: "IT", cantidades: 1000, vto: "2028-11-01", updatedBy: "IT Producción" };
    const created = await svc.upsert(prod, { ...base, lote: "IT-L-0100" });
    const edited = await svc.upsert(prod, { ...base, id: created.id, lote: "IT-L-0100", cantidades: 1200, vto: "2028-12-01", expectedUpdatedAt: created.updatedAt });
    expect(edited.cantidades).toBe(1200);
    // versión vieja: no pisa
    await expect(svc.upsert(prod, { ...base, id: created.id, lote: "IT-L-0100", cantidades: 900, expectedUpdatedAt: created.updatedAt })).rejects.toThrow(/conflicto de versión/);
    const history = await svc.history(prod, created.id);
    const changes = history.filter((h) => h.kind === "CHANGE");
    expect(changes.map((c) => (c as { field: string }).field).sort()).toEqual(["cantidades", "vto"]);
    expect(changes[0]).toMatchObject({ origin: "FORM", actorSector: "PRODUCCION" });
    expect(history.at(-1)).toMatchObject({ kind: "CREATED", origin: "MANUAL" });
    // lote ya aprobado en un trabajo: su trazabilidad no se sobrescribe; observaciones sí
    const used = await svc.upsert(prod, { ...base, lote: "IT-L-APROB", producto: "ACONDICIONADOR IT", codigo: "IT-02" });
    await expect(svc.upsert(prod, { ...base, id: used.id, lote: "IT-L-APROB", producto: "ACONDICIONADOR IT", codigo: "IT-02", vto: "2029-01-01", expectedUpdatedAt: used.updatedAt })).rejects.toThrow(/no se sobrescribe/i);
    await expect(svc.patchCells(prod, [{ id: used.id, field: "vto", value: "2029-01-01", expectedVersion: used.updatedAt }])).rejects.toThrow();
    const okObs = await svc.patchCells(prod, [{ id: used.id, field: "observaciones", value: "Observación IT", expectedVersion: used.updatedAt }]);
    expect(okObs.changedCells).toBe(1);
    // operario de Envasado: sin permiso de modificar lotes
    await expect(svc.upsert({ ...prod, sector: "ENVASADO_MASIVO" } as never, { ...base, id: created.id, lote: "IT-L-0100", cantidades: 1 })).rejects.toThrow();
  });
});
