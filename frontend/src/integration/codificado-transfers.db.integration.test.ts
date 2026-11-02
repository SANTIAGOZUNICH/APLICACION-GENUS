/**
 * Entregas PARCIALES de Envasado → CODIFICADO contra Postgres de PRUEBA real (0077).
 * Trabajo de 2.000 u.: 800 → 700 → 500. Cada entrega es un movimiento propio; Codificado recibe UN trabajo vinculado que no se
 * duplica; el trabajo de Envasado sigue abierto hasta entregar todo; idempotente; concurrencia sin pasarse del saldo; sin entregas
 * externas ni stock de Depósito. Se corre con `GENUS_E2E_VITEST_FILES=src/integration/codificado-transfers.db.integration.test.ts`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLIENT = `IT CT CLIENTE ${RUN}`;
const prod = { email: "it-ct-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };
const masivo = { email: "it-ct-masivo@laboratoriogenus.com.ar", sector: "ENVASADO_MASIVO" as const, displayName: "IT Envasado Masivo" };
const premium = { email: "it-ct-premium@laboratoriogenus.com.ar", sector: "ENVASADO_PREMIUM" as const, displayName: "IT Envasado Premium" };
const codif = { email: "it-ct-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const, displayName: "IT Codificado" };
const calidad = { email: "it-ct-cal@laboratoriogenus.com.ar", sector: "CALIDAD" as const, displayName: "IT Calidad" };

describe.skipIf(Boolean(PROBLEM))(`Entregas parciales de Envasado a Codificado${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = () => import("@/lib/planning/codificado-transfer-service");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 60_000);
  afterAll(async () => {
    await pool?.end();
  });

  const newWork = async (sector: "ENVASADO_MASIVO" | "ENVASADO_PREMIUM", qty: string, product = `Serum IT ${RUN}-${Math.random().toString(36).slice(2, 6)}`) => {
    const { assignWorkItemDurable } = await import("@/lib/planning/work-assignment-service");
    const r = await assignWorkItemDurable({ sector, client: CLIENT, product, plannedQuantity: qty, unit: "un.", plannedDate: "2031-06-10", line: "Línea 1", orderNumber: `OA-2026-${String(800000 + Math.floor(Math.random() * 99999)).padStart(6, "0")}`, packagingLote: "L-IT-CT", idempotencyKey: randomUUID() } as never, prod, randomUUID());
    return r.item.id as string;
  };
  const transfer = async (actor: typeof masivo | typeof prod | typeof premium | typeof codif, id: string, quantity: number, finishedQty: number | null = null, key: string = randomUUID()) =>
    (await svc()).transferToCodificadoDurable({ workItemId: id, quantity, finishedQty, idempotencyKey: key }, actor as never);
  const row = async (id: string) => (await q("select sector, operational_status, planned_quantity, finished_qty, packaging_total_units, completed_at, via_codificado, parent_work_item_id from work_items where id = $1", [id]))[0]!;
  const children = (id: string) => q("select id, sector, planned_quantity, packaging_total_units, finished_qty, via_codificado, codificado_origin_sector, packaging_lote from work_items where parent_work_item_id = $1 and deleted_at is null", [id]);
  const transfers = (id: string) => q("select seq, quantity, cumulative, pending, origin_sector, lote, delivered_by, delivered_by_sector, status from work_item_codificado_transfers where work_item_id = $1 order by seq", [id]);

  it("la migración 0077 es aditiva e idempotente", async () => {
    const { readFileSync } = await import("node:fs");
    const sqlText = readFileSync("drizzle/0077_codificado_transfers.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    expect((await q("select count(*)::int n from information_schema.columns where table_name='work_items' and column_name='parent_work_item_id'"))[0]!.n).toBe(1);
  });

  it("2.000 u.: 800 → 700 → 500. Codificado recibe sin duplicar el pedido; Envasado sigue abierto hasta entregar todo", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const noExternalBefore = Number((await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [id]))[0]!.n);

    // 1) 800 (se registran 800 realizadas en el mismo paso: sin pasar por otra pantalla)
    const r1 = await transfer(masivo, id, 800, 800);
    expect(r1).toMatchObject({ replayed: false, complete: false, transfer: { seq: 1, quantity: 800, cumulative: 800, pending: 1200 } });
    expect(r1.view.summary).toMatchObject({ assigned: 2000, produced: 800, transferred: 800, pendingToTransfer: 1200, availableToTransfer: 0, received: 800, coded: 0, pendingToCode: 800, notYetReceived: 1200 });
    const p1 = await row(id);
    expect(p1).toMatchObject({ sector: "ENVASADO_MASIVO", via_codificado: false, completed_at: null });
    expect(p1.operational_status).not.toBe("completo");
    expect(String(p1.planned_quantity)).toBe("2000"); // la cantidad asignada no se toca
    const c1 = await children(id);
    expect(c1).toHaveLength(1);
    expect(c1[0]).toMatchObject({ sector: "CODIFICADO", via_codificado: true, codificado_origin_sector: "ENVASADO_MASIVO", packaging_lote: "L-IT-CT" });
    const childId = String(c1[0]!.id);

    // Codificado puede empezar a trabajar con las primeras 800
    const cView = await (await svc()).getCodificadoTransferView(childId, codif as never);
    expect(cView.summary).toMatchObject({ received: 800, coded: 0, pendingToCode: 800, notYetReceived: 1200 });
    const afterCoding = await (await svc()).recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 500 }, codif as never);
    expect(afterCoding.summary).toMatchObject({ received: 800, coded: 500, pendingToCode: 300 });
    await expect((await svc()).recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 900 }, codif as never)).rejects.toThrow(/recibió 800/);

    // 2) otras 700 → se SUMAN, no se crea otro trabajo
    const r2 = await transfer(masivo, id, 700, 1500);
    expect(r2.transfer).toMatchObject({ seq: 2, quantity: 700, cumulative: 1500, pending: 500 });
    expect((await children(id))).toHaveLength(1);
    expect(r2.view.summary).toMatchObject({ received: 1500, coded: 500, pendingToCode: 1000, notYetReceived: 500, pendingToTransfer: 500 });
    expect((await row(id)).operational_status).not.toBe("completo");

    // 3) entrega final de 500
    const r3 = await transfer(masivo, id, 500, 2000);
    expect(r3).toMatchObject({ complete: true, transfer: { seq: 3, cumulative: 2000, pending: 0 } });
    expect(r3.view.summary).toMatchObject({ received: 2000, notYetReceived: 0, pendingToTransfer: 0 });
    expect((await row(id)).operational_status).toBe("completo");
    expect((await children(id))).toHaveLength(1);
    const child = await row(childId);
    expect(String(child.planned_quantity)).toBe("2000");

    // Trazabilidad: tres movimientos independientes, con usuario, lote y origen
    const t = await transfers(id);
    expect(t.map((x) => [x.seq, x.quantity, x.cumulative, x.pending, x.origin_sector, x.lote, x.delivered_by, x.delivered_by_sector])).toEqual([
      [1, 800, 800, 1200, "ENVASADO_MASIVO", "L-IT-CT", masivo.email, "ENVASADO_MASIVO"],
      [2, 700, 1500, 500, "ENVASADO_MASIVO", "L-IT-CT", masivo.email, "ENVASADO_MASIVO"],
      [3, 500, 2000, 0, "ENVASADO_MASIVO", "L-IT-CT", masivo.email, "ENVASADO_MASIVO"],
    ]);
    // Persistencia tras recargar (otra instancia del servidor)
    vi.resetModules();
    const again = await (await svc()).getCodificadoTransferView(id, prod as never);
    expect(again.transfers.map((x) => x.quantity)).toEqual([800, 700, 500]);
    expect(again.summary).toMatchObject({ received: 2000, coded: 500, pendingToCode: 1500 });
    // No hubo ninguna entrega al cliente / a Producción
    expect(Number((await q("select count(*)::int n from work_item_deliveries where work_item_id = $1", [id]))[0]!.n)).toBe(noExternalBefore);
    expect(Number((await q("select count(*)::int n from work_item_delivery_lines where work_item_id = $1", [id]))[0]!.n)).toBe(0);
  });

  it("no se puede entregar más de lo disponible (terminadas − entregadas) ni más que lo asignado; cantidades inválidas", async () => {
    const id = await newWork("ENVASADO_PREMIUM", "2000");
    await expect(transfer(premium, id, 900, 800)).rejects.toThrow(/Solo hay 800 unidades terminadas/);
    await expect(transfer(premium, id, 2500, 2000)).rejects.toThrow(/supera lo que falta entregar|supera/i);
    await expect(transfer(premium, id, 0, 800)).rejects.toThrow(/mayor que 0/);
    await expect(transfer(premium, id, -5, 800)).rejects.toThrow(/mayor que 0/);
    await expect(transfer(premium, id, 10.5, 800)).rejects.toThrow(/entero/);
    await expect(transfer(premium, id, 100, 3000)).rejects.toThrow(/superan la cantidad asignada/);
    expect(await transfers(id)).toHaveLength(0);
    expect(await children(id)).toHaveLength(0); // una entrega rechazada no deja trabajo en Codificado
    await transfer(premium, id, 800, 800);
    await expect(transfer(premium, id, 1, null)).rejects.toThrow(/Solo hay 0 unidades terminadas sin entregar/);
    await expect(transfer(premium, id, 100, 700)).rejects.toThrow(/no pueden ser menos que lo ya entregado/);
    expect(await transfers(id)).toHaveLength(1);
  });

  it("reintentos (doble clic / red) con la misma clave no duplican: una sola entrega y un solo trabajo en Codificado", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    const key = randomUUID();
    const a = await transfer(masivo, id, 800, 2000, key);
    const b = await transfer(masivo, id, 800, 2000, key);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.transfer.id).toBe(a.transfer.id);
    const sim = await Promise.all([1, 2, 3, 4].map(() => transfer(masivo, id, 300, 2000, "mismo-doble-clic-" + id)));
    expect(sim.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await transfers(id)).toHaveLength(2);
    expect((await children(id))).toHaveLength(1);
    expect((await svc().then((m) => m.getCodificadoTransferView(id, masivo as never))).summary.transferred).toBe(1100);
    await expect(transfer(masivo, await newWork("ENVASADO_MASIVO", "100"), 10, 100, key)).rejects.toThrow(/otro trabajo/);
  });

  it("dos usuarios entregando a la vez: nunca se supera lo disponible (una gana, la otra recibe el error de saldo)", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    await transfer(masivo, id, 100, 2000);
    const res = await Promise.allSettled([transfer(masivo, id, 1500, null), transfer(prod, id, 1500, null)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/supera|Solo hay/);
    const many = await newWork("ENVASADO_MASIVO", "2000");
    const five = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => transfer(masivo, many, 500, 2000, `${RUN}-five-${i}`)));
    expect(five.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    const sum = Number((await q("select coalesce(sum(quantity),0)::float n from work_item_codificado_transfers where work_item_id = $1", [many]))[0]!.n);
    expect(sum).toBe(2000);
    expect((await transfers(many)).map((t) => t.seq)).toEqual([1, 2, 3, 4]); // secuencia sin saltos ni repetidos
    expect(await children(many)).toHaveLength(1);
  });

  it("muestras: son metadata y NO se descuentan de lo terminado (no se cuentan dos veces)", async () => {
    const id = await newWork("ENVASADO_MASIVO", "1000");
    await q("update work_items set sample_units = 20 where id = $1", [id]);
    const r = await transfer(masivo, id, 1000, 1000);
    expect(r.view.summary).toMatchObject({ transferred: 1000, received: 1000, pendingToTransfer: 0 });
    expect(Number((await row(id)).planned_quantity)).toBe(1000);
    expect((await q("select sample_units from work_items where id = $1", [id]))[0]!.sample_units).toBe(20);
  });

  it("permisos: cada Envasado entrega solo lo suyo; Producción puede; Codificado/Calidad no entregan; Calidad no consulta", async () => {
    const id = await newWork("ENVASADO_MASIVO", "500");
    await expect(transfer(premium, id, 100, 500)).rejects.toThrow(/Envasado propietario/);
    await expect(transfer(codif, id, 100, 500)).rejects.toThrow(/permiso/);
    await expect(transfer(calidad as never, id, 100, 500)).rejects.toThrow(/permiso/);
    await transfer(prod, id, 100, 500);
    const s = await svc();
    await expect(s.getCodificadoTransferView(id, premium as never)).rejects.toThrow(/permiso/);
    await expect(s.getCodificadoTransferView(id, calidad as never)).rejects.toThrow(/permiso/);
    await expect(s.getCodificadoTransferView(id, masivo as never)).resolves.toBeTruthy();
    await expect(s.getCodificadoTransferView(id, codif as never)).resolves.toBeTruthy();
    const childId = String((await children(id))[0]!.id);
    await expect(s.recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 10 }, masivo as never)).rejects.toThrow(/Solo Codificado/);
    await expect(s.recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 10 }, calidad as never)).rejects.toThrow(/Solo Codificado/);
    await expect(s.recordCodificadoProgressDurable({ workItemId: childId, codedUnits: 10 }, prod as never)).rejects.toThrow(/Solo Codificado/); // Producción consulta, no registra el avance
    await expect(s.listCodificadoReceipts(masivo as never)).rejects.toThrow(/Solo Codificado/);
    const inbox = (await s.listCodificadoReceipts(codif as never)).filter((r) => r.client === CLIENT);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox[0]).toMatchObject({ client: CLIENT, originSector: expect.stringMatching(/ENVASADO/), deliveredBy: expect.any(String), lote: "L-IT-CT" });
    // un trabajo que no es de Envasado no entrega
    await expect(transfer(prod, childId, 10, null)).rejects.toThrow(/trabajo de Envasado/);
  });

  it("convive con las entregas a Producción y con el envío total: no se cuenta dos veces", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    await transfer(masivo, id, 800, 2000);
    const { deliverWorkDurable } = await import("@/lib/planning/work-item-progress-repository");
    const toProd = (qty: number, key: string) => deliverWorkDurable({ workItemId: id, codigo: null, sourceSector: "ENVASADO_MASIVO", plannedDeliveryDate: null, actualDeliveredAt: new Date().toISOString(), remito: null, receivedBy: null, observations: null, partial: true, deliverQuantity: qty, idempotencyKey: key, completion: { finishedQty: "2000" } } as never, { email: masivo.email, sector: masivo.sector, displayName: masivo.displayName });
    await expect(toProd(1300, `${RUN}-p1`)).rejects.toThrow(/supera|saldo/i); // 800 ya salieron hacia Codificado: solo quedan 1.200
    expect(await toProd(500, `${RUN}-p2`)).toMatchObject({ delivered: 500 });
    await expect(transfer(masivo, id, 800, null)).rejects.toThrow(/supera|falta entregar/i); // quedan 700
    const last = await transfer(masivo, id, 700, null);
    expect(last.complete).toBe(true);
    // el envío total (legacy) queda bloqueado cuando hay entregas parciales
    const id2 = await newWork("ENVASADO_MASIVO", "1000");
    await transfer(masivo, id2, 300, 1000);
    const { handoffToCodificadoDurable } = await import("@/lib/planning/codificado-handoff-service");
    await expect(handoffToCodificadoDurable({ workItemId: id2, totalUnits: 1000, idempotencyKey: randomUUID() }, masivo as never)).rejects.toThrow(/Entregar a Codificado/);
    expect((await row(id2)).sector).toBe("ENVASADO_MASIVO");
  });

  it("Codificado solo puede entregar lo recibido; entregar no cierra el trabajo mientras falten unidades", async () => {
    const id = await newWork("ENVASADO_MASIVO", "2000");
    await transfer(masivo, id, 800, 2000);
    const childId = String((await children(id))[0]!.id);
    const { deliverFromCodificadoDurable } = await import("@/lib/planning/codificado-handoff-service");
    const deliver = (qty: number | null, key = randomUUID()) => deliverFromCodificadoDurable({ workItemId: childId, deliverQuantity: qty, idempotencyKey: key, packagingLote: "L-IT-CT", packagingVto: "2030-01-01" } as never, codif as never);
    await expect(deliver(900)).rejects.toThrow(/Solo hay 800/);
    const d1 = await deliver(500);
    expect(d1).toMatchObject({ complete: false, delivered: 500, pending: 1500 });
    await expect(deliver(400)).rejects.toThrow(/Solo hay 300/);
    await transfer(masivo, id, 700, 2000); // llegan 700 más
    const d2 = await deliver(null); // «todo lo recibido sin entregar» = 1.000
    expect(d2).toMatchObject({ complete: false, delivered: 1500, pending: 500 });
    expect((await row(childId)).operational_status).not.toBe("entregado");
    expect((await row(id)).operational_status).not.toBe("entregado"); // el de Envasado no se toca
  });
});
