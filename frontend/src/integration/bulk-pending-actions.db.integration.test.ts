/**
 * Acciones masivas de «Pendientes de definir» (marcar como entregados / enviar a Codificado) contra un Postgres de
 * PRUEBA real: las MISMAS funciones del flujo individual (recordDeliveryInTx / handoffToCodificadoInTx) dentro de una
 * transacción con un savepoint por trabajo.
 *  - la vista previa ejecuta el flujo real y lo revierte: no escribe nada
 *  - entrega: trabajos quedan 'entregado' con entrega, línea, evento y auditoría; no elegibles se informan sin cambios
 *  - Codificado: pasan a sector CODIFICADO con evento e historial; entregados / ya enviados quedan fuera con motivo
 *  - idempotencia por batchKey; todo-o-nada ante un fallo inesperado; sin cambios en stock MP
 * Se corre con `npm run test:e2e:semanas-priorities-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-bulk2@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Bulk 2" };
const NOTE = "IT-BULK-ACTIONS";

describe.skipIf(Boolean(PROBLEM))(`Acciones masivas de pendientes en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};
  const nid = (k: string) => `native:${ids[k]}`;
  const run = async () => (await import("@/lib/planning/bulk-pending-actions-service")).runBulkPendingAction;
  const actor = (sector = "PRODUCCION") => ({ email: prod.email, sector, displayName: prod.displayName });
  const state = async (k: string) => (await q("select operational_status, sector, via_codificado, version, deleted_at from work_items where id = $1", [ids[k]]))[0]!;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { PlanningService } = await import("@/lib/planning/planning-service");
    const { DrizzlePlanningRepository } = await import("@/lib/planning/drizzle-repository");
    const planning = new PlanningService(new DrizzlePlanningRepository());
    const weekStart = "2026-11-30";
    const existing = await planning.listWeeks(weekStart);
    const week = existing[0] ?? (await planning.createWeek({ weekStart, label: "IT bulk acciones" }, prod));
    const keys = ["d1", "d2", "d3", "yaEntregado", "noPendiente", "c1", "c2", "c3", "elab", "rb1", "rb2", "stock"];
    for (const key of keys) {
      const sector = key === "elab" ? "ELABORACION" : "ENVASADO_MASIVO";
      const it = await planning.createItem(
        week.id,
        { plannedDate: "2026-12-02", client: "IT CLIENTE", product: `PROD ${key}`, plannedQuantity: "100", unit: "un", sector, notes: NOTE, ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }) },
        prod
      );
      ids[key] = it.id;
    }
    // Pendientes de definir = terminados sin destino (revision) y publicados. noPendiente sigue en curso.
    for (const k of keys.filter((k) => k !== "noPendiente")) {
      await q("update work_items set status = 'PUBLICADO', operational_status = 'revision', completed_at = now(), finished_qty = '100' where id = $1", [ids[k]]);
    }
    await q("update work_items set status = 'PUBLICADO', operational_status = 'en_curso' where id = $1", [ids.noPendiente]);
  }, 90_000);

  afterAll(async () => {
    await q("delete from feature_audit_events where actor_email = $1", [prod.email]).catch(() => undefined);
    await q("update work_items set deleted_at = coalesce(deleted_at, now()) where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  it("vista previa de ENTREGAR ejecuta el flujo real y lo revierte: no escribe nada", async () => {
    const bulk = await run();
    const res = await bulk({ action: "DELIVER", items: [nid("d1"), nid("noPendiente"), nid("elab")].map((id) => ({ id })), actor: actor(), dryRun: true });
    const v = (k: string) => res.verdicts.find((x) => x.id === nid(k))!;
    expect(v("d1").code).toBe("ELIGIBLE");
    expect(v("d1").outcome).toMatch(/Entrega completa/);
    expect(v("noPendiente").code).toBe("NOT_PENDING");
    expect(v("elab").code).toBe("ACTION_NOT_ALLOWED");
    expect(await q("select 1 from work_item_deliveries where work_item_id = $1", [ids.d1])).toHaveLength(0);
    expect((await state("d1")).operational_status).toBe("revision");
    expect(await q("select 1 from feature_audit_events where actor_email = $1", [prod.email])).toHaveLength(0);
  });

  it("ENTREGAR en grupo: queda entregado con entrega+línea+evento+auditoría; los no elegibles no cambian", async () => {
    const bulk = await run();
    const mpTable = (await q("select to_regclass('public.mp_stock_movements') as t"))[0]!.t;
    const mpCount = async () => (mpTable ? Number((await q("select count(*)::int as n from mp_stock_movements"))[0]!.n) : 0);
    const mpBefore = await mpCount();
    const res = await bulk({
      action: "DELIVER",
      items: [nid("d1"), nid("d2"), nid("d3"), nid("noPendiente"), nid("elab")].map((id) => ({ id })),
      actor: actor(),
      batchKey: "it-bulk-deliver-1",
      delivery: { actualDeliveredAt: "2026-12-02T15:00:00.000Z", remito: "R-IT-1", receivedBy: "Cliente IT", observations: "lote masivo" },
    });
    expect(res.succeeded.sort()).toEqual([nid("d1"), nid("d2"), nid("d3")].sort());
    for (const k of ["d1", "d2", "d3"]) {
      expect((await state(k)).operational_status).toBe("entregado");
      const [d] = await q("select status, delivery_complete, remito, received_by, delivered_by, delivered_by_sector from work_item_deliveries where work_item_id = $1", [ids[k]]);
      expect(d).toMatchObject({ status: "ENTREGADO", delivery_complete: true, remito: "R-IT-1", received_by: "Cliente IT", delivered_by_sector: "PRODUCCION" });
      expect(await q("select 1 from work_item_delivery_lines where work_item_id = $1 and status = 'ACTIVA'", [ids[k]])).toHaveLength(1);
      expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'WORK_DELIVERED'", [ids[k]])).toHaveLength(1);
    }
    expect((await state("noPendiente")).operational_status).toBe("en_curso");
    expect((await state("elab")).operational_status).toBe("revision");
    expect(await q("select 1 from work_item_deliveries where work_item_id = any($1)", [[ids.noPendiente, ids.elab]])).toHaveLength(0);
    const audit = await q("select payload, actor_sector from feature_audit_events where action = 'BULK_DELIVER' and idempotency_key = 'it-bulk-deliver-1'");
    expect(audit).toHaveLength(1);
    expect((audit[0]!.payload as { succeededCount: number }).succeededCount).toBe(3);
    // ni un solo movimiento de stock de MP por estas entregas
    expect(await mpCount()).toBe(mpBefore);
  });

  it("idempotente: repetir con la misma batchKey no duplica entregas ni eventos; ya entregado queda fuera con motivo", async () => {
    const bulk = await run();
    const again = await bulk({ action: "DELIVER", items: [nid("d1"), nid("d2"), nid("d3")].map((id) => ({ id })), actor: actor(), batchKey: "it-bulk-deliver-1" });
    expect(again.replayed).toBe(true);
    expect(await q("select 1 from work_item_delivery_lines where work_item_id = $1", [ids.d1])).toHaveLength(1);
    expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'WORK_DELIVERED'", [ids.d1])).toHaveLength(1);
    // otra operación sobre ya entregados: ya no son pendientes → motivo, sin cambios
    const other = await bulk({ action: "DELIVER", items: [{ id: nid("d1") }], actor: actor(), batchKey: "it-bulk-deliver-2" });
    expect(other.verdicts[0]!.code).toBe("NOT_PENDING");
    expect(other.succeeded).toEqual([]);
    expect(await q("select 1 from work_item_delivery_lines where work_item_id = $1", [ids.d1])).toHaveLength(1);
  });

  it("ENVIAR A CODIFICADO en grupo: quedan en Codificado con historial; entregados y no pendientes fuera con motivo", async () => {
    const bulk = await run();
    const preview = await bulk({ action: "SEND_CODIFICADO", items: [nid("c1"), nid("c2"), nid("d2"), nid("elab")].map((id) => ({ id, totalUnits: 100 })), actor: actor(), dryRun: true });
    expect(preview.verdicts.find((v) => v.id === nid("c1"))!.code).toBe("ELIGIBLE");
    expect(preview.verdicts.find((v) => v.id === nid("d2"))!.code).toBe("NOT_PENDING");
    expect(preview.verdicts.find((v) => v.id === nid("elab"))!.code).toBe("ACTION_NOT_ALLOWED");
    expect((await state("c1")).sector).toBe("ENVASADO_MASIVO");

    const res = await bulk({
      action: "SEND_CODIFICADO",
      items: [{ id: nid("c1"), totalUnits: 100 }, { id: nid("c2"), totalUnits: 80 }, { id: nid("d2") }, { id: nid("elab") }],
      actor: actor(),
      batchKey: "it-bulk-codif-1",
      observation: "para codificar",
    });
    expect(res.succeeded.sort()).toEqual([nid("c1"), nid("c2")].sort());
    for (const k of ["c1", "c2"]) {
      const s = await state(k);
      expect(s).toMatchObject({ sector: "CODIFICADO", via_codificado: true, operational_status: "en_curso" });
      expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'SENT_TO_CODIFICADO'", [ids[k]])).toHaveLength(1);
    }
    expect(String((await q("select packaging_total_units from work_items where id = $1", [ids.c2]))[0]!.packaging_total_units)).toBe("80");
    expect((await state("d2")).sector).toBe("ENVASADO_MASIVO"); // el entregado no se movió
    expect((await state("elab")).sector).toBe("ELABORACION");
    // reintento con la misma batchKey: replay, sin duplicar eventos
    const again = await bulk({ action: "SEND_CODIFICADO", items: [{ id: nid("c1"), totalUnits: 100 }], actor: actor(), batchKey: "it-bulk-codif-1" });
    expect(again.replayed).toBe(true);
    expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'SENT_TO_CODIFICADO'", [ids.c1])).toHaveLength(1);
    // un trabajo ya en Codificado ya no es «pendiente de definir con esa acción»: no se reenvía
    const second = await bulk({ action: "SEND_CODIFICADO", items: [{ id: nid("c1"), totalUnits: 100 }], actor: actor(), batchKey: "it-bulk-codif-2" });
    expect(second.succeeded).toEqual([]);
    expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'SENT_TO_CODIFICADO'", [ids.c1])).toHaveLength(1);
  });

  it("una cantidad inválida rechaza SOLO ese trabajo (savepoint) y los demás se procesan", async () => {
    const bulk = await run();
    const res = await bulk({
      action: "SEND_CODIFICADO",
      items: [{ id: nid("c3"), totalUnits: 999999 }, { id: nid("stock"), totalUnits: 100 }],
      actor: actor(),
      batchKey: "it-bulk-codif-3",
    });
    const bad = res.verdicts.find((v) => v.id === nid("c3"))!;
    expect(bad.code).toBe("REJECTED");
    expect(bad.reason).toMatch(/supera la cantidad disponible/);
    expect((await state("c3")).sector).toBe("ENVASADO_MASIVO");
    expect((await state("stock")).sector).toBe("CODIFICADO");
  });

  it("permisos: otros sectores no pueden usar el servicio", async () => {
    const bulk = await run();
    for (const s of ["ELABORACION", "ENVASADO_MASIVO", "CODIFICADO", "CALIDAD"]) {
      await expect(bulk({ action: "DELIVER", items: [{ id: nid("rb1") }], actor: actor(s), batchKey: "it-bulk-perm-1" })).rejects.toThrow(/Solo Producción/);
    }
    expect((await state("rb1")).operational_status).toBe("revision");
  });

  it("todo-o-nada: un error INESPERADO a mitad del lote revierte todos los trabajos y la auditoría", async () => {
    await q(`create or replace function it_bulk2_fail() returns trigger language plpgsql as $$ begin if new.work_item_id = '${ids.rb2}'::uuid and new.type = 'WORK_DELIVERED' then raise exception 'falla simulada'; end if; return new; end $$`);
    await q("create trigger it_bulk2_fail_trg before insert on operational_events for each row execute function it_bulk2_fail()");
    try {
      const bulk = await run();
      await expect(
        bulk({ action: "DELIVER", items: [nid("rb1"), nid("rb2")].map((id) => ({ id })), actor: actor(), batchKey: "it-bulk-rollback" })
      ).rejects.toThrow();
      for (const k of ["rb1", "rb2"]) {
        expect((await state(k)).operational_status).toBe("revision");
        expect(await q("select 1 from work_item_deliveries where work_item_id = $1", [ids[k]])).toHaveLength(0);
      }
      expect(await q("select 1 from feature_audit_events where idempotency_key = 'it-bulk-rollback'")).toHaveLength(0);
    } finally {
      await q("drop trigger if exists it_bulk2_fail_trg on operational_events");
      await q("drop function if exists it_bulk2_fail()");
    }
  });
});
