/**
 * Pedidos de Producción: OP correlativo automático contra un Postgres de PRUEBA real. N altas simultáneas con OP automático →
 * OP únicos y correlativos (advisory lock + MAX+1 dentro de la transacción de creación); un OP viejo del cliente se reasigna;
 * el OP manual se respeta; los pedidos históricos no se tocan.
 * Se corre con `GENUS_E2E_VITEST_FILES=src/integration/pedidos-op-auto.db.integration.test.ts bash scripts/e2e/run-semanas-priorities-db-local.sh`
 * (o `npm run test:e2e:pedidos-op-db`; levanta un Postgres descartable; nunca usa la base real).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const actor = { email: `it-pedop-${RUN}@laboratoriogenus.com.ar`, sector: "PRODUCCION" as never };
const CLI = `IT-PEDOP-${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`OP automático de Pedidos en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => (await import("@/lib/production-pedidos/service")).getProductionPedidosService();
  let base = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.VITEST = "false"; // fuerza el camino REAL (Postgres), no la memoria de pruebas
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.GENUS_FEATURE_MEMORY;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    // Pedido «histórico» con OP real alto, sembrado directo: la base de prueba arranca vacía.
    base = 900000 + Number(RUN.slice(-4));
    await q("insert into production_pedidos (id, op, cliente, producto, fecha) values (gen_random_uuid(), $1, $2, 'HIST', '2026-01-13')", [String(base), CLI]);
  }, 90_000);

  afterAll(async () => {
    await q("delete from production_pedidos where cliente like $1", [`${CLI}%`]).catch(() => undefined);
    await pool?.end();
  });

  it("nextOp = último OP numérico real + 1 (consulta en backend)", async () => {
    expect(await (await svc()).nextOp(actor)).toBe(String(base + 1));
  });

  it("25 altas simultáneas con OP automático: únicos y correlativos", async () => {
    const s = await svc();
    const N = 25;
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) => s.createWithMeta(actor, { op: String(base + 1), cliente: `${CLI}-${i}`, producto: "P", opAuto: true }))
    );
    const ops = res.map((r) => Number(r.record.op)).sort((a, b) => a - b);
    expect(ops).toEqual(Array.from({ length: N }, (_, i) => base + 1 + i));
    expect(new Set(ops).size).toBe(N);
    // Todos los que no consiguieron el 1.º valor pedido fueron reasignados (y avisados).
    expect(res.filter((r) => r.opReassigned).length).toBe(N - 1);
    const persisted = await q("select op from production_pedidos where cliente like $1 and producto = 'P' order by op::int", [`${CLI}-%`]);
    expect(persisted.map((r) => Number(r.op))).toEqual(ops);
    expect(await (await svc()).nextOp(actor)).toBe(String(base + 1 + N));
  }, 60_000);

  it("un OP viejo del cliente (ya tomado) se reasigna al siguiente libre", async () => {
    const s = await svc();
    const next = Number(await s.nextOp(actor));
    const r = await s.createWithMeta(actor, { op: String(base + 1), cliente: `${CLI}-stale`, producto: "P", opAuto: true });
    expect(Number(r.record.op)).toBe(next);
    expect(r.opReassigned).toBe(true);
  });

  it("OP manual (sin opAuto) se respeta aunque ya exista; los pedidos históricos quedan intactos", async () => {
    const s = await svc();
    const before = await q("select id, op, producto, updated_at from production_pedidos where cliente = $1 and producto = 'HIST'", [CLI]);
    const r = await s.createWithMeta(actor, { op: String(base), cliente: `${CLI}-manual`, producto: "LINEA 2" });
    expect(r.record.op).toBe(String(base));
    expect(r.opReassigned).toBe(false);
    const after = await q("select id, op, producto, updated_at from production_pedidos where cliente = $1 and producto = 'HIST'", [CLI]);
    expect(after).toEqual(before);
  });

  it("un OP eliminado no se reutiliza (el MAX incluye eliminados)", async () => {
    const s = await svc();
    const r = await s.createWithMeta(actor, { cliente: `${CLI}-del`, producto: "P", opAuto: true });
    await q("update production_pedidos set deleted_at = now() where id = $1::uuid", [r.record.id]);
    expect(Number(await s.nextOp(actor))).toBe(Number(r.record.op) + 1);
  });
});
