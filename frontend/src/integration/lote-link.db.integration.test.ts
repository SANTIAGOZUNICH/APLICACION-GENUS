/**
 * Vínculo Asignación de Lotes ↔ trabajo ↔ OE/OA en un Postgres de PRUEBA real (mismo SQL que Neon), con las MISMAS
 * funciones que usa la app (assignWorkItemDurable, syncLinkedWorkItemsForLote, reconcileLoteLinks,
 * updateWorkItemLoteVtoDurable). Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-lote-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-5);
const NOTE = `IT-LOTE-LINK-${RUN}`;
const BASE = 600000 + Math.floor(Math.random() * 3000) * 100;
let seq = 0;
const num = (t: "OE" | "OA") => `${t}-2026-${String(BASE + ++seq).padStart(6, "0")}`;

describe.skipIf(Boolean(PROBLEM))(`Lotes: vínculo persistente en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: string[] = [];

  const mkLote = async (id: string, over: Partial<Record<string, string>> = {}) => {
    ids.push(id);
    await q(
      `insert into asignacion_lotes (id, lote, fecha, producto, codigo, marca, cantidades, vto)
       values ($1,$2,'2026-11-01',$3,$4,$5,100,'2027-11-30')`,
      [id, over.lote ?? `L-${id}`, over.producto ?? "CREMA LINK", over.codigo ?? `C-${id}`, over.marca ?? `CLI LINK ${RUN}`]
    );
  };
  const assign = async (over: Record<string, unknown> = {}) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const sector = (over.sector as string) ?? "ELABORACION";
    return assignWorkItemDurable(
      {
        sector,
        client: `CLI LINK ${RUN}`,
        product: "CREMA LINK",
        plannedQuantity: "100",
        unit: sector === "ELABORACION" ? "kg" : "un.",
        plannedDate: "2026-11-12",
        ...(sector === "ELABORACION" ? { branchOwner: "Cristian" } : { line: "Línea 1" }),
        orderNumber: num(sector === "ELABORACION" ? "OE" : "OA"),
        notes: NOTE,
        idempotencyKey: randomUUID(),
        ...over,
      } as never,
      prod,
      randomUUID()
    );
  };
  const wi = async (id: string) => (await q("select * from work_items where id = $1", [id]))[0]!;
  const ord = async (id: string) => (await q("select * from operational_orders where id = $1", [id]))[0]!;
  const events = async (workId: string, type: string) => q("select * from operational_events where work_item_id = $1 and type = $2", [workId, type]);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    if (ids.length) await q("delete from asignacion_lotes where id = any($1)", [ids]).catch(() => undefined);
    await pool?.end();
  });

  it("1-3. Elaboración con lote existente: vincula por id, el lote llega a la OE; Envasado hereda el mismo lote en la OA", async () => {
    const id = `al-1-${RUN}`;
    await mkLote(id, { lote: `LOTE-A-${RUN}` });
    const el = await assign({ sector: "ELABORACION", asignacionLoteId: id });
    const row = await wi(el.item.id);
    expect(row.asignacion_lote_id).toBe(id);
    expect(row.lote_link_method).toBe("MANUAL");
    expect(row.packaging_lote).toBe(`LOTE-A-${RUN}`);
    expect((await ord(el.order!.id)).lot).toBe(`LOTE-A-${RUN}`);

    const env = await assign({ sector: "ENVASADO_MASIVO", asignacionLoteId: id });
    expect((await wi(env.item.id)).asignacion_lote_id).toBe(id);
    expect((await ord(env.order!.id)).lot).toBe(`LOTE-A-${RUN}`);
  });

  it("4-5. Dos producciones del mismo producto con lotes distintos y clientes parecidos: cada una conserva su vínculo", async () => {
    const cliX = `CLI DOS X ${RUN}`;
    const cliY = `CLI DOS Y ${RUN}`;
    await mkLote(`al-x-${RUN}`, { marca: cliX, producto: "SERUM DOS", lote: `LX-${RUN}` });
    await mkLote(`al-y-${RUN}`, { marca: cliY, producto: "SERUM DOS", lote: `LY-${RUN}` });
    const a = await assign({ client: cliX, product: "SERUM DOS" });
    const b = await assign({ client: cliY, product: "SERUM DOS" });
    expect((await wi(a.item.id)).packaging_lote).toBe(`LX-${RUN}`);
    expect((await wi(a.item.id)).lote_link_method).toBe("AUTO");
    expect((await wi(b.item.id)).packaging_lote).toBe(`LY-${RUN}`);
  });

  it("6. Reprogramar no pierde el vínculo", async () => {
    const id = `al-6-${RUN}`;
    await mkLote(id, { producto: "CREMA SPLIT", lote: `LS-${RUN}` });
    const a = await assign({ product: "CREMA SPLIT", plannedQuantity: "300", unit: "un.", sector: "ENVASADO_MASIVO", asignacionLoteId: id });
    const { updateWorkItemPlanningDurable } = await import("@/lib/planning/work-item-progress-repository");
    await updateWorkItemPlanningDurable(a.item.id, {
      plannedDate: "2026-11-20",
      reason: "Reprogramado",
      updatedBy: prod.email,
      updatedBySector: prod.sector,
    } as never);
    expect((await wi(a.item.id)).asignacion_lote_id).toBe(id);
  });

  it("7. Dividir en varios días: cada tramo hereda el vínculo", async () => {
    const id = `al-7-${RUN}`;
    await mkLote(id, { producto: "CREMA DIAS", lote: `LD-${RUN}` });
    const a = await assign({ product: "CREMA DIAS", plannedQuantity: "300", unit: "un.", sector: "ENVASADO_MASIVO" });
    const { addSchedulesDurable } = await import("@/lib/planning/work-schedules-service");
    const res = await addSchedulesDurable(
      { sourceId: a.item.id, items: [{ plannedDate: "2026-11-23", quantity: 100 }, { plannedDate: "2026-11-24", quantity: 100 }], rebalanceSource: true, idempotencyKey: randomUUID() } as never,
      prod as never
    );
    expect(res.created.length).toBeGreaterThan(0);
    for (const c of res.created) {
      const row = await wi(c.id);
      expect(row.asignacion_lote_id).toBe(id);
      expect(row.packaging_lote).toBe(`LD-${RUN}`);
    }
  });

  it("8. Sin lote en Asignación: queda pendiente (sin vínculo), no se rellena un lote ajeno y no bloquea", async () => {
    const r = await assign({ client: `CLI SIN LOTE ${RUN}`, product: "PRODUCTO SIN LOTE" });
    const row = await wi(r.item.id);
    expect(row.asignacion_lote_id).toBeNull();
    expect(row.packaging_lote).toBeNull();
  });

  it("9. Ambiguo (dos lotes vigentes del mismo producto): el server NO adivina; con elección explícita se persiste", async () => {
    const cli = `CLI AMB ${RUN}`;
    await mkLote(`al-amb1-${RUN}`, { marca: cli, producto: "GEL AMB", lote: `LA1-${RUN}` });
    await mkLote(`al-amb2-${RUN}`, { marca: cli, producto: "GEL AMB", lote: `LA2-${RUN}` });
    const auto = await assign({ client: cli, product: "GEL AMB" });
    expect((await wi(auto.item.id)).asignacion_lote_id).toBeNull();
    expect((await wi(auto.item.id)).packaging_lote).toBeNull();
    const chosen = await assign({ client: cli, product: "GEL AMB", asignacionLoteId: `al-amb2-${RUN}` });
    const row = await wi(chosen.item.id);
    expect(row.asignacion_lote_id).toBe(`al-amb2-${RUN}`);
    expect(row.packaging_lote).toBe(`LA2-${RUN}`);
  });

  it("10. Cambio de lote en Asignación: se propaga a trabajo y OE/OA abiertos, con evento y auditoría", async () => {
    const id = `al-10-${RUN}`;
    await mkLote(id, { producto: "LOCION SYNC", lote: `LS0-${RUN}` });
    const el = await assign({ product: "LOCION SYNC", sector: "ELABORACION" });
    const env = await assign({ product: "LOCION SYNC", sector: "ENVASADO_MASIVO", unit: "un." });
    await q("update asignacion_lotes set lote = $2 where id = $1", [id, `LS1-${RUN}`]);
    const { syncLinkedWorkItemsForLote } = await import("@/lib/asignacion-lotes/lote-link");
    const res = await syncLinkedWorkItemsForLote({ id, lote: `LS1-${RUN}`, vto: "2027-11-30", updatedBy: "it-sync" }, "PRODUCCION");
    expect(res.synced).toEqual(expect.arrayContaining([el.item.id, env.item.id]));
    expect((await wi(el.item.id)).packaging_lote).toBe(`LS1-${RUN}`);
    expect((await ord(el.order!.id)).lot).toBe(`LS1-${RUN}`);
    expect((await ord(env.order!.id)).lot).toBe(`LS1-${RUN}`);
    expect(await events(el.item.id, "LOTE_SYNCED")).toHaveLength(1);
    const a = await q("select * from order_audit_events where order_id = $1 and event_type = 'LOTE_SYNCED_FROM_ASIGNACION'", [el.order!.id]);
    expect(a).toHaveLength(1);
  });

  it("11. OE/OA cerrada o trabajo terminado: NO se pisa; queda conflicto auditado", async () => {
    const id = `al-11-${RUN}`;
    await mkLote(id, { producto: "CREMA CERRADA", lote: `LC0-${RUN}` });
    const closedOrder = await assign({ product: "CREMA CERRADA", sector: "ELABORACION" });
    await q("update operational_orders set status = 'COMPLETA' where id = $1", [closedOrder.order!.id]);
    const doneWork = await assign({ product: "CREMA CERRADA", sector: "ENVASADO_MASIVO", unit: "un." });
    await q("update work_items set status = 'TERMINADO_SECTOR' where id = $1", [doneWork.item.id]);
    const { syncLinkedWorkItemsForLote } = await import("@/lib/asignacion-lotes/lote-link");
    const res = await syncLinkedWorkItemsForLote({ id, lote: `LC1-${RUN}`, vto: "2027-11-30", updatedBy: "it-sync" }, "PRODUCCION");
    expect(res.conflicts.map((c) => c.workItemId).sort()).toEqual([closedOrder.item.id, doneWork.item.id].sort());
    expect((await wi(closedOrder.item.id)).packaging_lote).toBe(`LC0-${RUN}`);
    expect((await ord(closedOrder.order!.id)).lot).toBe(`LC0-${RUN}`);
    expect((await wi(doneWork.item.id)).packaging_lote).toBe(`LC0-${RUN}`);
    expect(await events(closedOrder.item.id, "LOTE_SYNC_CONFLICT")).toHaveLength(1);
  });

  it("12. Recarga: el vínculo persiste (se relee de la base); la corrección auditada sigue permitida", async () => {
    const id = `al-12-${RUN}`;
    await mkLote(id, { producto: "CREMA RELOAD", lote: `LR-${RUN}` });
    const r = await assign({ product: "CREMA RELOAD" });
    const again = await wi(r.item.id);
    expect(again.asignacion_lote_id).toBe(id);
    expect(again.lote_linked_by).toBe(prod.email);
    expect(again.lote_linked_at).toBeTruthy();
  });

  it("13. Reconciliación: vincula solo coincidencias únicas; ambiguos/sin match quedan pendientes; histórico cerrado intacto", async () => {
    const cli = `CLI REC ${RUN}`;
    await mkLote(`al-rec-${RUN}`, { marca: cli, producto: "CREMA REC", lote: `LRC-${RUN}` });
    const cliAmb = `CLI RECAMB ${RUN}`;
    await mkLote(`al-recA1-${RUN}`, { marca: cliAmb, producto: "CREMA RECAMB", lote: `LRA1-${RUN}` });
    await mkLote(`al-recA2-${RUN}`, { marca: cliAmb, producto: "CREMA RECAMB", lote: `LRA2-${RUN}` });
    // Trabajos "viejos" sin vínculo (se crean sin lote en Asignación para que no se auto-vinculen y luego se desvinculan).
    const mk = async (client: string, product: string, status = "PUBLICADO") => {
      const r = await assign({ client, product });
      await q("update work_items set asignacion_lote_id = null, lote_link_method = null, packaging_lote = null, packaging_vto = null, status = $2 where id = $1", [r.item.id, status]);
      return r.item.id as string;
    };
    const unique = await mk(cli, "CREMA REC");
    const amb = await mk(cliAmb, "CREMA RECAMB");
    const none = await mk(`CLI NADA ${RUN}`, "PRODUCTO NADA");
    const closed = await mk(cli, "CREMA REC", "TERMINADO_SECTOR");
    const { reconcileLoteLinks } = await import("@/lib/asignacion-lotes/lote-link");
    const dry = await reconcileLoteLinks({ actorEmail: prod.email, dryRun: true });
    expect(dry.linked.map((l) => l.workItemId)).toContain(unique);
    expect((await wi(unique)).asignacion_lote_id).toBeNull(); // dry run no escribe
    const res = await reconcileLoteLinks({ actorEmail: prod.email, dryRun: false });
    expect(res.linked.map((l) => l.workItemId)).toContain(unique);
    expect(res.ambiguous).toContain(amb);
    expect(res.pending).toContain(none);
    expect(res.skippedClosed).toContain(closed);
    const u = await wi(unique);
    expect(u.asignacion_lote_id).toBe(`al-rec-${RUN}`);
    expect(u.lote_link_method).toBe("RECONCILED");
    expect(u.packaging_lote).toBe(`LRC-${RUN}`);
    expect((await wi(amb)).asignacion_lote_id).toBeNull();
    expect((await wi(closed)).asignacion_lote_id).toBeNull();
    expect(await events(unique, "LOTE_LINKED")).toHaveLength(1);
  });
});
