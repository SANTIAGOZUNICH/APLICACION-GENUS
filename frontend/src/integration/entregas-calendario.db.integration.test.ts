/**
 * Calendario de Entregas contra un Postgres de PRUEBA real (mismo SQL que Neon): fechas sin desplazamientos (zona Argentina),
 * entregas parciales en su fecha real, marcas «Revisar fecha», correcciones de Producción (cambiar la fecha de UN producto,
 * quitar/restaurar productos y entregas, editar/quitar/restaurar entregas «Desde trabajo»), no reaparición, permisos,
 * historial y que nada de esto toque entregas reales, stock ni consumos de MP.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-cal-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const envasado = { email: "it-cal-env@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO", displayName: "IT Envasado" };
const RUN = randomUUID().slice(0, 6).toUpperCase();
const CLIENT = `IT CAL ${RUN}`;
const OCT = { from: "2026-10-01", to: "2026-10-31" };
const NOV = { from: "2026-11-01", to: "2026-11-30" };

describe.skipIf(Boolean(PROBLEM))(`Calendario de Entregas en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => (await import("@/lib/entregas/service")).entregasService;
  const ids: Record<string, string> = {};
  let inventoryBefore = "";

  /** Huella de todo lo que NO se debe tocar: entregas reales, líneas, stock y movimientos de MP/ME, consumos. */
  const inventoryFingerprint = async () =>
    JSON.stringify(
      await Promise.all([
        q("select id, quantity, actual_delivered_at, status, deleted_at from work_item_deliveries order by id"),
        q("select id, quantity, actual_delivered_at, status from work_item_delivery_lines order by id"),
        q("select count(*)::int n, coalesce(sum(quantity), 0)::float s from mp_stock_movements"),
        q("select codigo, stock_actual from mp_stock_balances order by codigo"),
        q("select id, updated_at from inv_mp_stock order by id"),
        q("select id, updated_at from inv_me_ingresos order by id").catch(() => []),
      ])
    );

  async function realDelivery(workItemId: string, product: string, lines: Array<{ at: string; qty: number }>) {
    // Misma forma que deja el circuito de entregas parciales (0047): UNA fila agregada con la ÚLTIMA fecha y el acumulado,
    // y una línea por envío físico con su fecha real.
    const last = lines[lines.length - 1]!;
    const total = lines.reduce((s, l) => s + l.qty, 0);
    const [wd] = await q(
      `insert into work_item_deliveries (work_item_id, product, client, source_sector, quantity, unit, actual_delivered_at, delivered_by, delivered_by_sector, status)
       values ($1, $2, $3, 'ENVASADO_MASIVO', $4, 'un', $5, 'IT', 'ENVASADO_MASIVO', 'ENTREGADO') returning id`,
      [workItemId, product, CLIENT, String(total), last.at]
    );
    if (lines.length > 1) {
      let cum = 0;
      for (const [i, l] of lines.entries()) {
        cum += l.qty;
        await q(
          `insert into work_item_delivery_lines (work_item_id, delivery_id, idempotency_key, sequence, quantity, unit, kind, status, source_sector, delivered_by, delivered_by_sector, actual_delivered_at, cumulative_after)
           values ($1, $2, $3, $4, $5, 'un', $6, 'ACTIVA', 'ENVASADO_MASIVO', 'IT', 'ENVASADO_MASIVO', $7, $8)`,
          [workItemId, wd!.id, `it-${randomUUID()}`, i + 1, l.qty, i === lines.length - 1 ? "FINAL" : "PARCIAL", l.at, cum]
        );
      }
    }
    return String(wd!.id);
  }

  const forClient = <T extends { client: string }>(ds: T[]): T[] => ds.filter((d) => d.client === CLIENT);

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
    // Semana propia lejana: las fechas se fijan por SQL; no comparte semana con otras pruebas que publican la actual.
    const weekStart = "2039-01-03";
    const week = (await planning.listWeeks(weekStart))[0] ?? (await planning.createWeek({ weekStart, label: "IT calendario" }, prod as never));
    const mk = async (key: string, product: string, dates: { deliveryDate: string; plannedDate?: string }) => {
      const it = await planning.createItem(
        week.id,
        { plannedDate: "2039-01-04", client: CLIENT, product, plannedQuantity: "150", unit: "un", sector: "ENVASADO_MASIVO", line: "Línea 1" },
        prod as never
      );
      ids[key] = it.id;
      // Fechas de entrega/producción como las dejan la asignación o la edición (base DESCARTABLE de prueba).
      await q("update work_items set delivery_date = $2::date, planned_date = coalesce($3::date, '2026-10-06'::date) where id = $1", [it.id, dates.deliveryDate, dates.plannedDate ?? null]);
    };
    await mk("parcial", "SHAMPOO PARCIAL IT", { deliveryDate: "2026-10-09" });
    await mk("medianoche", "CREMA MEDIANOCHE IT", { deliveryDate: "2026-10-18" });
    await mk("antes", "GEL ANTES IT", { plannedDate: "2026-10-25", deliveryDate: "2026-10-22" });
    await mk("futuroA", "SERUM A IT", { deliveryDate: "2026-10-28" });
    await mk("futuroB", "SERUM B IT", { deliveryDate: "2026-10-28" });
    await mk("vinculado", "TONICO VINCULADO IT", { deliveryDate: "2026-10-26" });
    await q("update work_items set operational_status = 'entregado' where id = any($1::uuid[])", [[ids.parcial, ids.medianoche]]);
    // Parcial: 100 el viernes 10/10 a las 13:00 (AR) y 50 el martes 14/10 a las 22:30 (AR) = 15/10 01:30 UTC.
    await realDelivery(ids.parcial!, "SHAMPOO PARCIAL IT", [
      { at: "2026-10-10T16:00:00Z", qty: 100 },
      { at: "2026-10-15T01:30:00Z", qty: 50 },
    ]);
    // Fecha cargada sin hora → medianoche UTC (en Argentina es el 19/10 a las 21:00).
    await realDelivery(ids.medianoche!, "CREMA MEDIANOCHE IT", [{ at: "2026-10-20T00:00:00Z", qty: 150 }]);
    inventoryBefore = await inventoryFingerprint();
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("entregas PARCIALES: cada envío en su fecha real (zona Argentina), no todos en el día del último", async () => {
    const list = forClient(await (await svc()).list(prod, OCT));
    const reg = list.filter((d) => d.origin === "entrega_registrada" && d.items.some((i) => i.product === "SHAMPOO PARCIAL IT"));
    expect(reg.map((d) => [d.deliveryDate, d.items.map((i) => i.works[0]!.realDeliveries.length)])).toEqual([
      ["2026-10-10", [2]],
      ["2026-10-14", [2]],
    ]);
    // 22:30 del 14/10 en Argentina NO se corre al 15 (UTC).
    expect(list.some((d) => d.deliveryDate === "2026-10-15")).toBe(false);
    // Suma entregada = acumulado (100 + 50): la entrega queda completa.
    expect(reg[0]!.items[0]!.works[0]!.deliveredQty).toBe(150);
  });

  it("entrega guardada a las 00:00 UTC: se muestra en su día argentino y queda MARCADA «Revisar fecha» (no se corrige sola)", async () => {
    const list = forClient(await (await svc()).list(prod, OCT));
    const d = list.find((x) => x.origin === "entrega_registrada" && x.items.some((i) => i.product === "CREMA MEDIANOCHE IT"))!;
    expect(d.deliveryDate).toBe("2026-10-19");
    expect(d.items[0]!.reviewFlags).toContain("entrega_hora_utc_medianoche");
    const [row] = await q("select actual_delivered_at from work_item_deliveries where work_item_id = $1", [ids.medianoche]);
    expect(new Date(String(row!.actual_delivered_at)).toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("fecha de entrega anterior a la de producción: marcada para revisión", async () => {
    const list = forClient(await (await svc()).list(prod, OCT));
    const d = list.find((x) => x.items.some((i) => i.product === "GEL ANTES IT"))!;
    expect(d.deliveryDate).toBe("2026-10-22");
    expect(d.items[0]!.reviewFlags).toContain("entrega_antes_de_produccion");
  });

  it("agrupación: varios productos del mismo cliente en la misma fecha van juntos", async () => {
    const list = forClient(await (await svc()).list(prod, OCT));
    const d = list.filter((x) => x.deliveryDate === "2026-10-28" && x.origin === "desde_trabajo");
    expect(d).toHaveLength(1);
    expect(d[0]!.items.map((i) => i.product)).toEqual(["SERUM A IT", "SERUM B IT"]);
  });

  it("editar una entrega «Desde trabajo»: cambia SOLO ese producto, persiste en el trabajo y queda en el historial", async () => {
    const s = await svc();
    const r = await s.editWork(prod, ids.futuroA!, { deliveryDate: "2026-10-30", plannedQuantity: "180", notes: "Cliente pidió correr la entrega" }, "Pedido del cliente por teléfono");
    expect(r.applied.sort()).toEqual(["deliveryDate", "notes", "plannedQuantity"]);
    const [w] = await q("select to_char(delivery_date,'YYYY-MM-DD') d, planned_quantity, notes from work_items where id = $1", [ids.futuroA]);
    expect(w).toMatchObject({ d: "2026-10-30", planned_quantity: "180", notes: "Cliente pidió correr la entrega" });
    const list = forClient(await s.list(prod, OCT));
    expect(list.find((x) => x.deliveryDate === "2026-10-28")!.items.map((i) => i.product)).toEqual(["SERUM B IT"]);
    expect(list.find((x) => x.deliveryDate === "2026-10-30")!.items.map((i) => i.product)).toEqual(["SERUM A IT"]);
    const hist = await s.workHistory(prod, ids.futuroA!);
    expect(hist[0]).toMatchObject({ action: "work_edit", actorEmail: prod.email });
  });

  it("quitar del calendario (lógico): no reaparece aunque el trabajo siga con fecha; se ve con «Ver quitadas»; se restaura", async () => {
    const s = await svc();
    await s.hideWork(prod, ids.futuroB!, "Entrega duplicada en el calendario");
    await s.hideWork(prod, ids.futuroB!, "Entrega duplicada en el calendario"); // idempotente
    expect(forClient(await s.list(prod, OCT)).some((d) => d.items.some((i) => i.product === "SERUM B IT"))).toBe(false);
    // Aunque el trabajo cambie de fecha, sigue quitado (no lo «resucita» la sincronización con el trabajo).
    await s.editWork(prod, ids.futuroB!, { deliveryDate: "2026-10-29" }, "Ajuste de fecha del trabajo");
    expect(forClient(await s.list(prod, OCT)).some((d) => d.items.some((i) => i.product === "SERUM B IT"))).toBe(false);
    const hidden = forClient(await s.list(prod, OCT, { includeHidden: true })).flatMap((d) => d.items).find((i) => i.product === "SERUM B IT")!;
    expect(hidden.hidden).toMatchObject({ reason: "Entrega duplicada en el calendario", by: prod.email });
    // El trabajo NO se tocó (salvo la fecha que se editó explícitamente).
    const [w] = await q("select deleted_at, operational_status from work_items where id = $1", [ids.futuroB]);
    expect(w).toMatchObject({ deleted_at: null });
    await s.restoreWork(prod, ids.futuroB!, "Se confirmó que no estaba duplicada");
    expect(forClient(await s.list(prod, OCT)).find((d) => d.deliveryDate === "2026-10-29")!.items.map((i) => i.product)).toEqual(["SERUM B IT"]);
    expect((await s.workHistory(prod, ids.futuroB!)).map((h) => h.action)).toEqual(["restore_work", "work_edit", "hide_work"]);
    expect(await q("select restored_at is not null as r from delivery_calendar_hidden where work_item_id = $1", [ids.futuroB])).toEqual([{ r: true }]);
  });

  it("una entrega REAL no se puede quitar desde el calendario: quitar la aparición del trabajo no la oculta", async () => {
    const s = await svc();
    await s.hideWork(prod, ids.parcial!, "Prueba: no debe ocultar entregas reales");
    const list = forClient(await s.list(prod, OCT));
    expect(list.filter((d) => d.origin === "entrega_registrada" && d.items.some((i) => i.product === "SHAMPOO PARCIAL IT"))).toHaveLength(2);
    await s.restoreWork(prod, ids.parcial!, "Fin de la prueba de entregas reales");
  });

  it("entrega PROGRAMADA: cambiar la fecha de UN producto deja a los demás en su fecha; mover otro a la misma fecha los agrupa", async () => {
    const s = await svc();
    const created = await s.create(prod, {
      client: CLIENT,
      deliveryDate: "2026-11-10",
      responsible: "IT",
      notes: null,
      items: [
        { product: "ACOND X IT", quantity: "100", unit: "un", sector: "ENVASADO_MASIVO" },
        { product: "ACOND Y IT", quantity: "200", unit: "un", sector: "ENVASADO_MASIVO" },
        { product: "ACOND Z IT", quantity: "300", unit: "un", sector: "ENVASADO_MASIVO" },
      ],
    } as never);
    ids.prog = created.id;
    const x = created.items.find((i) => i.product === "ACOND X IT")!;
    const { source, target } = await s.moveItem(prod, created.id, x.id, "2026-11-12", "El cliente adelantó solo el X", created.version);
    expect(source.deliveryDate).toBe("2026-11-10");
    expect(source.items.map((i) => i.product)).toEqual(["ACOND Y IT", "ACOND Z IT"]);
    expect(target.deliveryDate).toBe("2026-11-12");
    expect(target.items.map((i) => i.product)).toEqual(["ACOND X IT"]);
    const y = source.items.find((i) => i.product === "ACOND Y IT")!;
    const again = await s.moveItem(prod, source.id, y.id, "2026-11-12", "También se adelanta el Y", source.version);
    expect(again.target.id).toBe(target.id);
    expect(again.target.items.map((i) => i.product)).toEqual(["ACOND X IT", "ACOND Y IT"]);
    // Persistencia (lectura fresca) y agrupación por cliente y fecha.
    const nov = forClient(await s.list(prod, NOV));
    expect(nov.map((d) => [d.deliveryDate, d.items.map((i) => i.product)])).toEqual([
      ["2026-11-10", ["ACOND Z IT"]],
      ["2026-11-12", ["ACOND X IT", "ACOND Y IT"]],
    ]);
    const hist = await s.history(prod, created.id);
    expect(hist.filter((h) => h.action === "move_item_out")).toHaveLength(2);
    // Versión vieja → conflicto (nunca se pisa).
    await expect(s.moveItem(prod, created.id, source.items[0]!.id, "2026-11-13", "Versión vieja de la entrega", created.version)).rejects.toThrow(/Otra persona/);
  });

  it("quitar y restaurar un producto (lógico, con motivo); con trabajos vinculados no se puede", async () => {
    const s = await svc();
    const created = await s.create(prod, {
      client: CLIENT,
      deliveryDate: "2026-11-20",
      responsible: null,
      notes: null,
      items: [
        { product: "TONICO VINCULADO IT", quantity: "150", unit: "un", sector: "ENVASADO_MASIVO" },
        { product: "JABON IT", quantity: "10", unit: "un", sector: "ENVASADO_MASIVO" },
      ],
    } as never);
    const ton = created.items.find((i) => i.product === "TONICO VINCULADO IT")!;
    const jab = created.items.find((i) => i.product === "JABON IT")!;
    let cur = await s.linkWork(prod, ton.id, ids.vinculado!);
    await expect(s.deleteItem(prod, cur.id, ton.id, "Prueba con trabajo vinculado", cur.version)).rejects.toThrow(/trabajos vinculados/);
    cur = await s.deleteItem(prod, cur.id, jab.id, "El cliente ya no lo quiere", cur.version);
    expect(cur.items.map((i) => i.product)).toEqual(["TONICO VINCULADO IT"]);
    const deleted = await s.deletedItems(prod, cur.id);
    expect(deleted.map((i) => [i.product, i.deletedReason, i.deletedBy])).toEqual([["JABON IT", "El cliente ya no lo quiere", prod.email]]);
    // El único producto que queda no se puede quitar: para eso se cancela la entrega.
    await expect(s.deleteItem(prod, cur.id, ton.id, "Prueba de único producto", cur.version)).rejects.toThrow();
    cur = await s.restoreItem(prod, cur.id, jab.id, "Lo volvió a pedir");
    expect(cur.items.map((i) => i.product).sort()).toEqual(["JABON IT", "TONICO VINCULADO IT"]);
    // Trabajo vinculado con otra fecha (26/10) que la entrega (20/11): marcado para revisión.
    expect(cur.items.find((i) => i.product === "TONICO VINCULADO IT")!.reviewFlags).toContain("trabajo_con_otra_fecha");
    // Un trabajo vinculado no cambia su fecha desde «Desde trabajo» (se reprograma la entrega).
    await expect(s.editWork(prod, ids.vinculado!, { deliveryDate: "2026-11-21" }, "No corresponde por acá")).rejects.toThrow(/entrega programada/);
  });

  it("cancelar y restaurar una entrega programada: queda el historial, vuelve con sus productos", async () => {
    const s = await svc();
    const d0 = await s.get(prod, ids.prog!);
    const c = await s.cancel(prod, d0.id, "El cliente suspendió la entrega", d0.version);
    expect(c.state).toBe("cancelada");
    // Cancelada sigue visible (tachada) para conservar el historial.
    expect(forClient(await s.list(prod, NOV)).find((d) => d.id === d0.id)?.state).toBe("cancelada");
    const r = await s.restore(prod, c.id, "El cliente confirmó de nuevo", c.version);
    expect(r.state).toBe("programada");
    expect(r.items.map((i) => i.product)).toEqual(["ACOND Z IT"]);
    expect((await s.history(prod, d0.id)).map((h) => h.action).slice(0, 2)).toEqual(["restore", "cancel"]);
  });

  it("permisos: Envasado ve el calendario pero no corrige, no ve quitadas ni la auditoría", async () => {
    const s = await svc();
    const d = await s.get(prod, ids.prog!);
    await expect(s.moveItem(envasado, d.id, d.items[0]!.id, "2026-11-15", "Intento sin permiso", d.version)).rejects.toThrow(/Producción/);
    await expect(s.restore(envasado, d.id, "Intento sin permiso", d.version)).rejects.toThrow(/Producción/);
    await expect(s.editWork(envasado, ids.futuroA!, { deliveryDate: "2026-10-31" }, "Intento sin permiso")).rejects.toThrow(/Producción/);
    await expect(s.hideWork(envasado, ids.futuroA!, "Intento sin permiso")).rejects.toThrow(/Producción/);
    await expect(s.dateAudit(envasado)).rejects.toThrow(/Producción/);
    await s.hideWork(prod, ids.futuroA!, "Ocultar para probar permisos");
    const seen = forClient(await s.list(envasado, OCT, { includeHidden: true })).flatMap((x) => x.items);
    expect(seen.some((i) => i.product === "SERUM A IT")).toBe(false);
    await s.restoreWork(prod, ids.futuroA!, "Fin de la prueba de permisos");
    // Motivo obligatorio.
    await expect(s.hideWork(prod, ids.futuroA!, "corto")).rejects.toThrow();
  });

  it("auditoría de fechas (solo lectura): cuenta los casos sembrados", async () => {
    const before = await q("select count(*)::int n from feature_audit_events");
    const audit = await (await svc()).dateAudit(prod);
    const by = Object.fromEntries(audit.categories.map((c) => [c.key, c]));
    expect(by.parciales_en_un_solo_dia!.samples.some((x) => x.workItemId === ids.parcial)).toBe(true);
    expect(by.entrega_hora_utc_medianoche!.samples.some((x) => x.workItemId === ids.medianoche)).toBe(true);
    expect(by.entrega_antes_de_produccion!.samples.some((x) => x.workItemId === ids.antes)).toBe(true);
    expect(by.trabajo_con_otra_fecha!.samples.some((x) => x.workItemId === ids.vinculado)).toBe(true);
    expect((await q("select count(*)::int n from feature_audit_events"))[0]!.n).toBe(before[0]!.n);
  });

  it("integridad: nada de lo anterior tocó entregas reales, líneas, stock ni movimientos de MP", async () => {
    expect(await inventoryFingerprint()).toBe(inventoryBefore);
  });
});
