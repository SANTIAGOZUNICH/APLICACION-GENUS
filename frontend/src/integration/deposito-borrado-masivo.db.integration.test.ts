/**
 * Depósito — eliminación individual, múltiple y masiva contra un Postgres de PRUEBA real (mismo SQL que Neon), pasando por la ruta
 * real `POST /api/v1/inventory` (acción bulk_delete) con identidad de Depósito:
 *  - una fila, cinco filas, «visibles» y «toda la tabla» (también lo que un filtro oculta)
 *  - persiste: otra instancia (módulos nuevos) y la base no devuelven lo eliminado; no reaparece
 *  - baja lógica con auditoría (quién, cuándo, contenido anterior); no entra en totales ni stock
 *  - saldos de stock correctos; no toca salidas ni otras tablas; otros sectores → 403; sin sesión → 401
 *  - vaciar una celda y varias celdas; fallo parcial y recuperación (reintentar no duplica)
 * Se SALTA sin base local marcada. Se corre con `GENUS_E2E_VITEST_FILES=src/integration/deposito-borrado-masivo.db.integration.test.ts bash scripts/e2e/run-semanas-priorities-db-local.sh`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const DEP = "deposito@laboratoriogenus.com.ar";
const PROD = "produccion@laboratoriogenus.com.ar";
const PFX = "IT-BM-";
const T = "2026-10-01T10:00:00.000Z";
type BulkResult = { requested: number; deleted: string[]; skipped: string[]; failed: Array<{ id: string; message: string }> };

describe.skipIf(Boolean(PROBLEM))(`Depósito: borrado masivo en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const route = async () => import("@/app/api/v1/inventory/route");
  const call = async (email: string | null, body: unknown) => {
    const { POST } = await route();
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (email) headers["x-genus-actor-email"] = email;
    const res = await POST(new Request("http://local/api/v1/inventory", { method: "POST", headers, body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as { data?: BulkResult; error?: string } };
  };
  const list = async (resource: string, email = DEP) => {
    const { GET } = await route();
    const res = await GET(new Request(`http://local/api/v1/inventory?resource=${resource}`, { headers: { "x-genus-actor-email": email } }));
    return ((await res.json()) as { data: Array<Record<string, unknown>> }).data;
  };
  const activeIngresoIds = async () => (await list("me_ingresos")).filter((r) => String(r.codigo).startsWith(PFX)).map((r) => r.id as string);
  const seed: string[] = [];

  const insertIngreso = async (n: number, cantidad: number) => {
    const id = randomUUID();
    const matId = randomUUID();
    const codigo = `${PFX}${n}`;
    await q("insert into inv_me_materials (id, payload) values ($1,$2)", [matId, { id: matId, codigo, descripcion: `Insumo ${n}`, cliente: "CLIENTE IT", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false }]);
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [id, { id, fecha: "2026-10-01", ingresoNro: `ME-I-IT${String(n).padStart(3, "0")}`, proveedor: "PROV IT", cliente: "CLIENTE IT", remitoNro: `R-BM-${n}`, codigo, descripcionInsumo: `Insumo ${n}`, bultos: 1, cantidad, total: cantidad, ubicacion: "A1", materialId: matId, anulado: false, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
    seed.push(id);
    return { id, matId, codigo };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like '${PFX}%'`);
    await q(`delete from inv_audit where payload->>'entityId' in (select id::text from inv_me_ingresos where false)`);
  }, 60_000);

  afterAll(async () => {
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like '${PFX}%'`).catch(() => undefined);
    await pool?.end();
  });

  it("sin sesión → 401; Producción → 403; en ambos casos NO se borra nada", async () => {
    const a = await insertIngreso(1, 10);
    expect((await call(null, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: [a.id] } })).status).toBe(401);
    expect((await call(PROD, { action: "bulk_delete", resource: "me_ingresos", payload: { scope: "all" } })).status).toBe(403);
    expect(await activeIngresoIds()).toContain(a.id);
  });

  it("eliminar UNA fila: desaparece, queda auditado (quién/cuándo/contenido anterior) y el stock del código vuelve a 0 sin motivo", async () => {
    const { id, matId } = await insertIngreso(2, 25);
    const { meStockByCodigoDb } = await import("@/lib/inventory/me-planilla-db");
    expect(await meStockByCodigoDb(`${PFX}2`)).toBe(25);
    const res = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: [id] } });
    expect(res.status).toBe(200);
    expect(res.json.data!).toMatchObject({ requested: 1, deleted: [id], failed: [] });
    expect(await activeIngresoIds()).not.toContain(id);
    expect(await meStockByCodigoDb(`${PFX}2`)).toBe(0);
    const row = (await q("select payload from inv_me_ingresos where id = $1", [id]))[0]!.payload as Record<string, unknown>;
    expect(row).toMatchObject({ anulado: true, updatedBy: DEP }); // el registro NO se destruye
    const audit = await q("select payload from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'anular'", [id]);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ actor: DEP, module: "me_ingresos", before: { anulado: false, cantidad: 25, codigo: `${PFX}2` } });
    expect(matId).toBeTruthy();
  });

  it("eliminar CINCO filas seleccionadas + todas las visibles; lo no incluido queda intacto; persiste en una instancia nueva", async () => {
    const rows = [];
    for (let n = 10; n < 20; n++) rows.push(await insertIngreso(n, 100 + n));
    const five = rows.slice(0, 5).map((r) => r.id);
    const r5 = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: five } });
    expect(r5.json.data!.deleted).toHaveLength(5);
    // «visibles» = los ids que el filtro dejó a la vista (2); el resto de la tabla no se toca
    const visible = rows.slice(5, 7).map((r) => r.id);
    const rv = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: visible } });
    expect(rv.json.data!.deleted).toHaveLength(2);
    const left = rows.slice(7).map((r) => r.id);
    expect((await activeIngresoIds()).filter((i) => rows.some((r) => r.id === i)).sort()).toEqual([...left].sort());
    // Recarga: módulos nuevos (otra instancia) y la base cruda → no reaparece
    vi.resetModules();
    expect((await activeIngresoIds()).filter((i) => rows.some((r) => r.id === i)).sort()).toEqual([...left].sort());
    const gone = await q("select count(*)::int as n from inv_me_ingresos where id = any($1) and (payload->>'anulado')::boolean", [five]);
    expect(gone[0]!.n).toBe(5);
  });

  it("fallo parcial: informa cuáles fallaron, aplica el resto y reintentar es seguro (sin duplicar auditoría)", async () => {
    const [a, b, c] = [await insertIngreso(30, 1), await insertIngreso(31, 2), await insertIngreso(32, 3)];
    const { InventoryService } = await import("@/lib/inventory/inventory-service");
    const original = InventoryService.prototype.deleteMeIngreso;
    const spy = vi.spyOn(InventoryService.prototype, "deleteMeIngreso").mockImplementation(function (this: InstanceType<typeof InventoryService>, actor, id, reason) {
      if (id === b.id) throw new Error("falla simulada");
      return original.call(this, actor, id, reason);
    });
    const first = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: [a.id, b.id, c.id, "no-existe"] } });
    spy.mockRestore();
    expect(first.json.data!.deleted.sort()).toEqual([a.id, c.id].sort());
    expect(first.json.data!.failed).toEqual([{ id: b.id, message: "falla simulada" }]);
    expect(first.json.data!.skipped).toEqual(["no-existe"]);
    expect(await activeIngresoIds()).toContain(b.id);
    const retry = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { ids: [a.id, b.id, c.id] } });
    expect(retry.json.data!.deleted).toEqual([b.id]);
    expect(retry.json.data!.skipped.sort()).toEqual([a.id, c.id].sort());
    for (const id of [a.id, b.id, c.id]) expect((await q("select 1 from inv_audit where payload->>'entityId' = $1 and payload->>'action' = 'anular'", [id])).length).toBe(1);
  });

  it("vaciar UNA celda y VARIAS celdas sin motivo: se guarda vacío y persiste tras recargar", async () => {
    const { id } = await insertIngreso(40, 70);
    const { patchMeSheetCells } = await import("@/lib/inventory/me-planilla-db");
    const actor = { email: DEP, sector: "DEPOSITO" as const, displayName: "IT Depósito" };
    const v = async () => String(((await q("select payload from inv_me_ingresos where id = $1", [id]))[0]!.payload as Record<string, unknown>).updatedAt);
    await patchMeSheetCells(actor, "me_ingresos", [{ id, field: "proveedor", value: "", expectedVersion: await v() }]);
    await patchMeSheetCells(actor, "me_ingresos", [
      { id, field: "remitoNro", value: "", expectedVersion: await v() },
      { id, field: "ubicacion", value: "", expectedVersion: await v() },
    ]);
    vi.resetModules();
    const fresh = (await list("me_ingresos")).find((r) => r.id === id);
    expect(fresh).toMatchObject({ proveedor: "", remitoNro: "", ubicacion: "", cantidad: 70 });
  });

  it("«toda la tabla»: elimina TODOS los activos aunque estén ocultos por filtros; no toca salidas ni otros materiales; saldos coherentes", async () => {
    const keep = await insertIngreso(50, 10);
    await insertIngreso(51, 20);
    const salidaId = randomUUID();
    await q("insert into inv_me_salidas (id, payload) values ($1,$2)", [salidaId, { id: salidaId, fecha: "2026-10-02", egresoNro: "E-IT-BM", cliente: "", remitoNro: "", descripcion: "x", bultos: null, cantidad: 3, total: 3, control: false, entregado: false, comentarios: "", materialId: keep.matId, codigo: keep.codigo, unidad: "u", origen: "MANUAL", descuentaStock: true, motivoSalida: "DESCARTE", oaId: null, oaNumber: null, oaVersion: null, materialLineId: null, idempotencyKey: null, reverted: false, revertedAt: null, revertReason: null, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
    const res = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { scope: "all" } });
    expect(res.status).toBe(200);
    expect(res.json.data!.failed).toEqual([]);
    expect(await activeIngresoIds()).toEqual([]);
    const total = (await list("me_ingresos")).length;
    expect(total).toBe(0); // los totales operativos no cuentan lo eliminado
    // la salida es de OTRA tabla: sigue activa
    expect((await q("select payload from inv_me_salidas where id = $1", [salidaId]))[0]!.payload).toMatchObject({ reverted: false });
    const { meStockByCodigoDb } = await import("@/lib/inventory/me-planilla-db");
    expect(await meStockByCodigoDb(keep.codigo)).toBe(-3); // sin ingresos vigentes, la salida real queda visible como saldo negativo (no se oculta ni se fuerza a 0)
    // repetir «toda la tabla» no falla ni duplica
    const again = await call(DEP, { action: "bulk_delete", resource: "me_ingresos", payload: { scope: "all" } });
    expect(again.json.data!.deleted).toEqual([]);
  });

  it("salidas e inventario: borrado masivo desde la ruta; historial de eliminaciones disponible para auditoría", async () => {
    const m = await insertIngreso(60, 15);
    const inv = await call(DEP, { action: "bulk_delete", resource: "me_inventario", payload: { ids: [m.matId] } });
    expect(inv.json.data!.deleted).toEqual([m.matId]);
    expect((await q("select payload from inv_me_materials where id = $1", [m.matId]))[0]!.payload).toMatchObject({ archived: true });
    expect((await list("me_inventario")).some((r) => r.materialId === m.matId)).toBe(false);
    const { meDeletionHistoryDb } = await import("@/lib/inventory/me-planilla-db");
    const hist = await meDeletionHistoryDb({ email: DEP, sector: "DEPOSITO", displayName: "IT" }, "me_stock", 50);
    expect(hist.some((h) => h.entityId === m.matId && h.actor === DEP && h.before)).toBe(true);
    const sal = await call(DEP, { action: "bulk_delete", resource: "me_salidas", payload: { scope: "all" } });
    expect(sal.status).toBe(200);
  });
});
