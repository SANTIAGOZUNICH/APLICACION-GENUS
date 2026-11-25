/**
 * INSUMOS · control de stock contra un Postgres de PRUEBA real (migraciones 0088 + 0090): stock inicial (null ≠ 0), ingresos, descuento automático
 * por retiros (atómico, idempotente, corrección = diferencia, anulación = reversa), retiros simultáneos, stock cero / negativo, alertas por episodio
 * con notificación única, permisos y conservación del historial previo. Se corre con `npm run test:e2e:insumos-db` (base descartable).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import { uuidFromKey } from "@/lib/planning/circuit/movements";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const MARK = `IT-STK-${RUN}`;
const actor = (sector: string, tag = sector.toLowerCase()) => ({ email: `it-stk-${tag}-${RUN}@laboratoriogenus.com.ar`, sector: sector as never, displayName: `${MARK}-${tag}` });
const masivo = actor("ENVASADO_MASIVO");
const premium = actor("ENVASADO_PREMIUM");
const codificado = actor("CODIFICADO");
const mp = actor("MATERIA_PRIMA");
const elab = actor("ELABORACION");
const admin = actor("ADMINISTRACION");
const direccion = actor("DIRECCION");
const deposito = actor("DEPOSITO");
const produccion = actor("PRODUCCION");
const key = () => `k-${randomUUID()}`;

describe.skipIf(Boolean(PROBLEM))(`Stock de insumos en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ins = async () => import("@/lib/insumos/insumos-service");
  const stk = async () => import("@/lib/insumos/stock-service");
  const respId = async (sector: string, name: string) => (await q("select id from insumo_responsables where sector = $1 and name = $2", [sector, name]))[0]!.id as string;
  const RESP: Record<string, string> = {};

  /** Insumo nuevo del catálogo (nombre único por corrida). */
  const newItem = async (tag: string, o: { min?: number; initial?: number; unit?: string } = {}) => {
    const item = await (await ins()).createInsumoItem(admin, { name: `STK ${tag} ${RUN}` });
    const s = await stk();
    if (o.min !== undefined || o.unit !== undefined) await s.updateStockConfig(admin, item.id, { minStock: o.min, unit: o.unit });
    if (o.initial !== undefined) await s.setInitialStock(admin, { insumoId: item.id, quantity: o.initial, key: key() });
    return item;
  };
  const row = async (id: string) => (await (await stk()).getStockSummary(admin)).items.find((r) => r.insumoId === id)!;
  const retiro = async (who: typeof masivo, sectorName: string, resp: string, lines: Array<{ insumoId: string; cantidad: number }>, k = key()) =>
    (await ins()).createRetiro(who, { clientRequestId: `ins-${k}-${randomUUID()}`.slice(0, 90), responsableId: RESP[`${sectorName}:${resp}`]!, lines });
  const movs = async (insumoId: string) => q("select kind, delta, status, retiro_id from insumo_stock_movements where insumo_id = $1 order by seq", [insumoId]);
  const notifs = async (insumoId: string) => q("select id, message, title, sectors, href from os_notifications where id = any($1::uuid[])", [[1, 2, 3, 4].map((e) => uuidFromKey(`insumos:bajo:${insumoId}:${e}`))]);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    for (const [s, n] of [["ENVASADO_MASIVO", "GABO"], ["ENVASADO_PREMIUM", "BELEN"], ["CODIFICADO", "JULIAN"], ["MATERIA_PRIMA", "VALENTIN"], ["ELABORACION", "SANTINO"], ["DEPOSITO", "BETO"], ["DEPOSITO", "LEO"]] as const) RESP[`${s}:${n}`] = await respId(s, n);
  }, 90_000);

  afterAll(async () => {
    const mine = "select id from insumo_items where created_by like $1";
    const em = [`it-stk-%-${RUN}@%`];
    await q(`delete from insumo_stock_movements where insumo_id in (${mine}) or created_by like $1`, em).catch(() => undefined);
    await q("delete from insumo_stock_audit where actor_email like $1", em).catch(() => undefined);
    await q("delete from os_notifications where kind = 'insumos_stock_bajo' and message like $1", [`%${RUN}%`]).catch(() => undefined);
    const rids = "select id from insumo_retiros where registrado_por_name like $1";
    await q(`delete from insumo_stock_movements where retiro_id in (${rids})`, [`${MARK}%`]).catch(() => undefined);
    await q(`delete from insumo_retiro_events where retiro_id in (${rids})`, [`${MARK}%`]).catch(() => undefined);
    await q(`delete from insumo_retiro_items where retiro_id in (${rids})`, [`${MARK}%`]).catch(() => undefined);
    await q("delete from insumo_retiros where registrado_por_name like $1", [`${MARK}%`]).catch(() => undefined);
    await q("delete from insumo_items where created_by like $1", em).catch(() => undefined);
    await pool?.end();
  });

  it("la migración 0090 agregó unidad, mínimo y alerta con valores por defecto, y los 6 insumos iniciales los conservan", async () => {
    const r = await q("select id, unit, min_stock, alert_state from insumo_items where id in ('papel-higienico','bobina-de-papel','guantes','cinta','film','stretch-film') order by sort_order");
    expect(r).toHaveLength(6);
    for (const x of r) expect(x).toMatchObject({ unit: "unidades", min_stock: 0, alert_state: "NORMAL" });
    expect((await q("select count(*)::int n from insumo_stock_config where id = 'main'"))[0]!.n).toBe(1);
  });

  it("stock inicial: «sin configurar» (null, sin alerta) es distinto de «stock 0»; queda auditado con antes/después", async () => {
    const s = await stk();
    const it = await newItem("INI");
    let r = await row(it.id);
    expect(r).toMatchObject({ configured: false, stock: null, status: "SIN_CONFIGURAR", alert: false });
    await s.setInitialStock(admin, { insumoId: it.id, quantity: 0, key: key() });
    r = await row(it.id);
    expect(r).toMatchObject({ configured: true, stock: 0, status: "SIN_STOCK", alert: true });
    await s.setInitialStock(direccion, { insumoId: it.id, quantity: 50, note: "Conteo físico", key: key() });
    r = await row(it.id);
    expect(r).toMatchObject({ stock: 50, baseline: 50, status: "DISPONIBLE", alert: false });
    const ev = (await s.listStockAudit(admin, { insumoId: it.id })).filter((e) => e.action === "STOCK_INICIAL");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ actorEmail: direccion.email, before: { stock: 0, configurado: true }, after: { stock: 50 } });
    await expect(s.setInitialStock(admin, { insumoId: it.id, quantity: -1, key: key() })).rejects.toThrow(/negativo/);
    await expect(s.setInitialStock(admin, { insumoId: it.id, quantity: 1.5, key: key() })).rejects.toThrow(/entero/);
  });

  it("un retiro de DEPÓSITO descuenta el stock y activa la alerta de mínimo; Depósito no puede operar el stock", async () => {
    const it1 = await newItem("DEP", { min: 10, initial: 12, unit: "rollos" });
    await retiro(deposito, "DEPOSITO", "BETO", [{ insumoId: it1.id, cantidad: 1 }]);
    expect(await row(it1.id)).toMatchObject({ stock: 11, retiros: 1 });
    await retiro(deposito, "DEPOSITO", "LEO", [{ insumoId: it1.id, cantidad: 2 }]); // 9 ≤ mínimo 10
    expect(await row(it1.id)).toMatchObject({ stock: 9, status: "STOCK_BAJO" });
    expect((await notifs(it1.id)).length).toBe(1);
    await expect((await stk()).setInitialStock(deposito, { insumoId: it1.id, quantity: 99, key: key() })).rejects.toThrow();
    await expect((await stk()).updateStockConfig(deposito, it1.id, { minStock: 1 })).rejects.toThrow();
  });

  it("el stock inicial NO descuenta retiros anteriores y el historial de retiros se conserva intacto; GUANTES 50 − 3 = 47", async () => {
    const s = await stk();
    const i = await ins();
    // Retiro histórico previo (creado ANTES del seguimiento: nunca descuenta solo, ni al corregirlo ni al anularlo).
    const old = await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: "guantes", cantidad: 9 }]);
    await q("update insumo_retiros set created_at = '2020-01-01T12:00:00Z' where id = $1", [old.retiro.id]);
    await q("delete from insumo_stock_movements where retiro_id = $1", [old.retiro.id]); // como si fuera anterior a esta migración
    const before = (await q("select count(*)::int n, coalesce(sum(cantidad),0)::int u from insumo_retiros r join insumo_retiro_items i on i.retiro_id = r.id"))[0]!;
    const base = await s.setInitialStock(admin, { insumoId: "guantes", quantity: 50, key: key() });
    expect(base.stock).toBe(50); // los retiros previos de GUANTES (de otras pruebas y este histórico) no cuentan
    const after = (await q("select count(*)::int n, coalesce(sum(cantidad),0)::int u from insumo_retiros r join insumo_retiro_items i on i.retiro_id = r.id"))[0]!;
    expect(after).toEqual(before); // historial intacto
    await i.correctRetiro(admin, old.retiro.id, { motivo: "Corrección histórica", lines: [{ insumoId: "guantes", cantidad: 11 }] });
    await i.anularRetiro(admin, old.retiro.id, "Anulación histórica");
    expect((await q("select count(*)::int n from insumo_stock_movements where retiro_id = $1", [old.retiro.id]))[0]!.n).toBe(0);
    expect((await row("guantes")).stock).toBe(50);
    await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: "guantes", cantidad: 3 }]);
    expect(await row("guantes")).toMatchObject({ stock: 47, retiros: 3, ingresos: 0 });
    // El consumo histórico por sector/responsable sigue funcionando sin cambios.
    const { retiros } = await i.listRetiros(admin, { insumoId: "guantes" });
    expect(retiros.some((r) => r.id === old.retiro.id && r.status === "ANULADO")).toBe(true);
  });

  it("ingreso: suma al stock, valida, es idempotente y se corrige / anula con motivo y auditoría (sin borrar)", async () => {
    const s = await stk();
    const it = await newItem("ING", { initial: 50 });
    const k = key();
    const a = await s.registerIngreso(admin, { insumoId: it.id, cantidad: 20, observaciones: "Compra proveedor", key: k });
    expect(a).toMatchObject({ replayed: false, stockAntes: 50 });
    expect(a.row).toMatchObject({ stock: 70, ingresos: 20 });
    const b = await s.registerIngreso(admin, { insumoId: it.id, cantidad: 20, observaciones: "Compra proveedor", key: k });
    expect(b).toMatchObject({ replayed: true, id: a.id });
    expect((await row(it.id)).stock).toBe(70); // doble toque / reintento: no duplica
    await expect(s.registerIngreso(admin, { insumoId: it.id, cantidad: 0, key: key() })).rejects.toThrow(/mayor a cero/);
    await expect(s.registerIngreso(admin, { insumoId: it.id, cantidad: 2.5, key: key() })).rejects.toThrow(/entero/);
    await expect(s.registerIngreso(admin, { insumoId: it.id, cantidad: 1, fecha: "2026-13-40", key: key() })).rejects.toThrow(/Fecha/);
    await expect(s.registerIngreso(admin, { insumoId: it.id, cantidad: 1, key: "" })).rejects.toThrow(/clave/);
    await expect(s.correctIngreso(admin, a.id, { cantidad: 25, reason: "" })).rejects.toThrow(/motivo/);
    const fixed = await s.correctIngreso(admin, a.id, { cantidad: 25, observaciones: "Eran 25", reason: "Error de tipeo" });
    expect(fixed.stock).toBe(75);
    const ev = (await s.listStockAudit(admin, { targetId: a.id })).map((e) => e.action).sort();
    expect(ev).toEqual(["INGRESO_CORREGIDO", "INGRESO_REGISTRADO"]);
    const corr = (await s.listStockAudit(admin, { targetId: a.id })).find((e) => e.action === "INGRESO_CORREGIDO")!;
    expect(corr).toMatchObject({ before: { cantidad: 20 }, after: { cantidad: 25 }, reason: "Error de tipeo" });
    await expect(s.correctIngreso(admin, a.id, { cantidad: 25, observaciones: "Eran 25", reason: "igual" })).rejects.toThrow(/No hay cambios/);
    await expect(s.voidMovement(admin, a.id, "")).rejects.toThrow(/motivo/);
    expect((await s.voidMovement(admin, a.id, "Se cargó por error")).stock).toBe(50);
    await expect(s.voidMovement(admin, a.id, "otra vez")).rejects.toThrow(/anulado/);
    await expect(s.correctIngreso(admin, a.id, { cantidad: 9, reason: "motivo ok" })).rejects.toThrow(/anulado/);
    const raw = await q("select status, delta, void_reason from insumo_stock_movements where id = $1", [a.id]);
    expect(raw[0]).toMatchObject({ status: "ANULADO", delta: 25, void_reason: "Se cargó por error" }); // no se borra
  });

  it("descuento automático: un retiro de VARIOS insumos descuenta todos en una sola transacción y un reintento no duplica", async () => {
    const a = await newItem("MA", { initial: 10 });
    const b = await newItem("MB", { initial: 10 });
    const c = await newItem("MC", { initial: 10 });
    const k = key();
    const input = { clientRequestId: `ins-${k}-fixed-key-0001`, responsableId: RESP["CODIFICADO:JULIAN"]!, lines: [{ insumoId: a.id, cantidad: 4 }, { insumoId: b.id, cantidad: 3 }, { insumoId: c.id, cantidad: 0 }] };
    const i = await ins();
    const r1 = await i.createRetiro(codificado, input);
    const r2 = await i.createRetiro(codificado, input); // replay
    expect(r2.created).toBe(false);
    expect([(await row(a.id)).stock, (await row(b.id)).stock, (await row(c.id)).stock]).toEqual([6, 7, 10]);
    expect((await movs(a.id)).filter((m) => m.kind === "EGRESO_RETIRO")).toHaveLength(1);
    expect(await movs(c.id)).toHaveLength(1); // solo el stock inicial: el renglón en 0 no movió nada
    expect((await q("select count(*)::int n from insumo_stock_movements where retiro_id = $1", [r1.retiro.id]))[0]!.n).toBe(2);
    // Atómico: si un renglón falla (insumo inexistente), no queda ni retiro ni descuento.
    await expect(i.createRetiro(codificado, { clientRequestId: `ins-${key()}-fail-0001`, responsableId: RESP["CODIFICADO:JULIAN"]!, lines: [{ insumoId: a.id, cantidad: 1 }, { insumoId: "inventado", cantidad: 1 }] })).rejects.toThrow();
    expect((await row(a.id)).stock).toBe(6);
  });

  it("retiros SIMULTÁNEOS de distintos sectores y ingresos al mismo tiempo: sin pérdidas de actualización", async () => {
    const it = await newItem("CONC", { initial: 100 });
    const s = await stk();
    const who: Array<[typeof masivo, string, string]> = [[masivo, "ENVASADO_MASIVO", "GABO"], [codificado, "CODIFICADO", "JULIAN"], [mp, "MATERIA_PRIMA", "VALENTIN"], [premium, "ENVASADO_PREMIUM", "BELEN"]];
    const jobs: Array<Promise<unknown>> = [];
    for (let n = 0; n < 12; n++) {
      const [a, sec, r] = who[n % 4]!;
      jobs.push(retiro(a, sec, r, [{ insumoId: it.id, cantidad: 5 }]));
    }
    for (let n = 0; n < 4; n++) jobs.push(s.registerIngreso(admin, { insumoId: it.id, cantidad: 10, key: key() }));
    const res = await Promise.allSettled(jobs);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(await row(it.id)).toMatchObject({ stock: 100 - 60 + 40, retiros: 60, ingresos: 40 });
    expect((await movs(it.id)).filter((m) => m.kind === "EGRESO_RETIRO")).toHaveLength(12);
  });

  it("corrección ajusta SOLO la diferencia; anulación revierte; anular dos veces no revierte dos veces", async () => {
    const a = await newItem("COR", { initial: 100 });
    const b = await newItem("COR2", { initial: 100 });
    const i = await ins();
    const r = (await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: a.id, cantidad: 5 }, { insumoId: b.id, cantidad: 2 }])).retiro;
    expect([(await row(a.id)).stock, (await row(b.id)).stock]).toEqual([95, 98]);
    await i.correctRetiro(admin, r.id, { motivo: "Eran 8", lines: [{ insumoId: a.id, cantidad: 8 }, { insumoId: b.id, cantidad: 2 }] });
    expect([(await row(a.id)).stock, (await row(b.id)).stock]).toEqual([92, 98]);
    const mv = (await movs(a.id)).filter((m) => m.kind !== "STOCK_INICIAL");
    expect(mv.map((m) => [m.kind, m.delta])).toEqual([["EGRESO_RETIRO", -5], ["AJUSTE_RETIRO", -3]]); // solo la diferencia
    expect((await movs(b.id)).filter((m) => m.kind !== "STOCK_INICIAL")).toHaveLength(1); // B no cambió: sin movimiento nuevo
    await i.correctRetiro(admin, r.id, { motivo: "Eran 2", lines: [{ insumoId: a.id, cantidad: 2 }] }); // quita B y baja A
    expect([(await row(a.id)).stock, (await row(b.id)).stock]).toEqual([98, 100]);
    await i.anularRetiro(admin, r.id, "Retiro duplicado");
    expect([(await row(a.id)).stock, (await row(b.id)).stock]).toEqual([100, 100]);
    await i.anularRetiro(direccion, r.id, "otra vez");
    expect((await row(a.id)).stock).toBe(100);
    expect((await movs(a.id)).every((m) => m.status === "ACTIVO")).toBe(true); // nada se borra: el libro registra cada paso
    // Cambiar de responsable (sin tocar cantidades) no mueve stock.
    const r2 = (await retiro(codificado, "CODIFICADO", "JULIAN", [{ insumoId: a.id, cantidad: 4 }])).retiro;
    const n0 = (await movs(a.id)).length;
    await i.correctRetiro(admin, r2.id, { motivo: "Otro responsable", responsableId: await respId("CODIFICADO", "GABO") });
    expect((await movs(a.id)).length).toBe(n0);
  });

  it("stock cero y negativo: el retiro real se registra igual (nunca se oculta el consumo) y queda la alerta", async () => {
    const it = await newItem("NEG", { initial: 2 });
    const r = await retiro(elab, "ELABORACION", "SANTINO", [{ insumoId: it.id, cantidad: 5 }]);
    expect(r.created).toBe(true);
    expect(r.retiro.lines[0]!.cantidad).toBe(5);
    expect(await row(it.id)).toMatchObject({ stock: -3, status: "SIN_STOCK", alert: true });
    const z = await newItem("CERO", { initial: 4 });
    await retiro(elab, "ELABORACION", "SANTINO", [{ insumoId: z.id, cantidad: 4 }]);
    expect(await row(z.id)).toMatchObject({ stock: 0, status: "SIN_STOCK" });
    const m = await notifs(it.id);
    expect(m).toHaveLength(1);
    expect(m[0]!.title).toBe("SIN STOCK DE INSUMOS");
  });

  it("alertas: mínimos distintos por insumo, UNA notificación por episodio, reposición la apaga y una nueva caída abre otro episodio", async () => {
    const f = await newItem("ALF", { initial: 30, min: 10, unit: "cajas" });
    const g = await newItem("ALG", { initial: 5, min: 3 });
    expect((await row(f.id)).alert).toBe(false);
    await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: f.id, cantidad: 15 }]); // 15 > 10
    expect((await row(f.id)).alert).toBe(false);
    expect(await notifs(f.id)).toHaveLength(0);
    await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: f.id, cantidad: 6 }]); // 9 ≤ 10
    let ns = await notifs(f.id);
    expect(await row(f.id)).toMatchObject({ stock: 9, status: "STOCK_BAJO", alert: true, unit: "cajas" });
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ id: uuidFromKey(`insumos:bajo:${f.id}:1`), title: "STOCK BAJO DE INSUMOS", sectors: ["ADMINISTRACION"] });
    expect(String(ns[0]!.message)).toBe(`STOCK BAJO DE INSUMOS: STK ALF ${RUN} — stock 9 cajas, mínimo 10. Es necesario reponer.`);
    await retiro(codificado, "CODIFICADO", "JULIAN", [{ insumoId: f.id, cantidad: 2 }]); // sigue bajo: sin duplicados
    expect(await notifs(f.id)).toHaveLength(1);
    // Leer / descartar la notificación NO apaga la alerta (sale del stock calculado en el backend).
    await q("update os_notifications set read_by = '[\"x\"]'::jsonb, dismissed_by = '[\"x\"]'::jsonb where id = $1", [uuidFromKey(`insumos:bajo:${f.id}:1`)]);
    const sm = await (await stk()).getStockSummary(admin);
    expect(sm.items.find((x) => x.insumoId === f.id)!.alert).toBe(true);
    expect(sm.alertCount).toBeGreaterThanOrEqual(1);
    // Otro insumo con su propio mínimo: 5 → 3 ≤ 3 alerta; el anterior no cambia.
    await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: g.id, cantidad: 2 }]);
    expect(await row(g.id)).toMatchObject({ stock: 3, alert: true });
    expect(await notifs(g.id)).toHaveLength(1);
    // Reposición por encima del mínimo: se cierra el episodio.
    await (await stk()).registerIngreso(admin, { insumoId: f.id, cantidad: 20, key: key() });
    expect(await row(f.id)).toMatchObject({ stock: 27, alert: false, status: "DISPONIBLE" });
    expect((await q("select alert_state, alert_episode from insumo_items where id = $1", [f.id]))[0]).toMatchObject({ alert_state: "NORMAL", alert_episode: 1 });
    // Nueva caída: episodio 2 y nueva notificación.
    await retiro(premium, "ENVASADO_PREMIUM", "BELEN", [{ insumoId: f.id, cantidad: 20 }]);
    ns = await notifs(f.id);
    expect(ns).toHaveLength(2);
    expect(ns.map((n) => n.id)).toContain(uuidFromKey(`insumos:bajo:${f.id}:2`));
    // Subir el mínimo por encima del stock abre alerta; bajarlo la cierra.
    const h = await newItem("ALH", { initial: 20, min: 5 });
    expect((await row(h.id)).alert).toBe(false);
    expect((await (await stk()).updateStockConfig(admin, h.id, { minStock: 25 })).alert).toBe(true);
    expect((await (await stk()).updateStockConfig(admin, h.id, { minStock: 5 })).alert).toBe(false);
    // Un insumo dado de baja no alerta.
    await (await ins()).updateInsumoItem(admin, g.id, { active: false });
    expect((await row(g.id)).alert).toBe(false);
  });

  it("insumos SIN stock inicial: los retiros se registran pero no hay stock ni alerta ni notificación", async () => {
    const it = await newItem("SIN", { min: 50 });
    await retiro(mp, "MATERIA_PRIMA", "VALENTIN", [{ insumoId: it.id, cantidad: 100 }]);
    expect(await row(it.id)).toMatchObject({ configured: false, stock: null, status: "SIN_CONFIGURAR", alert: false, retiros: 100 });
    expect(await notifs(it.id)).toHaveLength(0);
    // Al cargar el conteo, lo registrado antes NO descuenta.
    expect((await (await stk()).setInitialStock(admin, { insumoId: it.id, quantity: 60, key: key() })).stock).toBe(60);
  });

  it("ajuste manual: exige stock inicial, motivo y delta distinto de 0; audita antes/después", async () => {
    const s = await stk();
    const raw = await newItem("AJ");
    await expect(s.manualAdjust(admin, { insumoId: raw.id, delta: 3, reason: "inventario", key: key() })).rejects.toThrow(/stock inicial/);
    const it = await newItem("AJ2", { initial: 10 });
    await expect(s.manualAdjust(admin, { insumoId: it.id, delta: 0, reason: "inventario", key: key() })).rejects.toThrow(/cero/);
    await expect(s.manualAdjust(admin, { insumoId: it.id, delta: -4, reason: "", key: key() })).rejects.toThrow(/motivo/);
    const k = key();
    expect((await s.manualAdjust(admin, { insumoId: it.id, delta: -4, reason: "Faltante en el conteo", key: k })).stock).toBe(6);
    expect((await s.manualAdjust(admin, { insumoId: it.id, delta: -4, reason: "Faltante en el conteo", key: k })).stock).toBe(6); // reintento
    const ev = (await s.listStockAudit(admin, { insumoId: it.id })).find((e) => e.action === "AJUSTE_MANUAL")!;
    expect(ev).toMatchObject({ before: { stock: 10 }, after: { delta: -4, stock: 6 }, reason: "Faltante en el conteo" });
    // Un descuento por retiro no se anula a mano.
    const r = await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: it.id, cantidad: 1 }]);
    const mv = (await q("select id from insumo_stock_movements where retiro_id = $1", [r.retiro.id]))[0]!.id as string;
    await expect(s.voidMovement(admin, mv, "intento manual")).rejects.toThrow(/retiro/);
  });

  it("unidad y mínimo configurables por insumo (validados y auditados)", async () => {
    const s = await stk();
    const it = await newItem("CFG", { initial: 3 });
    const r = await s.updateStockConfig(admin, it.id, { unit: "  Rollos ", minStock: 8 });
    expect(r).toMatchObject({ unit: "rollos", minStock: 8, status: "STOCK_BAJO" });
    await expect(s.updateStockConfig(admin, it.id, { minStock: -1 })).rejects.toThrow(/negativo/);
    await expect(s.updateStockConfig(admin, it.id, { unit: "" })).rejects.toThrow(/unidad/);
    await expect(s.updateStockConfig(admin, it.id, {})).rejects.toThrow(/No hay cambios/);
    const ev = (await s.listStockAudit(admin, { insumoId: it.id })).find((e) => e.action === "CONFIGURACION")!;
    expect(ev).toMatchObject({ before: { minStock: 0, unit: "unidades" }, after: { minStock: 8, unit: "rollos" } });
  });

  it("historial de movimientos: saldo acumulado, retiros con sector y responsable, filtros", async () => {
    const s = await stk();
    const it = await newItem("HIS", { initial: 20 });
    await s.registerIngreso(admin, { insumoId: it.id, cantidad: 5, key: key() });
    await retiro(codificado, "CODIFICADO", "JULIAN", [{ insumoId: it.id, cantidad: 7 }]);
    const { items } = await s.listStockMovements(admin, { insumoId: it.id });
    expect(items.map((m) => [m.kind, m.delta, m.balance]).reverse()).toEqual([["STOCK_INICIAL", 20, 20], ["INGRESO", 5, 25], ["EGRESO_RETIRO", -7, 18]]);
    expect(items[0]).toMatchObject({ retiroSector: "CODIFICADO", retiroResponsable: "JULIAN" });
    expect((await s.listStockMovements(admin, { insumoId: it.id, kind: "INGRESO" })).items).toHaveLength(1);
    await expect(s.listStockMovements(admin, { kind: "XX" })).rejects.toThrow(/inválido/);
    await expect(s.listStockMovements(admin, { from: "mal" })).rejects.toThrow(/válida/);
  });

  it("permisos en backend: los sectores operativos (y Depósito / Producción) no tocan el stock; Administración y Dirección sí", async () => {
    const s = await stk();
    const it = await newItem("RBAC", { initial: 10 });
    const mv = (await s.registerIngreso(admin, { insumoId: it.id, cantidad: 1, key: key() })).id;
    for (const a of [masivo, premium, codificado, mp, elab, deposito, produccion]) {
      await expect(s.setInitialStock(a, { insumoId: it.id, quantity: 1, key: key() })).rejects.toThrow(/Solo Administración/);
      await expect(s.registerIngreso(a, { insumoId: it.id, cantidad: 1, key: key() })).rejects.toThrow(/Solo Administración/);
      await expect(s.manualAdjust(a, { insumoId: it.id, delta: 1, reason: "motivo", key: key() })).rejects.toThrow(/Solo Administración/);
      await expect(s.updateStockConfig(a, it.id, { minStock: 3 })).rejects.toThrow(/Solo Administración/);
      await expect(s.correctIngreso(a, mv, { cantidad: 3, reason: "motivo" })).rejects.toThrow(/Solo Administración/);
      await expect(s.voidMovement(a, mv, "motivo")).rejects.toThrow(/Solo Administración/);
      await expect(s.getStockSummary(a)).rejects.toThrow(/Solo Administración/);
      await expect(s.listStockMovements(a)).rejects.toThrow(/Solo Administración/);
      await expect(s.listStockAudit(a)).rejects.toThrow(/Solo Administración/);
    }
    expect((await row(it.id)).stock).toBe(11); // nada cambió
    // Los sectores operativos siguen registrando retiros (el descuento ocurre solo, desde el backend).
    await retiro(masivo, "ENVASADO_MASIVO", "GABO", [{ insumoId: it.id, cantidad: 1 }]);
    expect((await row(it.id)).stock).toBe(10);
    // Administración y Dirección no registran retiros.
    await expect((await ins()).createRetiro(admin, { clientRequestId: `ins-${key()}-adm-0001`, responsableId: RESP["ENVASADO_MASIVO:GABO"]!, lines: [{ insumoId: it.id, cantidad: 1 }] })).rejects.toThrow(/no registra/);
  });
});
