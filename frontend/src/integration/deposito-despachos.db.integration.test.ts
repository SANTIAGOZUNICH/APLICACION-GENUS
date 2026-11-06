/**
 * «Entregas Producción» contra un Postgres de PRUEBA real (migración 0073): persistencia tras recarga, remitos con ceros,
 * idempotencia (incluida la carrera), despachos parciales, auditoría, bajas lógicas y NINGÚN efecto sobre stock / MP.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/deposito-despachos.db.integration.test.ts npm run test:e2e:semanas-priorities-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const MARK = `IT-DESP-${RUN}`;
const dep = { email: "it-desp-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const, displayName: MARK };
const prod = { email: "it-desp-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: `${MARK}-prod` };
const base = { fecha: "2032-05-10", remito: "0001-00000045", cliente: `CLI ${MARK}`, producto: `PROD ${MARK}`, egreso: "B001", bultos: 5, cantidad: 24 };

describe.skipIf(Boolean(PROBLEM))(`Entregas Producción en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => (await import("@/lib/despachos/despachos-service")).getDespachosService();
  const mine = async () => (await (await svc()).list(dep)).filter((r) => r.cliente === base.cliente);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 90_000);

  afterAll(async () => {
    await q("delete from deposito_despachos_audit where despacho_id in (select id::text from deposito_despachos where created_by like $1)", [`${MARK}%`]).catch(() => undefined);
    await q("delete from deposito_despachos where created_by like $1", [`${MARK}%`]).catch(() => undefined);
    await pool?.end();
  });

  it("crea, persiste tras recargar el módulo y conserva el remito con ceros", async () => {
    const { record } = await (await svc()).create(dep, base);
    vi.resetModules(); // «recarga»: nueva instancia del servicio, los datos salen de la base
    const rows = await mine();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: record.id, remito: "0001-00000045", fecha: "2032-05-10", egreso: "B001", bultos: 5, cantidad: 24, cantidadTotal: 120, createdBy: MARK });
    const raw = await q("select remito, fecha::text f from deposito_despachos where id = $1", [record.id]);
    expect(raw[0]).toMatchObject({ remito: "0001-00000045", f: "2032-05-10" });
  });

  it("misma clave (reintento / doble clic / carrera) crea UNA sola fila", async () => {
    const s = await svc();
    const key = `k-${randomUUID()}`;
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => s.create(dep, { ...base, remito: "RACE", idempotencyKey: key }).catch((e) => e)));
    const ok = [a, b, c].filter((r) => !(r instanceof Error));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const rows = await q("select id from deposito_despachos where idempotency_key = $1", [key]);
    expect(rows).toHaveLength(1);
  });

  it("dos despachos parciales del mismo pedido: dos filas, ninguna reemplaza a la otra", async () => {
    const s = await svc();
    await s.create(dep, { ...base, remito: "P-1", pedidoOp: `OP-${RUN}`, bultos: 10, cantidad: 10 });
    await s.create(dep, { ...base, remito: "P-2", pedidoOp: `OP-${RUN}`, bultos: 6, cantidad: 10 });
    const rows = (await mine()).filter((r) => r.pedidoOp === `OP-${RUN}`);
    expect(rows.map((r) => r.cantidadTotal).sort((a, b) => a - b)).toEqual([60, 100]);
  });

  it("edición por celda: guarda, audita antes/después, detecta conflicto y valida", async () => {
    const s = await svc();
    const { record } = await s.create(dep, { ...base, remito: "EDIT" });
    const [ok] = await s.patchCells(dep, [{ id: record.id, field: "remito", value: "00099", expectedVersion: record.updatedAt }]);
    expect(ok.ok).toBe(true);
    const [stale] = await s.patchCells(dep, [{ id: record.id, field: "bultos", value: "9", expectedVersion: record.updatedAt }]);
    expect(!stale.ok && stale.code).toBe("CONFLICT");
    const [bad] = await s.patchCells(dep, [{ id: record.id, field: "bultos", value: "-1", expectedVersion: (ok as { record: { updatedAt: string } }).record.updatedAt }]);
    expect(bad.ok).toBe(false);
    expect((await q("select remito from deposito_despachos where id = $1", [record.id]))[0]!.remito).toBe("00099");
    const hist = await s.listAudit(dep, record.id);
    expect(hist.find((h) => h.action === "update")).toMatchObject({ field: "remito", beforeValue: "EDIT", afterValue: "00099", actorName: MARK });
  });

  it("baja lógica: desaparece del listado, la fila y su historial se conservan", async () => {
    const s = await svc();
    const { record } = await s.create(dep, { ...base, remito: "DEL" });
    expect(await s.delete(dep, record.id)).toBe(true);
    expect((await mine()).some((r) => r.id === record.id)).toBe(false);
    const raw = await q("select deleted_at, deleted_by from deposito_despachos where id = $1", [record.id]);
    expect(raw[0]!.deleted_at).not.toBeNull();
    expect(raw[0]!.deleted_by).toBe(MARK);
    expect((await s.listAudit(dep, record.id)).map((h) => h.action)).toEqual(["create", "delete"]);
  });

  it("alta masiva: una sola operación, idempotente por clave, filas incompletas (sin fecha) y filas inválidas informadas", async () => {
    const s = await svc();
    const rows = [
      { fecha: "2032-06-01", remito: "000900", cliente: base.cliente, producto: "A", bultos: 1, cantidad: 10, idempotencyKey: `bulk-${RUN}-0` },
      { fecha: "", remito: "000901", cliente: base.cliente, producto: "B", idempotencyKey: `bulk-${RUN}-1` }, // incompleta: sin fecha ni cantidades
      { fecha: "no-es-fecha", remito: "x", cliente: base.cliente, idempotencyKey: `bulk-${RUN}-2` }, // inválida
      { fecha: "2032-06-03", remito: "000902", cliente: base.cliente, producto: "C", bultos: 2, cantidad: 10, idempotencyKey: `bulk-${RUN}-3` },
    ];
    const r1 = await s.createMany(dep, rows);
    expect(r1.map((r) => r.ok)).toEqual([true, true, false, true]);
    const r2 = await s.createMany(dep, rows); // reintento / doble pegado del mismo envío
    expect(r2.filter((r) => r.ok && r.created)).toHaveLength(0);
    const got = (await mine()).filter((r) => ["000900", "000901", "000902"].includes(r.remito));
    expect(got).toHaveLength(3);
    expect(got.find((r) => r.remito === "000901")?.fecha).toBeNull();
    const audits = await q("select count(*)::int n from deposito_despachos_audit where action = 'create' and despacho_id in (select id::text from deposito_despachos where remito in ('000900','000901','000902') and cliente = $1)", [base.cliente]);
    expect(Number(audits[0]!.n)).toBe(3);
    const [ed] = await s.patchCells(dep, [{ id: got[0]!.id, field: "fecha", value: "", expectedVersion: got[0]!.updatedAt }]);
    expect(ed.ok).toBe(true); // vaciar la fecha de una fila existente
  });

  it("planilla: egreso B001 con varias filas, TOTAL = BULTOS × CANTIDAD y recálculo al editar", async () => {
    const s = await svc();
    const mk = (producto: string, bultos: number, cantidad: number) => s.create(dep, { ...base, remito: "2938", producto, bultos, cantidad, idempotencyKey: `b001-${RUN}-${producto}-${bultos}` });
    const a = (await mk("CREMA EXFOLIANTE PARA MANOS", 17, 56)).record;
    const b = (await mk("ACEITE PARA MANOS", 18, 56)).record;
    const c = (await mk("CREMA EXFOLIANTE PARA MANOS", 1, 28)).record;
    expect([a.cantidadTotal, b.cantidadTotal, c.cantidadTotal]).toEqual([952, 1008, 28]);
    const [r] = await s.patchCells(dep, [{ id: a.id, field: "bultos", value: "20", expectedVersion: a.updatedAt }]);
    expect(r.ok).toBe(true);
    expect(Number((await q("select cantidad_total t from deposito_despachos where id = $1", [a.id]))[0]!.t)).toBe(1120);
    const [neg] = await s.patchCells(dep, [{ id: b.id, field: "cantidad", value: "-3", expectedVersion: b.updatedAt }]);
    expect(neg.ok).toBe(false);
    const [dec] = await s.patchCells(dep, [{ id: b.id, field: "cantidad", value: "2,5", expectedVersion: b.updatedAt }]);
    expect(dec.ok).toBe(false);
  });

  it("CONTROL y ENTREGADO independientes, con quién/cuándo, persistentes y sin tocar stock", async () => {
    const s = await svc();
    const { record } = await s.create(dep, { ...base, remito: "CHK", bultos: 2, cantidad: 5 });
    const [c1] = await s.patchCells(dep, [{ id: record.id, field: "control", value: "TRUE", expectedVersion: record.updatedAt }]);
    expect(c1.ok).toBe(true);
    vi.resetModules();
    const row = (await mine()).find((x) => x.id === record.id)!;
    expect(row).toMatchObject({ control: true, controlBy: MARK, entregado: false });
    expect(row.controlAt).toBeTruthy();
    const s2 = await svc();
    const [c2] = await s2.patchCells(dep, [{ id: record.id, field: "entregado", value: "TRUE", expectedVersion: row.updatedAt }]);
    expect(c2.ok).toBe(true);
    const raw = await q("select control, entregado, entregado_by from deposito_despachos where id = $1", [record.id]);
    expect(raw[0]).toMatchObject({ control: true, entregado: true, entregado_by: MARK });
  });

  it("migración 0082: fila previa conserva su total; sin cantidad queda pendiente", async () => {
    const id = randomUUID();
    await q("insert into deposito_despachos (id, fecha, remito, cliente, producto, bultos, cantidad_total, created_by, created_by_sector) values ($1,'2032-01-01','LEG',$2,'X',3,250,$3,'DEPOSITO')", [id, base.cliente, MARK]);
    const id2 = randomUUID();
    await q("insert into deposito_despachos (id, fecha, remito, cliente, producto, bultos, cantidad_total, created_by, created_by_sector) values ($1,'2032-01-02','LEG2',$2,'Y',17,952,$3,'DEPOSITO')", [id2, base.cliente, MARK]);
    // Re-ejecuta el backfill de la migración sobre las filas previas: solo completa CANTIDAD cuando el cociente es exacto.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("drizzle/0082_despachos_planilla.sql", "utf8");
    const upd = /UPDATE "deposito_despachos"[\s\S]*?;/.exec(sql)![0];
    await q(upd);
    const row = (await mine()).find((x) => x.id === id)!;
    expect(row.cantidadTotal).toBe(250);
    expect(row.cantidad).toBeNull(); // 250 / 3 no es entero: no se inventa
    const row2 = (await mine()).find((x) => x.id === id2)!;
    expect(row2).toMatchObject({ cantidad: 56, cantidadTotal: 952 });
    const cols = await q("select column_name from information_schema.columns where table_name = 'deposito_despachos' and column_name in ('egreso','cantidad','comentarios','control','entregado','control_by','entregado_at')");
    expect(cols).toHaveLength(7);
  });

  it("el CHECK de la base rechaza cantidades negativas", async () => {
    await expect(q("insert into deposito_despachos (fecha, bultos, created_by, created_by_sector) values ('2032-05-10', -1, $1, 'DEPOSITO')", [MARK])).rejects.toThrow();
  });

  it("permisos: Producción consulta pero no escribe", async () => {
    const s = await svc();
    expect((await s.list(prod)).length).toBeGreaterThan(0);
    await expect(s.create(prod, base)).rejects.toThrow();
  });

  it("no genera movimientos de stock ni toca el inventario de MP/ME", async () => {
    const s = await svc();
    const count = async () => ({
      mov: (await q("select count(*)::int n from mp_stock_movements"))[0]!.n,
      mp: (await q("select count(*)::int n, coalesce(sum((payload->>'cantidadKg')::float),0) s from inv_mp_stock"))[0],
    });
    const before = await count();
    const { record } = await s.create(dep, { ...base, remito: "NOSTOCK" });
    await s.patchCells(dep, [{ id: record.id, field: "cantidad", value: "7", expectedVersion: record.updatedAt }]);
    await s.delete(dep, record.id);
    expect(await count()).toEqual(before);
  });
});
