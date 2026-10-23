/**
 * DIFERENCIA de INGRESOS ME en un Postgres de PRUEBA real, con las MISMAS funciones del servidor. Control de recepción:
 * acumulado por pedido + material − lo que pide el pedido, con snapshot por ingreso; NUNCA usa el saldo de Stock ME.
 * Se SALTA sin base local marcada. Cada corrida usa clientes propios (no toca datos ajenos).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLI = `CLI DIF ${RUN}`;
const CLI2 = `CLI DIF OTRO ${RUN}`;
const dep = { email: "it-dif-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" } as never;
const elab = { email: "it-dif-el@laboratoriogenus.com.ar", sector: "ELABORACION" } as never;
const calidad = { email: "it-dif-ca@laboratoriogenus.com.ar", sector: "CALIDAD" } as never;

describe.skipIf(Boolean(PROBLEM))(`DIFERENCIA de Ingresos ME en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let svc: typeof import("@/lib/inventory/me-diferencia-db");
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const mats: string[] = [];
  const peds: string[] = [];
  let clock = 0;
  const at = () => new Date(Date.UTC(2026, 9, 1, 10, 0, ++clock)).toISOString();

  const mkMat = async (codigo: string, cliente = CLI) => {
    const id = randomUUID();
    mats.push(id);
    await q("insert into inv_me_materials (id, payload) values ($1,$2)", [id, { id, codigo, descripcion: codigo, cliente, ubicacion: "", unidad: "UN", stockActual: 0, createdAt: at(), updatedAt: at() }]);
    return id;
  };
  /** Ingreso confirmado (ya registrado) de un material, con producto (si se indica). */
  const ingreso = async (materialId: string, codigo: string, total: number, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    const t = at();
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [id, { id, codigo, materialId, cliente: CLI, total, cantidad: total, bultos: 1, anulado: false, createdAt: t, updatedAt: t, ...extra }]);
    return id;
  };
  const salidaOA = async (codigo: string, total: number) => {
    await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [randomUUID(), { id: randomUUID(), codigo, cliente: CLI, total, cantidad: total, origen: "OA", reverted: false, createdAt: at(), updatedAt: at() }]);
  };
  const mkPed = async (cliente: string, producto: string, qty: number, estado = "INGRESO") => {
    const id = randomUUID();
    peds.push(id);
    await q("insert into production_pedidos (id, cliente, producto, q, estado) values ($1,$2,$3,$4,$5)", [id, cliente, producto, qty, estado]);
    return id;
  };
  const sync = (ingresoId: string, resetSnapshot = false) => svc.syncIngresoAfterWrite(dep, ingresoId, { resetSnapshot });
  const link = (ingresoId: string, pedidoId: string, unidadesPorProducto?: number | null) => svc.linkIngresoPedidoDb(dep, { ingresoId, pedidoId, unidadesPorProducto });
  const row = async (ingresoId: string) => (await svc.listIngresoDiferenciasDb(dep)).ingresos[ingresoId]!;
  const payloadOf = async (ingresoId: string) => (await q("select payload from inv_me_ingresos where id = $1", [ingresoId]))[0]!.payload as Record<string, unknown>;
  const snapshot = async () => JSON.stringify([
    // De los ingresos solo pueden cambiar producto/pedidoId/difSnapshot: cantidades, fechas y totales quedan idénticos.
    (await q("select id, payload from inv_me_ingresos order by id")).map((r) => ({ id: r.id, payload: Object.fromEntries(Object.entries(r.payload as Record<string, unknown>).filter(([k]) => !["producto", "pedidoId", "difSnapshot"].includes(k))) })),
    await q("select id, payload from inv_me_salidas order by id"),
    (await q("select id, payload from inv_me_materials order by id")).map((r) => ({ id: r.id, payload: Object.fromEntries(Object.entries(r.payload as Record<string, unknown>).filter(([k]) => !["producto", "updatedAt"].includes(k))) })),
    await q("select id, payload from inv_ajustes order by id"),
    await q("select id, q, estado, deleted_at from production_pedidos order by id"),
  ]);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    svc = await import("@/lib/inventory/me-diferencia-db");
  }, 60_000);

  afterAll(async () => {
    await q("delete from me_material_pedido_links where material_id = any($1)", [mats]).catch(() => undefined);
    await q("delete from production_pedidos where id = any($1)", [peds]).catch(() => undefined);
    await q("delete from inv_me_ingresos where payload->>'cliente' in ($1,$2)", [CLI, CLI2]).catch(() => undefined);
    await q("delete from inv_me_salidas where payload->>'cliente' in ($1,$2)", [CLI, CLI2]).catch(() => undefined);
    await q("delete from inv_me_materials where id = any($1)", [mats]).catch(() => undefined);
    await pool?.end();
  });

  it("1) pedido 3.000: ingresos de 1.000 → −2.000; +1.500 → −500; +700 → +200 SOBRAN (cada fila conserva su resultado)", async () => {
    const ped = await mkPed(CLI, "CREMA FACIAL", 3000);
    const m = await mkMat(`ENV-${RUN}`);
    const i1 = await ingreso(m, `ENV-${RUN}`, 1000, { producto: "crema facial" });
    await sync(i1);
    expect((await row(i1)).estado).toBe("SIN_CONFIGURAR"); // pedido único vinculado solo, pero sin consumo por producto: no se asume 1:1
    await link(i1, ped, 1);
    expect(await row(i1)).toMatchObject({ estado: "FALTAN", diferencia: -2000, snapshot: { diferencia: -2000, estado: "FALTAN" } });
    const i2 = await ingreso(m, `ENV-${RUN}`, 1500, { producto: "CREMA FACIAL" });
    await sync(i2);
    expect(await row(i2)).toMatchObject({ estado: "FALTAN", diferencia: -500, acumulado: 2500, snapshot: { diferencia: -500 } });
    const i3 = await ingreso(m, `ENV-${RUN}`, 700, { producto: "CREMA FACIAL" });
    await sync(i3);
    expect(await row(i3)).toMatchObject({ estado: "SOBRAN", diferencia: 200, acumulado: 3200 });
    // los anteriores no cambiaron
    expect((await row(i1)).snapshot?.diferencia).toBe(-2000);
    expect((await row(i2)).snapshot?.diferencia).toBe(-500);
    expect((await payloadOf(i2)).pedidoId).toBe(ped); // referencia estable
  });

  it("2) las SALIDAS/consumos y los ajustes de Stock ME NO cambian la diferencia de los ingresos", async () => {
    const ped = await mkPed(CLI, "SERUM", 3000);
    const m = await mkMat(`TAP-${RUN}`);
    const ids = [] as string[];
    for (const n of [1000, 1500, 700]) {
      const id = await ingreso(m, `TAP-${RUN}`, n, { producto: "SERUM" });
      ids.push(id);
      if (ids.length === 1) { await sync(id); await link(id, ped, 1); } else await sync(id);
    }
    const antes = await Promise.all(ids.map(async (i) => { const r = await row(i); return [r.estado, r.diferencia, r.acumulado]; }));
    expect(antes.map((a) => a[1])).toEqual([-2000, -500, 200]);
    await salidaOA(`TAP-${RUN}`, 2000); // Producción consume 2.000: el stock baja
    await q("insert into inv_ajustes (id, payload) values ($1,$2)", [randomUUID(), { id: randomUUID(), module: "ME", entityId: m, diferencia: -50, motivo: "conteo", createdAt: at() }]);
    const despues = await Promise.all(ids.map(async (i) => { const r = await row(i); return [r.estado, r.diferencia, r.acumulado]; }));
    expect(despues).toEqual(antes);
  });

  it("3) el pedido cambia de cantidad o de consumo: el resultado histórico NO se reescribe; «hoy» queda aparte", async () => {
    const ped = await mkPed(CLI, "TONICO", 3000);
    const m = await mkMat(`ETI-${RUN}`);
    const i1 = await ingreso(m, `ETI-${RUN}`, 2500, { producto: "TONICO" });
    await sync(i1);
    await link(i1, ped, 1);
    expect(await row(i1)).toMatchObject({ diferencia: -500, snapshot: { diferencia: -500, pedidoUnidades: 3000 } });
    await q("update production_pedidos set q = 2000 where id = $1", [ped]);
    expect(await row(i1)).toMatchObject({ snapshot: { diferencia: -500, estado: "FALTAN" }, actual: { estado: "SOBRAN", diferencia: 500 } });
    const { ingresoDiferenciaView } = await import("@/lib/inventory/me-diferencia");
    expect(ingresoDiferenciaView(await row(i1)).text).toBe("−500 FALTAN · hoy +500 SOBRAN");
    await link(i1, ped, 2); // mismo ingreso, otro consumo → se vuelve a vincular a propósito: recalcula y queda auditado
    expect(await row(i1)).toMatchObject({ snapshot: { diferencia: 2500 - 4000, unidadesPorProducto: 2 } });
  });

  it("4) editar el ingreso (cantidad) recalcula SU snapshot con auditoría; los posteriores conservan el suyo y muestran «hoy»", async () => {
    const ped = await mkPed(CLI, "BALSAMO", 3000);
    const m = await mkMat(`EDI-${RUN}`);
    const a = await ingreso(m, `EDI-${RUN}`, 1000, { producto: "BALSAMO" });
    await sync(a); await link(a, ped, 1);
    const b = await ingreso(m, `EDI-${RUN}`, 1500, { producto: "BALSAMO" });
    await sync(b);
    expect((await row(b)).snapshot?.diferencia).toBe(-500);
    const { patchMeSheetCells } = await import("@/lib/inventory/me-planilla-db");
    await patchMeSheetCells(dep, "me_ingresos", [{ id: a, field: "cantidad", value: "1200", expectedVersion: (await payloadOf(a)).updatedAt } as never]);
    expect(await row(a)).toMatchObject({ snapshot: { diferencia: -1800, acumulado: 1200 } });
    expect(await row(b)).toMatchObject({ snapshot: { diferencia: -500 }, actual: { diferencia: -300 } }); // histórico intacto, hoy distinto
    const audit = await q("select payload->>'action' as a, payload->'before'->'difSnapshot'->>'diferencia' as antes from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'dif_snapshot_recalculado'", [a]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.antes).toBe("-2000");
  });

  it("5) no mezcla clientes ni productos: candidatos solo del cliente del ingreso; dos productos del mismo código acumulan por separado", async () => {
    const mio = await mkPed(CLI, "CREMA A", 100);
    const mio2 = await mkPed(CLI, "CREMA B", 100);
    const ajeno = await mkPed(CLI2, "CREMA A", 999);
    const m = await mkMat(`MIX-${RUN}`);
    const i1 = await ingreso(m, `MIX-${RUN}`, 60, { producto: "CREMA A" });
    const i2 = await ingreso(m, `MIX-${RUN}`, 70, { producto: "CREMA B" });
    await sync(i1); await sync(i2);
    await link(i1, mio, 1); await link(i2, mio2, 1);
    expect(await row(i1)).toMatchObject({ acumulado: 60, diferencia: -40 });
    expect(await row(i2)).toMatchObject({ acumulado: 70, diferencia: -30 }); // no suma el ingreso del otro producto
    const cands = (await svc.candidatePedidosDb(dep, i1)).map((c) => c.pedidoId);
    expect(cands).toEqual(expect.arrayContaining([mio, mio2]));
    expect(cands).not.toContain(ajeno);
    await expect(link(i1, ajeno, 1)).rejects.toThrow(/otro cliente/);
  });

  it("6) mismo cliente + producto en dos pedidos activos → ELEGIR PEDIDO hasta que se elija; entregados/eliminados no cuentan", async () => {
    const a = await mkPed(CLI, "GEL", 1000);
    await mkPed(CLI, "GEL", 400);
    const entregado = await mkPed(CLI, "GEL", 5000, "ENTREGADO");
    const m = await mkMat(`GEL-${RUN}`);
    const i1 = await ingreso(m, `GEL-${RUN}`, 1000, { producto: "GEL" });
    await sync(i1);
    expect(await row(i1)).toMatchObject({ estado: "ELEGIR_PEDIDO", candidatos: 2, pedidoId: null });
    expect((await svc.candidatePedidosDb(dep, i1)).map((c) => c.pedidoId)).not.toContain(entregado);
    await link(i1, a, 1);
    expect(await row(i1)).toMatchObject({ estado: "JUSTO", pedidoId: a });
  });

  it("7) sin pedido → SIN DATOS; sin consumo configurado → SIN CONFIGURAR; ingreso sin producto → SIN DATOS (no se mezcla)", async () => {
    const m = await mkMat(`SIN-${RUN}`);
    const sinProd = await ingreso(m, `SIN-${RUN}`, 10);
    await sync(sinProd);
    expect((await row(sinProd)).estado).toBe("SIN_DATOS");
    const noPed = await ingreso(m, `SIN-${RUN}`, 10, { producto: "PRODUCTO SIN PEDIDO" });
    await sync(noPed);
    expect((await row(noPed)).estado).toBe("SIN_DATOS");
    await mkPed(CLI, "PRODUCTO CON PEDIDO", 50);
    const sinCfg = await ingreso(m, `SIN-${RUN}`, 10, { producto: "PRODUCTO CON PEDIDO" });
    await sync(sinCfg);
    expect(await row(sinCfg)).toMatchObject({ estado: "SIN_CONFIGURAR", diferencia: null, snapshot: null });
  });

  it("8) vincular / editar / quitar NO cambia stock, movimientos, ajustes ni cantidades de pedidos; permisos; ingresos anulados fuera", async () => {
    const ped = await mkPed(CLI, "NOP", 500);
    const m = await mkMat(`NOP-${RUN}`);
    const i = await ingreso(m, `NOP-${RUN}`, 400, { producto: "NOP" });
    const anul = await ingreso(m, `NOP-${RUN}`, 9999, { producto: "NOP", anulado: true });
    const before = await snapshot();
    await sync(i); await link(i, ped, 1); await link(i, ped, 2); await row(i);
    expect(await snapshot()).toBe(before);
    await expect(svc.linkIngresoPedidoDb(elab, { ingresoId: i, pedidoId: ped, unidadesPorProducto: 1 })).rejects.toThrow(/no puede modificar/);
    await expect(link(i, ped, 0)).rejects.toThrow(/mayor que 0/);
    expect((await svc.listIngresoDiferenciasDb(dep)).ingresos[anul]).toBeUndefined();
    const acciones = (await q("select payload->>'action' as a from inv_audit where payload->>'entityId' = $1", [i])).map((r) => r.a);
    expect(acciones).toEqual(expect.arrayContaining(["pedido_link", "dif_snapshot"]));
    await svc.unlinkIngresoPedidoDb(dep, i);
    expect((await row(i)).estado).toBe("SIN_DATOS");
    expect(await snapshot()).toBe(before);
  });

  it("9) el contexto de PREVISTA solo lo reciben quienes pueden escribir ingresos; el sector que solo lee ve resultados, no pedidos", async () => {
    expect((await svc.listIngresoDiferenciasDb(dep)).previsto?.pedidos.length).toBeGreaterThan(0);
    const lector = await svc.listIngresoDiferenciasDb(calidad);
    expect(lector.previsto).toBeUndefined();
    expect(Object.keys(lector.ingresos).length).toBeGreaterThan(0);
  });
});
