/**
 * DIFERENCIA ME en un Postgres de PRUEBA real, con las MISMAS funciones del servidor (me-diferencia-db). Se SALTA sin
 * base local marcada. Todo el material/pedidos usan un cliente propio de la corrida (no toca datos ajenos).
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

describe.skipIf(Boolean(PROBLEM))(`DIFERENCIA ME en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let svc: typeof import("@/lib/inventory/me-diferencia-db");
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const mats: string[] = [];
  const peds: string[] = [];
  const now = new Date().toISOString();

  const mkMat = async (codigo: string, cliente = CLI) => {
    const id = randomUUID();
    mats.push(id);
    await q("insert into inv_me_materials (id, payload) values ($1,$2)", [id, { id, codigo, descripcion: codigo, cliente, ubicacion: "", unidad: "UN", stockActual: 0, createdAt: now, updatedAt: now }]);
    return id;
  };
  const ingreso = async (codigo: string, total: number, extra: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [id, { id, codigo, cliente: CLI, total, cantidad: total, bultos: 1, anulado: false, createdAt: now, updatedAt: now, ...extra }]);
    return id;
  };
  const salidaOA = async (codigo: string, total: number) => {
    const id = randomUUID();
    await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [id, { id, codigo, cliente: CLI, total, cantidad: total, origen: "OA", reverted: false, createdAt: now, updatedAt: now }]);
  };
  const mkPed = async (cliente: string, producto: string, qty: number, estado = "INGRESO") => {
    const id = randomUUID();
    peds.push(id);
    await q("insert into production_pedidos (id, cliente, producto, q, estado) values ($1,$2,$3,$4,$5)", [id, cliente, producto, qty, estado]);
    return id;
  };
  const link = (materialId: string, pedidoId: string, unidadesPorProducto: number | null = 1) => svc.upsertMePedidoLinkDb(dep, { materialId, pedidoId, unidadesPorProducto });
  const dif = async (materialId: string) => (await svc.listMeDiferenciasDb(dep))[materialId]!;
  const snapshot = async () => JSON.stringify([
    await q("select id, payload from inv_me_ingresos order by id"),
    await q("select id, payload from inv_me_salidas order by id"),
    // Del material solo cambian los datos de vínculo (producto/pedidoId/versión): el resto — incluido el stock — queda igual.
    (await q("select id, payload from inv_me_materials order by id")).map((r) => ({ id: r.id, payload: Object.fromEntries(Object.entries(r.payload as Record<string, unknown>).filter(([k]) => !["producto", "pedidoId", "updatedAt", "updatedBy"].includes(k))) })),
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

  it("1-3) pedido 3.000: envases 2.800 → −200 FALTAN; tapas 3.200 → +200 SOBRAN; etiquetas 3.000 → JUSTO", async () => {
    const ped = await mkPed(CLI, "CREMA A", 3000);
    const [env, tap, eti] = [await mkMat(`ENV-${RUN}`), await mkMat(`TAP-${RUN}`), await mkMat(`ETI-${RUN}`)];
    await ingreso(`ENV-${RUN}`, 2800); await ingreso(`TAP-${RUN}`, 3200); await ingreso(`ETI-${RUN}`, 3000);
    for (const m of [env, tap, eti]) await link(m, ped);
    expect(await dif(env)).toMatchObject({ estado: "FALTAN", diferencia: -200, necesario: 3000, stock: 2800 });
    expect(await dif(tap)).toMatchObject({ estado: "SOBRAN", diferencia: 200 });
    expect(await dif(eti)).toMatchObject({ estado: "JUSTO", diferencia: 0 });
  });

  it("4-5-10) ingresos acumulados (1.000+1.500 → −500; +700 → +200), salida OA que descuenta y ingreso anulado que no cuenta", async () => {
    const ped = await mkPed(CLI, "CREMA B", 3000);
    const m = await mkMat(`ACU-${RUN}`);
    await link(m, ped);
    await ingreso(`ACU-${RUN}`, 1000); await ingreso(`ACU-${RUN}`, 1500);
    expect((await dif(m)).diferencia).toBe(-500);
    await ingreso(`ACU-${RUN}`, 700);
    expect((await dif(m)).diferencia).toBe(200);
    await ingreso(`ACU-${RUN}`, 9999, { anulado: true });
    expect((await dif(m)).diferencia).toBe(200);
    await salidaOA(`ACU-${RUN}`, 300);
    expect(await dif(m)).toMatchObject({ estado: "FALTAN", diferencia: -100 });
  });

  it("6) cambia la cantidad del pedido → se recalcula; 9) consumo no 1:1", async () => {
    const ped = await mkPed(CLI, "CREMA C", 3000);
    const m = await mkMat(`RAT-${RUN}`);
    await ingreso(`RAT-${RUN}`, 250);
    await link(m, ped, 1 / 12);
    expect(await dif(m)).toMatchObject({ estado: "JUSTO", necesario: 250 });
    await q("update production_pedidos set q = 3600 where id = $1", [ped]);
    expect(await dif(m)).toMatchObject({ estado: "FALTAN", diferencia: -50 });
    await link(m, ped, 2); // 2 etiquetas por producto
    expect(await dif(m)).toMatchObject({ estado: "FALTAN", necesario: 7200 });
  });

  it("7) dos clientes con el mismo producto: no se mezclan (candidatos y vínculo rechazan otro cliente)", async () => {
    const mio = await mkPed(CLI, "SERUM", 100);
    const ajeno = await mkPed(CLI2, "SERUM", 999);
    const m = await mkMat(`CLI-${RUN}`);
    const cands = await svc.candidatePedidosDb(dep, m);
    expect(cands.map((c) => c.pedidoId)).toContain(mio);
    expect(cands.map((c) => c.pedidoId)).not.toContain(ajeno);
    await expect(link(m, ajeno)).rejects.toThrow(/otro cliente/);
  });

  it("8) dos pedidos activos del mismo cliente+producto: solo cuenta el elegido (vínculo único); entregados/eliminados se excluyen", async () => {
    const a = await mkPed(CLI, "GEL", 1000);
    const b = await mkPed(CLI, "GEL", 400);
    const entregado = await mkPed(CLI, "GEL", 5000, "ENTREGADO");
    const m = await mkMat(`DOS-${RUN}`);
    await ingreso(`DOS-${RUN}`, 1000);
    expect((await svc.candidatePedidosDb(dep, m)).map((c) => c.pedidoId)).not.toContain(entregado);
    await link(m, a);
    expect(await dif(m)).toMatchObject({ estado: "JUSTO", necesario: 1000 });
    await link(m, b); // elegir otro REEMPLAZA: el mismo stock no cuenta para dos pedidos
    expect(await dif(m)).toMatchObject({ estado: "SOBRAN", necesario: 400, diferencia: 600 });
    expect((await dif(m)).pedidos).toHaveLength(1);
    await q("update production_pedidos set deleted_at = now() where id = $1", [b]);
    expect((await dif(m)).pedidos).toHaveLength(0);
    expect((await dif(m)).estado).toBe("SIN_DATOS");
  });

  it("11) sin pedido → SIN DATOS; sin consumo configurado → SIN CONFIGURAR (no asume 1:1)", async () => {
    const m = await mkMat(`SIN-${RUN}`);
    await ingreso(`SIN-${RUN}`, 10);
    expect((await dif(m)).estado).toBe("SIN_DATOS");
    const ped = await mkPed(CLI, "X", 3000);
    await link(m, ped, null);
    expect(await dif(m)).toMatchObject({ estado: "SIN_CONFIGURAR", diferencia: null });
  });

  const setProducto = async (materialId: string, producto: string, cliente?: string) => {
    const { resolveProductoLink } = await import("@/lib/inventory/me-producto-link");
    const { getDb } = await import("@/lib/db/client");
    await q("update inv_me_materials set payload = payload || $2::jsonb where id = $1", [materialId, JSON.stringify({ producto, ...(cliente ? { cliente } : {}) })]);
    await getDb().transaction(async (tx) => { await resolveProductoLink(tx, dep, materialId); });
  };

  it("PRODUCTO) cliente + producto exacto con UN pedido activo → se vincula solo, conserva consumo, y guarda la referencia estable", async () => {
    const ped = await mkPed(CLI, "CREMA FACIAL", 3000);
    await mkPed(CLI, "SHAMPOO", 999);
    await mkPed(CLI2, "CREMA FACIAL", 111);
    const m = await mkMat(`PRO-${RUN}`);
    await ingreso(`PRO-${RUN}`, 2800);
    await setProducto(m, "crema  facial"); // igualdad normalizada, no por parecido
    expect(await dif(m)).toMatchObject({ estado: "SIN_CONFIGURAR", producto: "crema  facial" });
    const [mat] = await q("select payload from inv_me_materials where id = $1", [m]);
    expect((mat!.payload as Record<string, unknown>).pedidoId).toBe(ped);
    await link(m, ped, 1);
    expect(await dif(m)).toMatchObject({ estado: "FALTAN", diferencia: -200, candidatos: 1 });
    // cambiar a un producto que no existe: el vínculo viejo se quita y queda SIN DATOS (stock intacto)
    await setProducto(m, "PRODUCTO INEXISTENTE");
    expect(await dif(m)).toMatchObject({ estado: "SIN_DATOS", stock: 2800 });
    await setProducto(m, "CREMA FACIAL"); // vuelve a un único candidato: se re-vincula solo con consumo ya configurado? no (se quitó) → SIN CONFIGURAR
    expect((await dif(m)).estado).toBe("SIN_CONFIGURAR");
  });

  it("PRODUCTO) mismo producto en varios pedidos activos → ELEGIR PEDIDO hasta que Depósito elija; otro cliente no se mezcla", async () => {
    const p1 = await mkPed(CLI, "BALSAMO", 1000);
    await mkPed(CLI, "BALSAMO", 500);
    await mkPed(CLI2, "BALSAMO", 70);
    const m = await mkMat(`BAL-${RUN}`);
    await ingreso(`BAL-${RUN}`, 1000);
    await setProducto(m, "BALSAMO");
    expect(await dif(m)).toMatchObject({ estado: "ELEGIR_PEDIDO", candidatos: 2, pedidos: [] });
    await link(m, p1, 1);
    expect(await dif(m)).toMatchObject({ estado: "JUSTO", necesario: 1000 });
  });

  it("PRODUCTO) sin pedido registrado: el producto queda como texto y DIFERENCIA en SIN DATOS; histórico sin producto sigue funcionando", async () => {
    const m = await mkMat(`TXT-${RUN}`);
    await ingreso(`TXT-${RUN}`, 50);
    await setProducto(m, "PRODUCTO SIN PEDIDO");
    expect(await dif(m)).toMatchObject({ estado: "SIN_DATOS", producto: "PRODUCTO SIN PEDIDO", stock: 50, candidatos: 0 });
    const viejo = await mkMat(`OLD-${RUN}`); // sin campo producto (registro anterior)
    expect(await dif(viejo)).toMatchObject({ estado: "SIN_DATOS", producto: "" });
  });

  it("PRODUCTO) la planilla guarda producto por celda (patchMeSheetCells), resuelve el pedido y no cambia el stock", async () => {
    const ped = await mkPed(CLI, "TONICO", 2000);
    const m = await mkMat(`CEL-${RUN}`);
    await ingreso(`CEL-${RUN}`, 2000);
    const { patchMeSheetCells } = await import("@/lib/inventory/me-planilla-db");
    const [row] = await q("select payload from inv_me_materials where id = $1", [m]);
    const before = await snapshot();
    void before;
    await patchMeSheetCells(dep, "me_inventario", [{ id: m, field: "producto", value: "TONICO", expectedVersion: (row!.payload as Record<string, string>).updatedAt } as never]);
    const [after] = await q("select payload from inv_me_materials where id = $1", [m]);
    expect(after!.payload).toMatchObject({ producto: "TONICO", pedidoId: ped });
    expect((await dif(m)).stock).toBe(2000);
    // ingreso con producto: queda guardado en el ingreso y hereda la referencia al pedido
    const ing = await ingreso(`CEL-${RUN}`, 0, { materialId: m, bultos: 1, cantidad: 0 });
    const [ir] = await q("select payload from inv_me_ingresos where id = $1", [ing]);
    await patchMeSheetCells(dep, "me_ingresos", [{ id: ing, field: "producto", value: " tonico ", expectedVersion: (ir!.payload as Record<string, string>).updatedAt } as never]);
    const [ir2] = await q("select payload from inv_me_ingresos where id = $1", [ing]);
    expect(ir2!.payload).toMatchObject({ producto: "tonico", pedidoId: ped });
  });

  it("12) vincular/quitar/recalcular NO cambia stock, movimientos, ajustes ni pedidos; permisos y auditoría", async () => {
    const ped = await mkPed(CLI, "Z", 500);
    const m = await mkMat(`NOP-${RUN}`);
    await ingreso(`NOP-${RUN}`, 400);
    const before = await snapshot();
    await link(m, ped);
    await dif(m);
    await link(m, ped, 3);
    expect(await snapshot()).toBe(before);
    await expect(svc.upsertMePedidoLinkDb(elab, { materialId: m, pedidoId: ped, unidadesPorProducto: 1 })).rejects.toThrow(/no puede modificar/);
    await expect(link(m, ped, 0)).rejects.toThrow(/mayor que 0/);
    const audit = await q("select payload->>'action' as a from inv_audit where payload->>'entityId' = $1 and payload->>'action' like 'pedido_link_%'", [m]);
    expect(audit.map((r) => r.a)).toEqual(expect.arrayContaining(["pedido_link_create", "pedido_link_update"]));
    await svc.removeMePedidoLinkDb(dep, m, ped);
    expect(await snapshot()).toBe(before);
    expect((await dif(m)).estado).toBe("SIN_DATOS");
  });
});
