/** Avisos a Administración / Facturación contra un Postgres de PRUEBA real (idempotencia y visibilidad por sector). */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);

describe.skipIf(Boolean(PROBLEM))(`Avisos de facturación en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const ids: string[] = [];
  const W = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    if (ids.length) await q("delete from os_notifications where id = any($1::uuid[])", [ids]).catch(() => undefined);
    await pool?.end();
  });

  const base = { workItemId: W, client: `CLIENTE FACT ${RUN}`, product: "Crema Facial", pedido: "1520", orderRef: "OA-1520", quantity: 1250, unit: "u", at: new Date(), actorName: "Producción IT" };

  it("«listo para entregar» y «entrega registrada» son avisos distintos, idempotentes por evento", async () => {
    const { emitBillingNotification } = await import("@/lib/notifications/billing-notifications");
    const { buildBillingNotification } = await import("@/lib/notifications/billing-notification-builder");
    const listo = { type: "LISTO_PARA_ENTREGAR" as const, eventKey: `mark-${RUN}`, ...base };
    const ent = { type: "ENTREGA_REGISTRADA" as const, eventKey: `line-${RUN}`, ...base, remito: null, packingGroups: [{ cajas: 12, unidadesPorCaja: 100 }, { cajas: 1, unidadesPorCaja: 50 }], complete: true, deliveredAt: new Date() };
    ids.push(buildBillingNotification(listo).id, buildBillingNotification(ent).id);
    expect((await emitBillingNotification(listo)).ok).toBe(true);
    expect((await emitBillingNotification(listo)).ok).toBe(true); // reintento / recarga
    expect((await emitBillingNotification(ent)).ok).toBe(true);
    expect((await emitBillingNotification(ent)).ok).toBe(true);
    const rows = await q("select kind, message, sectors from os_notifications where id = any($1::uuid[]) order by kind", [ids]);
    expect(rows.map((r) => r.kind)).toEqual(["entrega_registrada", "listo_para_entregar"]);
    expect(String(rows[0]!.message)).toContain("12 cajas de 100 u. + 1 caja de 50 u. = 13 cajas / 1.250 u.");
    expect(String(rows[1]!.message)).toMatch(/NO se entregó/);
  });

  it("solo Administración las ve: Producción y Elaboración no reciben información comercial", async () => {
    const { getDb } = await import("@/lib/db/client");
    const { DrizzleOrdersRepository } = await import("@/lib/orders/drizzle-repository");
    void getDb;
    const repo = new DrizzleOrdersRepository();
    const adm = await repo.listNotificationsForSector("ADMINISTRACION", "adm@laboratoriogenus.com.ar", { allForSector: true });
    expect(adm.filter((n) => ids.includes(n.id))).toHaveLength(2);
    for (const sector of ["PRODUCCION", "ELABORACION", "DEPOSITO"]) {
      const other = await repo.listNotificationsForSector(sector, `${sector.toLowerCase()}@laboratoriogenus.com.ar`, { allForSector: true });
      expect(other.filter((n) => ids.includes(n.id))).toHaveLength(0);
    }
  });
});
