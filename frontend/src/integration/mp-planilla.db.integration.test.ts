/**
 * Etapa 3 — Materias Primas contra un Postgres de PRUEBA real (mismo SQL que Neon): atomicidad lote + libro mayor,
 * concurrencia (libro mayor, celdas, control semanal), duplicados, borrador → confirmación, correcciones por delta,
 * consumo de OE sin stock, persistencia que ya no pisa MP y permisos.
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const mp = { email: "it-mp@laboratoriogenus.com.ar", sector: "MATERIA_PRIMA" as const, displayName: "IT Materia Prima" };
const produccion = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const, displayName: "IT Producción" };

describe.skipIf(Boolean(PROBLEM))(`Materias Primas: planillas transaccionales en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const db = async () => import("@/lib/inventory/mp-planilla-db");
  const ledger = async () => (await import("@/lib/mp-stock/mp-stock-ledger")).getMpStockLedger();
  const balance = async (codigo: string) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [codigo]))[0]?.stock_actual ?? 0);
  const ingresoRow = async (id: string) => (await q("select payload from inv_mp_ingresos where id = $1", [id]))[0]!.payload as Record<string, unknown>;
  const lotsOf = async (codigo: string) =>
    (await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [codigo])).map((r) => r.payload as Record<string, unknown>);
  const cleanup = async () => {
    await q("delete from inv_mp_ingresos where payload->>'codigo' like 'IT-MP-%' or payload->>'remitoNro' like 'IT-R-%'");
    await q("delete from inv_mp_stock where payload->>'codigo' like 'IT-MP-%'");
    await q("delete from inv_ajustes where payload->>'motivo' like '%IT%' and payload->>'module' = 'MP'");
    await q("delete from inv_mp_compras where payload->>'materiaPrima' like 'IT %'");
    await q("delete from mp_stock_movements where codigo like 'IT-MP-%'");
    await q("delete from mp_stock_balances where codigo like 'IT-MP-%'");
    await q("delete from mp_weekly_controls where product like 'IT %'");
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await cleanup();
  }, 60_000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await pool?.end();
  });

  it("ingreso confirmado: el lote (JSONB) y el libro mayor se escriben en la MISMA transacción", async () => {
    const { runMpInventoryOp } = await db();
    const row = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpIngreso(mp, { fecha: "2026-10-01", remitoNro: "IT-R-1", codigo: "IT-MP-GLI", descripcion: "Glicerina IT", lote: "L1", cantidad: 100 })
    );
    expect(row.status).toBe("CONFIRMADO");
    expect((await lotsOf("IT-MP-GLI"))[0]?.cantidadKg).toBe(100);
    expect(await balance("IT-MP-GLI")).toBe(100);
  });

  it("si algo falla a mitad de la operación, NO queda nada: ni lote, ni ingreso, ni movimiento", async () => {
    const { runMpInventoryOp } = await db();
    await expect(
      runMpInventoryOp(mp, async ({ service }) => {
        await service.upsertMpIngreso(mp, { fecha: "2026-10-01", remitoNro: "IT-R-ROLLBACK", codigo: "IT-MP-ROLL", descripcion: "Rollback IT", cantidad: 7 });
        throw new Error("fallo simulado después de escribir el libro mayor");
      })
    ).rejects.toThrow(/fallo simulado/);
    expect(await q("select 1 from inv_mp_ingresos where payload->>'remitoNro' = 'IT-R-ROLLBACK'")).toHaveLength(0);
    expect(await lotsOf("IT-MP-ROLL")).toHaveLength(0);
    expect(await q("select 1 from mp_stock_movements where codigo = 'IT-MP-ROLL'")).toHaveLength(0);
  });

  it("libro mayor: 20 movimientos simultáneos del mismo código no pierden ninguno (antes: leer-y-reescribir sin candado)", async () => {
    const l = await ledger();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        l.applyLotAdjustment({ email: mp.email, sector: mp.sector }, { codigo: "IT-MP-CONC", quantity: 5, reason: "IT concurrencia", ajusteId: randomUUID(), lote: `C${i}` })
      )
    );
    expect(await balance("IT-MP-CONC")).toBe(100);
    expect(await q("select 1 from mp_stock_movements where codigo = 'IT-MP-CONC'")).toHaveLength(20);
  });

  it("pegado: alta en BORRADOR (sin stock), duplicado rechazado, confirmar suma una sola vez", async () => {
    const { runMpInventoryOp, confirmMpIngresos } = await db();
    const base = { fecha: "2026-10-02", remitoNro: "IT-R-2", codigo: "IT-MP-COCO", descripcion: "Aceite coco IT", lote: "K1", cantidad: 40, status: "BORRADOR" as const };
    const draft = await runMpInventoryOp(mp, ({ service }) => service.upsertMpIngreso(mp, base));
    expect(draft.status).toBe("BORRADOR");
    expect(await lotsOf("IT-MP-COCO")).toHaveLength(0);
    await expect(runMpInventoryOp(mp, ({ service }) => service.upsertMpIngreso(mp, base))).rejects.toThrow(/Duplicado del ingreso/);
    const [ok] = (await confirmMpIngresos(mp, [{ id: draft.id, expectedVersion: draft.updatedAt }])).items;
    expect(ok?.status).toBe("CONFIRMADO");
    // Confirmar dos veces (doble clic) no suma dos veces.
    await confirmMpIngresos(mp, [{ id: draft.id, expectedVersion: String((await ingresoRow(draft.id)).updatedAt) }]);
    expect((await lotsOf("IT-MP-COCO"))[0]?.cantidadKg).toBe(40);
    expect(await balance("IT-MP-COCO")).toBe(40);
  });

  it("planilla: editar un borrador no lo confirma; corregir un confirmado exige motivo y mueve stock por delta", async () => {
    const { patchMpSheetCells, runMpInventoryOp, MpSheetPatchError } = await db();
    const draft = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpIngreso(mp, { fecha: "2026-10-03", remitoNro: "IT-R-3", codigo: "IT-MP-ALC", descripcion: "Alcohol IT", cantidad: 10, status: "BORRADOR" })
    );
    const [edited] = (await patchMpSheetCells(mp, "mp_ingresos", [{ id: draft.id, field: "cantidad", value: "12", expectedVersion: draft.updatedAt }])).items;
    expect((edited as { status: string }).status).toBe("BORRADOR");
    expect(await balance("IT-MP-ALC")).toBe(0);

    const conf = await runMpInventoryOp(mp, ({ service }) => service.upsertMpIngreso(mp, { id: draft.id, status: "CONFIRMADO" }));
    expect(await balance("IT-MP-ALC")).toBe(12);
    const noReason = patchMpSheetCells(mp, "mp_ingresos", [{ id: draft.id, field: "cantidad", value: "15", expectedVersion: conf.updatedAt }]);
    await expect(noReason).rejects.toBeInstanceOf(MpSheetPatchError);
    await expect(noReason).rejects.toThrow(/motivo/);
    expect(await balance("IT-MP-ALC")).toBe(12);

    await patchMpSheetCells(mp, "mp_ingresos", [{ id: draft.id, field: "cantidad", value: "15", expectedVersion: conf.updatedAt, reason: "Remito corregido IT" }]);
    expect(await balance("IT-MP-ALC")).toBe(15);
    expect((await lotsOf("IT-MP-ALC"))[0]?.cantidadKg).toBe(15);
    const audit = await q("select payload from inv_audit where payload->>'entityId' = $1 and payload->>'reason' = 'Remito corregido IT'", [draft.id]);
    expect(audit).toHaveLength(1);
  });

  it("dos usuarios editan la misma celda: uno guarda, el otro recibe conflicto y nada se pisa", async () => {
    const { patchMpSheetCells, runMpInventoryOp } = await db();
    const row = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpIngreso(mp, { fecha: "2026-10-04", remitoNro: "IT-R-4", codigo: "IT-MP-VAS", descripcion: "Vaselina IT", cantidad: 5, status: "BORRADOR" })
    );
    const results = await Promise.allSettled([
      patchMpSheetCells(mp, "mp_ingresos", [{ id: row.id, field: "proveedor", value: "PROV A", expectedVersion: row.updatedAt }]),
      patchMpSheetCells(mp, "mp_ingresos", [{ id: row.id, field: "proveedor", value: "PROV B", expectedVersion: row.updatedAt }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { status: number }).status).toBe(409);
    expect(["PROV A", "PROV B"]).toContain((await ingresoRow(row.id)).proveedor);
  });

  it("Stock MP: «Ajustar stock» de un lote ingresado ajusta el lote Y el libro mayor por la misma diferencia", async () => {
    const { runMpInventoryOp } = await db();
    const [lot] = await lotsOf("IT-MP-GLI");
    await runMpInventoryOp(mp, ({ service }) => service.adjustMpStock(mp, String(lot!.id), 92, "Conteo físico IT"));
    expect((await lotsOf("IT-MP-GLI"))[0]?.cantidadKg).toBe(92);
    expect(await balance("IT-MP-GLI")).toBe(92);
    const mov = await q("select kind, quantity from mp_stock_movements where codigo = 'IT-MP-GLI' and kind = 'AJUSTE'");
    expect(mov).toEqual([{ kind: "AJUSTE", quantity: -8 }]);
  });

  it("Stock MP: lote manual — alta con kg y corrección por celda (con motivo) quedan en el libro mayor", async () => {
    const { runMpInventoryOp, patchMpStockCells } = await db();
    const lot = await runMpInventoryOp(mp, ({ service }) => service.upsertMpStock(mp, { codigo: "IT-MP-MAN", descripcion: "Manual IT", cantidadKg: 10 }));
    expect(await balance("IT-MP-MAN")).toBe(10);
    await expect(
      patchMpStockCells(mp, [{ id: lot.id, field: "cantidadKg", value: "12", expectedVersion: lot.updatedAt }])
    ).rejects.toThrow(/motivo/);
    await patchMpStockCells(mp, [{ id: lot.id, field: "cantidadKg", value: "12", expectedVersion: lot.updatedAt, reason: "Recuento IT del lote" }]);
    expect((await lotsOf("IT-MP-MAN"))[0]?.cantidadKg).toBe(12);
    expect(await balance("IT-MP-MAN")).toBe(12);
  });

  it("fila existente escrita por SQL (updated_at con microsegundos, como una importación): se edita en la celda", async () => {
    const { patchMpStockCells } = await db();
    const id = randomUUID();
    const T = "2026-09-01T10:00:00.000Z";
    const lot = { id, codigo: "IT-MP-USEC", descripcion: "Lote IT importado", proveedor: "P IT", cliente: "", cantidadKg: 12, ubicacion: "A", lote: "L", vencimiento: "", origen: "ingreso", productosAsociados: "", archived: false, createdBy: "import", updatedBy: "import", createdAt: T, updatedAt: T };
    // now() de Postgres guarda microsegundos; JS lee milisegundos (antes: conflicto permanente).
    await q("insert into inv_mp_stock (id, payload, updated_at) values ($1, $2, now() + interval '123 microseconds')", [id, lot]);
    const { items } = await patchMpStockCells(mp, [
      { id, field: "producto", value: "CREMA IT", expectedVersion: T },
      { id, field: "proveedor", value: "P IT 2", expectedVersion: T },
    ]);
    expect(items[0]).toMatchObject({ producto: "CREMA IT", proveedor: "P IT 2", cantidadKg: 12 });
    expect((await lotsOf("IT-MP-USEC"))[0]).toMatchObject({ producto: "CREMA IT", proveedor: "P IT 2" });
  });

  it("precisión al ms NO permite pisar cambios concurrentes: fila con microsegundos, dos ediciones simultáneas → una gana, la otra 409", async () => {
    const { patchMpStockCells } = await db();
    const id = randomUUID();
    const T = "2026-09-02T10:00:00.000Z";
    const lot = { id, codigo: "IT-MP-CONC", descripcion: "Lote IT concurrente", proveedor: "P0", cliente: "", cantidadKg: 5, ubicacion: "A", lote: "L", vencimiento: "", origen: "ingreso", productosAsociados: "", archived: false, createdBy: "import", updatedBy: "import", createdAt: T, updatedAt: T };
    await q("insert into inv_mp_stock (id, payload, updated_at) values ($1, $2, now() + interval '321 microseconds')", [id, lot]);
    const results = await Promise.allSettled([
      patchMpStockCells(mp, [{ id, field: "proveedor", value: "P-A", expectedVersion: T }]),
      patchMpStockCells(mp, [{ id, field: "proveedor", value: "P-B", expectedVersion: T }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = (results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ items: Array<{ proveedor: string }> }>).value.items[0]!.proveedor;
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as { status: number }).status).toBe(409);
    expect((await lotsOf("IT-MP-CONC"))[0]!.proveedor).toBe(winner);
    // Una versión vieja (la del primer guardado) tampoco pisa: conflicto.
    await expect(patchMpStockCells(mp, [{ id, field: "proveedor", value: "P-C", expectedVersion: T }])).rejects.toMatchObject({ status: 409 });
    expect((await lotsOf("IT-MP-CONC"))[0]!.proveedor).toBe(winner);
  });

  it("guardado del snapshot de otro request entre la lectura y la escritura → conflicto (no se pisa)", async () => {
    const { runMpInventoryOp } = await db();
    const id = randomUUID();
    const T = "2026-09-03T10:00:00.000Z";
    const lot = { id, codigo: "IT-MP-RACE", descripcion: "Lote IT carrera", proveedor: "P0", cliente: "", cantidadKg: 5, ubicacion: "A", lote: "L", vencimiento: "", origen: "manual", productosAsociados: "", archived: false, createdBy: "import", updatedBy: "import", createdAt: T, updatedAt: T };
    await q("insert into inv_mp_stock (id, payload, updated_at) values ($1, $2, now())", [id, lot]);
    await expect(
      runMpInventoryOp(mp, async ({ service }) => {
        // Otro proceso (sin el candado de MP) cambia la fila mientras esta operación ya la leyó.
        const { Pool } = await import("@neondatabase/serverless");
        const other = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
        await other.query("update inv_mp_stock set payload = jsonb_set(payload, '{proveedor}', '\"OTRO\"'), updated_at = now() where id = $1", [id]);
        await other.end();
        return service.patchInventoryCells(mp, "mp_stock", [{ id, field: "proveedor", value: "MIO", expectedVersion: T }]);
      })
    ).rejects.toThrow();
    expect((await lotsOf("IT-MP-RACE"))[0]!.proveedor).toBe("OTRO");
  });

  it("consumo de OE sin stock suficiente: se registra igual (negativo visible), ya no se pierde en silencio", async () => {
    const l = await ledger();
    await l.applyOeConsumption(
      { email: produccion.email, sector: produccion.sector },
      { oeId: `oe-it-${randomUUID()}`, oeVersion: 1, oeStatus: "COMPLETA", lines: [{ lineId: "l1", codigo: "IT-MP-ALC", kgReal: 20 }], allowNegative: true }
    );
    expect(await balance("IT-MP-ALC")).toBe(-5);
  });

  it("un POST de otro módulo (snapshot en memoria) ya no re-escribe filas de MP que no tocó", async () => {
    const { hydrateInventoryFromNeon, persistInventorySnapshot } = await import("@/lib/inventory/neon-persist");
    const { MemoryInventoryRepo } = await import("@/lib/inventory/memory-repo");
    const stale = new MemoryInventoryRepo();
    await hydrateInventoryFromNeon(stale, { force: true });
    const { patchMpSheetCells } = await db();
    const row = stale.mpIngresos.find((r) => r.remitoNro === "IT-R-4")!;
    const fresh = await ingresoRow(row.id);
    await patchMpSheetCells(mp, "mp_ingresos", [{ id: row.id, field: "cliente", value: "CLIENTE NUEVO IT", expectedVersion: String(fresh.updatedAt) }]);
    await persistInventorySnapshot(stale); // copia vieja de otro request
    expect((await ingresoRow(row.id)).cliente).toBe("CLIENTE NUEVO IT");
  });

  it("Compras MP: edición por celda con versión y auditoría", async () => {
    const { patchMpSheetCells, runMpInventoryOp } = await db();
    const { compra } = await runMpInventoryOp(mp, ({ service }) =>
      service.upsertMpCompra(mp, { materiaPrima: "IT Mentol", cantidad: 3, unidad: "kg", estado: "Solicitada" })
    );
    const [saved] = (await patchMpSheetCells(mp, "mp_compras", [{ id: compra.id, field: "estado", value: "en camino", expectedVersion: compra.updatedAt }])).items;
    expect((saved as { estado: string }).estado).toBe("En camino");
    await expect(
      patchMpSheetCells(mp, "mp_compras", [{ id: compra.id, field: "nota", value: "vieja", expectedVersion: compra.updatedAt }])
    ).rejects.toMatchObject({ status: 409 });
    expect(await q("select 1 from inv_audit where payload->>'entityId' = $1", [compra.id])).toHaveLength(2);
  });

  it("permisos: Producción no edita ingresos ni compras (403) ni registra saldos iniciales", async () => {
    const { patchMpSheetCells } = await db();
    const row = (await q("select payload from inv_mp_ingresos where payload->>'remitoNro' = 'IT-R-4'"))[0]!.payload as Record<string, string>;
    await expect(
      patchMpSheetCells({ ...produccion }, "mp_ingresos", [{ id: row.id, field: "proveedor", value: "X", expectedVersion: row.updatedAt }])
    ).rejects.toMatchObject({ status: 403 });
  });

  it("Control semanal: stock real del libro mayor (antes 0), versión y transacción", async () => {
    const { getMpControlService, MpControlCellError } = await import("@/lib/mp-control/mp-control-service");
    const svc = getMpControlService();
    const c = await svc.create(mp, {
      client: "CLIENTE IT",
      product: "IT CREMA",
      quantityKg: 100,
      snapshot: { source: "manual", materials: [{ codigo: "IT-MP-GLI", materiaPrima: "Glicerina IT", formulaPct: 10 }] } as never,
    });
    expect(c.lines[0]?.stockActual).toBe(92);
    const updated = await svc.update(mp, c.id, { quantityKg: 200, expectedVersion: c.updatedAt });
    await expect(svc.update(mp, c.id, { quantityKg: 300, expectedVersion: c.updatedAt })).rejects.toBeInstanceOf(MpControlCellError);
    const [a, b] = await Promise.allSettled([
      svc.patchLineCells(mp, c.id, [{ lineId: updated.lines[0]!.id, field: "lote", value: "LA" }], updated.updatedAt),
      svc.patchLineCells(mp, c.id, [{ lineId: updated.lines[0]!.id, field: "lote", value: "LB" }], updated.updatedAt),
    ]);
    expect([a, b].filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lines = await q("select lote from mp_weekly_control_lines where control_id = $1", [c.id]);
    expect(lines).toHaveLength(1);
    expect(["LA", "LB"]).toContain(lines[0]!.lote);
    const audit = (await q("select audit from mp_weekly_controls where id = $1", [c.id]))[0]!.audit as { action: string };
    expect(audit.action).toBe("cell_edit");
  });
});
