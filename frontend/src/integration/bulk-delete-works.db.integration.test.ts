/**
 * Eliminación masiva de trabajos (Producción) contra un Postgres de PRUEBA real (mismo SQL que Neon):
 *  - dry-run no escribe nada; veredictos por trabajo con motivo
 *  - elimina de forma LÓGICA (nunca borra la fila ni cascada a entregas), con evento por trabajo y auditoría del lote
 *  - protege historial: entregado / con entregas / en remito quedan intactos y se informan
 *  - idempotente por batchKey; ya eliminados no se vuelven a tocar; conflicto de versión
 *  - todo-o-nada: si la escritura falla a mitad, no queda nada a medias
 *  - no toca stock de MP, movimientos ni entregas
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:semanas-priorities-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-bulk@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Bulk" };
const NOTE = "IT-BULK-DELETE";

describe.skipIf(Boolean(PROBLEM))(`Eliminación masiva de trabajos en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: Record<string, string> = {};
  const nid = (k: string) => `native:${ids[k]}`;
  const svc = async () => (await import("@/lib/planning/bulk-delete-works-service")).bulkDeleteWorkItemsDurable;
  let remitoId = "";

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
    const weekStart = "2026-11-23";
    const existing = await planning.listWeeks(weekStart);
    const week = existing[0] ?? (await planning.createWeek({ weekStart, label: "IT bulk" }, prod));
    for (const key of ["a", "b", "c", "entregado", "conEntrega", "enRemito", "rollback1", "rollback2", "conflicto"]) {
      const it = await planning.createItem(
        week.id,
        { plannedDate: "2026-11-25", client: "IT CLIENTE", product: `PROD ${key}`, plannedQuantity: "100", unit: "un", sector: "ENVASADO_MASIVO", line: "Línea 1", notes: NOTE },
        prod
      );
      ids[key] = it.id;
    }
    await q("update work_items set operational_status = 'entregado' where id = $1", [ids.entregado]);
    await q(
      `insert into work_item_deliveries (work_item_id, product, source_sector, actual_delivered_at, delivered_by, delivered_by_sector, quantity)
       values ($1, 'PROD conEntrega', 'ENVASADO_MASIVO', now(), 'it', 'PRODUCCION', '100')`,
      [ids.conEntrega]
    );
    const [r] = await q(
      `insert into remitos (client_id_normalized, client_display, delivery_date, version) values ('it-bulk', 'IT', '2026-11-12', 1) returning id`
    );
    remitoId = String(r!.id);
    await q(`insert into remito_work_links (remito_id, work_item_id) values ($1, $2)`, [remitoId, `native:${ids.enRemito}`]);
  }, 90_000);

  afterAll(async () => {
    await q("delete from remitos where id = $1", [remitoId]).catch(() => undefined);
    await q("delete from feature_audit_events where domain = 'work_items' and action = 'BULK_DELETE' and actor_email = $1", [prod.email]).catch(() => undefined);
    await q("update work_items set deleted_at = coalesce(deleted_at, now()) where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  it("dry-run: veredictos con motivo y NO escribe nada", async () => {
    const bulk = await svc();
    const all = ["a", "entregado", "conEntrega", "enRemito"].map(nid);
    const res = await bulk({ ids: [...all, "native:no-uuid", `native:${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`], reason: "", actorEmail: prod.email, dryRun: true });
    const code = (id: string) => res.verdicts.find((v) => v.id === id)?.code;
    expect(code(nid("a"))).toBe("ELIGIBLE");
    expect(code(nid("entregado"))).toBe("BLOCKED_DELIVERED");
    expect(code(nid("conEntrega"))).toBe("BLOCKED_HAS_DELIVERIES");
    expect(code(nid("enRemito"))).toBe("BLOCKED_IN_REMITO");
    expect(code("native:no-uuid")).toBe("INVALID_ID");
    expect(res.verdicts.some((v) => v.code === "NOT_FOUND")).toBe(true);
    expect(res.deleted).toEqual([]);
    const [row] = await q("select deleted_at from work_items where id = $1", [ids.a]);
    expect(row!.deleted_at).toBeNull();
    expect(await q("select 1 from feature_audit_events where action = 'BULK_DELETE' and actor_email = $1", [prod.email])).toHaveLength(0);
  });

  it("exige motivo y al menos un trabajo", async () => {
    const bulk = await svc();
    await expect(bulk({ ids: [nid("a")], reason: "  ", actorEmail: prod.email })).rejects.toThrow(/motivo/i);
    await expect(bulk({ ids: [], reason: "x", actorEmail: prod.email })).rejects.toThrow(/seleccionados/i);
  });

  it("elimina lógicamente los elegibles; protege entregado/entrega/remito; audita; no toca entregas ni cascada", async () => {
    const bulk = await svc();
    const [verBefore] = await q("select version from work_items where id = $1", [ids.a]);
    const deliveriesBefore = await q("select id from work_item_deliveries where work_item_id = $1", [ids.conEntrega]);
    const res = await bulk({
      ids: [nid("a"), nid("b"), nid("entregado"), nid("conEntrega"), nid("enRemito")],
      reason: "Duplicados de prueba",
      actorEmail: prod.email,
      batchKey: "it-batch-1",
    });
    expect(res.deleted.sort()).toEqual([nid("a"), nid("b")].sort());
    for (const k of ["a", "b"]) {
      const [r] = await q("select deleted_at, deleted_by, delete_reason, version from work_items where id = $1", [ids[k]]);
      expect(r!.deleted_at).not.toBeNull();
      expect(r).toMatchObject({ deleted_by: prod.email, delete_reason: "Duplicados de prueba" });
      const ev = await q("select note, actor_sector from operational_events where work_item_id = $1 and type = 'WORK_ITEM_DELETED_BY_PRODUCCION'", [ids[k]]);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ actor_sector: "PRODUCCION" });
      expect(String(ev[0]!.note)).toContain("eliminación masiva");
    }
    expect(Number((await q("select version from work_items where id = $1", [ids.a]))[0]!.version)).toBe(Number(verBefore!.version) + 1);
    // protegidos: intactos
    for (const k of ["entregado", "conEntrega", "enRemito"]) {
      const [r] = await q("select deleted_at from work_items where id = $1", [ids[k]]);
      expect(r!.deleted_at).toBeNull();
    }
    // las filas siguen existiendo y las entregas NO se cascadean
    expect(await q("select id from work_items where id = any($1)", [[ids.a, ids.b]])).toHaveLength(2);
    expect(await q("select id from work_item_deliveries where work_item_id = $1", [ids.conEntrega])).toEqual(deliveriesBefore);
    // auditoría del lote
    const audit = await q("select payload, actor_sector, idempotency_key from feature_audit_events where action = 'BULK_DELETE' and idempotency_key = 'it-batch-1'");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_sector: "PRODUCCION" });
    const payload = audit[0]!.payload as { reason: string; deletedCount: number; deleted: string[] };
    expect(payload).toMatchObject({ reason: "Duplicados de prueba", deletedCount: 2 });
    expect(payload.deleted.sort()).toEqual([nid("a"), nid("b")].sort());
  });

  it("idempotente: reintentar con el mismo batchKey no duplica eventos ni versiones", async () => {
    const bulk = await svc();
    const [v1] = await q("select version from work_items where id = $1", [ids.a]);
    const again = await bulk({ ids: [nid("a"), nid("b")], reason: "Duplicados de prueba", actorEmail: prod.email, batchKey: "it-batch-1" });
    expect(again.replayed).toBe(true);
    expect(again.deleted).toHaveLength(2);
    expect(Number((await q("select version from work_items where id = $1", [ids.a]))[0]!.version)).toBe(Number(v1!.version));
    expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'WORK_ITEM_DELETED_BY_PRODUCCION'", [ids.a])).toHaveLength(1);
    // otra operación sobre ya eliminados: se informa, no se re-escribe
    const other = await bulk({ ids: [nid("a")], reason: "Otra vez", actorEmail: prod.email, batchKey: "it-batch-2" });
    expect(other.verdicts[0]!.code).toBe("ALREADY_DELETED");
    expect(other.deleted).toEqual([]);
    expect(await q("select 1 from operational_events where work_item_id = $1 and type = 'WORK_ITEM_DELETED_BY_PRODUCCION'", [ids.a])).toHaveLength(1);
  });

  it("conflicto de versión: el trabajo modificado mientras se seleccionaba no se elimina", async () => {
    const bulk = await svc();
    const [v] = await q("select version from work_items where id = $1", [ids.conflicto]);
    const res = await bulk({
      ids: [nid("conflicto")],
      reason: "Prueba de versión",
      actorEmail: prod.email,
      expectedVersions: { [nid("conflicto")]: Number(v!.version) - 1 },
    });
    expect(res.verdicts[0]!.code).toBe("VERSION_CONFLICT");
    expect((await q("select deleted_at from work_items where id = $1", [ids.conflicto]))[0]!.deleted_at).toBeNull();
  });

  it("todo-o-nada: si falla la escritura a mitad del lote, no queda ningún trabajo eliminado ni auditoría", async () => {
    // El segundo evento falla (trigger de prueba) → toda la transacción se revierte.
    await q(`create or replace function it_bulk_fail() returns trigger language plpgsql as $$ begin if new.work_item_id = '${ids.rollback2}'::uuid and new.type = 'WORK_ITEM_DELETED_BY_PRODUCCION' then raise exception 'falla simulada'; end if; return new; end $$`);
    await q("create trigger it_bulk_fail_trg before insert on operational_events for each row execute function it_bulk_fail()");
    try {
      const bulk = await svc();
      await expect(
        bulk({ ids: [nid("rollback1"), nid("rollback2")], reason: "Prueba rollback", actorEmail: prod.email, batchKey: "it-batch-rb" })
      ).rejects.toThrow();
      for (const k of ["rollback1", "rollback2"]) {
        expect((await q("select deleted_at from work_items where id = $1", [ids[k]]))[0]!.deleted_at).toBeNull();
      }
      expect(await q("select 1 from feature_audit_events where idempotency_key = 'it-batch-rb'")).toHaveLength(0);
    } finally {
      await q("drop trigger if exists it_bulk_fail_trg on operational_events");
      await q("drop function if exists it_bulk_fail()");
    }
  });

  it("no toca el stock de MP ni sus movimientos", async () => {
    const tables = await q("select to_regclass('public.mp_stock_movements') as t");
    if (!tables[0]!.t) return; // esquema sin libro de MP en esta base: nada que comparar
    const before = await q("select count(*)::int as n from mp_stock_movements");
    const bulk = await svc();
    await bulk({ ids: [nid("c")], reason: "Sin efecto en stock", actorEmail: prod.email, batchKey: "it-batch-stock" });
    const after = await q("select count(*)::int as n from mp_stock_movements");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
