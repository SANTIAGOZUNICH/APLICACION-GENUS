/**
 * OE automática con fórmula y lotes — contra un Postgres de PRUEBA real (mismo SQL que Neon), con las MISMAS funciones
 * que usa la app: Asignar trabajo (assignWorkItemDurable + preparación como en POST /api/v1/work-assignments),
 * correcciones del trabajo (updateWorkItemPlanningDurable / updateWorkItemLoteVtoDurable) y la acción explícita.
 *
 * La fórmula principal sale del BANCO de fórmulas sembrado en la base de prueba (camino real: resolveFormulaForWork).
 * Sin credenciales de Google en la prueba, «no está en el banco» termina en «no encontrada», como en Production sin
 * Drive. Los casos ambigua / ilegible / Drive se inyectan.
 *
 * Se SALTA sin base local marcada. Se corre con `npm run test:e2e:produccion-edicion-db`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const prod = { email: "it-oe-prod@laboratoriogenus.com.ar", sector: "PRODUCCION", displayName: "IT Producción" };
const RUN = Date.now().toString().slice(-5);
const CLIENT = `IT OE CLIENTE ${RUN}`;
const PRODUCT = `CREMA OE IT ${RUN}`;
const NOTE = `IT-OE-AUTO-${RUN}`;
// Números OE-2026-###### propios de esta corrida (bloque de 100 al azar entre 500000 y 899900).
const OE_BASE = 500000 + Math.floor(Math.random() * 4000) * 100;
let seq = 0;
const oeNumber = () => `OE-2026-${String(OE_BASE + ++seq).padStart(6, "0")}`;

describe.skipIf(Boolean(PROBLEM))(`OE automática con fórmula y lotes en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const formulaVersionId = randomUUID();
  let stockBefore = { movs: 0, balances: "" };

  const assignSvc = async () => (await import("@/lib/planning/work-assignment-service")).assignWorkItemDurable;
  const prep = async () => import("@/lib/planning/oe-auto-prep");
  const repo = async () => import("@/lib/planning/work-item-progress-repository");

  /** Igual que POST /api/v1/work-assignments: asignar y después preparar la OE. */
  const assign = async (over: Record<string, unknown> = {}, key = randomUUID()) => {
    const assignWorkItemDurable = await assignSvc();
    const { prepareOeAfterWorkChange } = await prep();
    const input = {
      sector: "ELABORACION" as const,
      client: CLIENT,
      product: PRODUCT,
      plannedQuantity: "150",
      unit: "kg",
      plannedDate: "2026-11-11",
      branchOwner: "Cristian",
      orderNumber: oeNumber(),
      packagingLote: "IT-OE-L1",
      notes: NOTE,
      idempotencyKey: key,
      ...over,
    };
    const result = await assignWorkItemDurable(input as never, prod, randomUUID());
    const oePrep = result.order?.id
      ? await prepareOeAfterWorkChange(result.order.id, prod, result.replayed ? "Reintento de la asignación" : "Asignación del trabajo a Elaboración")
      : null;
    return { result, oePrep, input };
  };
  const order = async (id: string) => (await q("select * from operational_orders where id = $1", [id]))[0]!;
  const audits = async (id: string, type: string) => q("select * from order_audit_events where order_id = $1 and event_type = $2", [id, type]);
  const fd = async (id: string) => (await order(id)).form_data as import("@/lib/orders/types").OeContent;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    const { normalizeSearchKey } = await import("@/lib/formulas/types");

    // Banco de fórmulas: una fórmula VIGENTE con 5 filas (la misma MP en dos fases) y una incompleta.
    const seedFormula = async (product: string, versionId: string, rows: Array<[string, string, string | null]>) => {
      const productId = randomUUID();
      await q(
        `insert into formula_products (id, normalized_client, normalized_product, display_client, display_product, product_code, active_version_id)
         values ($1,$2,$3,$4,$5,'PT-IT-1',$6)`,
        [productId, normalizeSearchKey(CLIENT), normalizeSearchKey(product), CLIENT, product, versionId]
      );
      await q(
        `insert into formula_versions (id, product_id, version, status, source_hash, semantic_hash, validation_status, source_sheet)
         values ($1,$2,1,'VIGENTE',$3,$3,'OK','Hoja IT')`,
        [versionId, productId, `hash-${versionId}`]
      );
      let pos = 0;
      for (const [name, code, pct] of rows) {
        await q(`insert into formula_ingredients (id, formula_version_id, position, material_name, material_code_or_phase, percentage) values ($1,$2,$3,$4,$5,$6)`, [randomUUID(), versionId, ++pos, name, code, pct]);
      }
      await q(`insert into formula_procedure_steps (id, formula_version_id, position, instruction) values ($1,$2,1,'Calentar fase A a 70 °C')`, [randomUUID(), versionId]);
    };
    await seedFormula(PRODUCT, formulaVersionId, [
      ["Agua desmineralizada", "MP-IT-1", "40"],
      ["Carbopol", "MP-IT-2", "0.5"],
      ["Agua desmineralizada", "MP-IT-1", "40"],
      ["Glicerina", "MP-IT-3", "12"],
      ["Perfume", "MP-IT-4", "7.5"],
    ]);
    await seedFormula(`GEL INCOMPLETO IT ${RUN}`, randomUUID(), [["Agua", "MP-IT-1", "70"], ["Glicerina", "MP-IT-3", null]]);

    // Control semanal de Materias Primas para esa producción: lotes para 3 de las 4 MP (Perfume sin lote).
    const [ctl] = await q(
      `insert into mp_weekly_controls (status, client, product, quantity_kg, created_by, updated_by) values ('BORRADOR',$1,$2,150,'it-mp@x','it-mp@x') returning id`,
      [CLIENT, PRODUCT]
    );
    let order = 0;
    for (const [codigo, mp, lote] of [["MP-IT-1", "Agua desmineralizada", "AG-777"], ["MP-IT-2", "Carbopol", "CB-12"], ["MP-IT-3", "Glicerina", "GL-3"], ["MP-IT-4", "Perfume", ""]]) {
      await q(`insert into mp_weekly_control_lines (control_id, sort_order, codigo, materia_prima, lote) values ($1,$2,$3,$4,$5)`, [ctl!.id, ++order, codigo, mp, lote]);
    }

    const [m] = await q("select count(*)::int as n from mp_stock_movements");
    const bal = await q("select codigo, stock_actual from mp_stock_balances order by codigo");
    stockBefore = { movs: Number(m!.n), balances: JSON.stringify(bal) };
  }, 60_000);

  afterAll(async () => {
    await q("update work_items set deleted_at = now() where notes = $1", [NOTE]).catch(() => undefined);
    await pool?.end();
  });

  const fullCase: { orderId?: string; workId?: string; key?: string; number?: string } = {};

  it("fórmula completa + lotes: la OE de la asignación llega con fórmula, % , kg, lote de fabricación y lotes de MP", async () => {
    const key = randomUUID();
    const { result, oePrep, input } = await assign({}, key);
    Object.assign(fullCase, { orderId: result.order!.id, workId: result.item.id, key, number: input.orderNumber });
    expect(result.order?.created).toBe(true);
    expect(oePrep?.status).toBe("applied");
    const row = await order(fullCase.orderId!);
    expect(row).toMatchObject({ order_number: input.orderNumber, type: "OE", status: "BORRADOR", lot: "IT-OE-L1", linked_work_item_id: result.item.id });
    expect(row.formula_version_id).toBe(formulaVersionId); // uuid del banco
    expect(row.formula_version_hash).toBeTruthy();
    const c = row.form_data as import("@/lib/orders/types").OeContent;
    expect(c.header).toMatchObject({ productName: PRODUCT, client: CLIENT, quantityKg: 150, lot: "IT-OE-L1", code: "PT-IT-1" });
    expect(c.materials.map((x) => [x.materiaPrima, x.formulaPct, x.kgAPesar, x.lote])).toEqual([
      ["Agua desmineralizada", 40, 60, "AG-777"],
      ["Carbopol", 0.5, 0.75, "CB-12"],
      ["Agua desmineralizada", 40, 60, "AG-777"],
      ["Glicerina", 12, 18, "GL-3"],
      ["Perfume", 7.5, 11.25, ""],
    ]);
    expect(c.totals.kgSum).toBe(150);
    expect(c.procedureSteps.map((s) => s.text)).toEqual(["Calentar fase A a 70 °C"]);
    expect(c.autoPrep).toMatchObject({
      workItemId: result.item.id,
      formula: { status: "ok", source: "CACHE_NEON", formulaVersionId },
      lotFabricacion: { value: "IT-OE-L1", status: "ok" },
      mpLots: { status: "pendiente" },
    });
    // MP sin lote: pendiente y señalada.
    expect(c.autoPrep!.pendientes).toEqual(["Lote de MP pendiente: Perfume (MP-IT-4)"]);
    expect(c.autoPrep!.mpLots.lines.find((l) => l.codigo === "MP-IT-4")?.source).toBe("PENDIENTE");
    // Auditoría: creada desde la asignación + preparada; versión con snapshot.
    expect(await audits(fullCase.orderId!, "OE_CREATED_FROM_ASSIGN")).toHaveLength(1);
    const applied = await audits(fullCase.orderId!, "OE_AUTOPREP_APPLIED");
    expect(applied).toHaveLength(1);
    expect(applied[0]!.actor).toBe(prod.email);
    expect(await q("select event from order_versions where order_id = $1 and event = 'autoprep'", [fullCase.orderId])).toHaveLength(1);
    // El Control semanal NO se modifica (solo lectura).
    const [ctl] = await q("select linked_oe_id, updated_by from mp_weekly_controls where product = $1", [PRODUCT]);
    expect(ctl).toMatchObject({ linked_oe_id: null, updated_by: "it-mp@x" });
  });

  it("reintento de la misma asignación: no duplica OE, trabajo ni auditoría", async () => {
    const { result, oePrep } = await assign({ orderNumber: fullCase.number }, fullCase.key);
    expect(result.replayed).toBe(true);
    expect(result.order?.id).toBe(fullCase.orderId);
    expect(oePrep?.status).toBe("unchanged");
    expect(await q("select id from operational_orders where order_number = $1", [fullCase.number])).toHaveLength(1);
    expect(await q("select id from work_items where order_id = $1 and deleted_at is null", [fullCase.orderId])).toHaveLength(1);
    expect(await audits(fullCase.orderId!, "OE_AUTOPREP_APPLIED")).toHaveLength(1);
  });

  it("el Control semanal ya tomado por una OE no se reutiliza para otra OE del mismo producto", async () => {
    const { result } = await assign();
    const c = await fd(result.order!.id);
    expect(c.materials.every((m) => m.lote === "")).toBe(true);
    expect(c.autoPrep!.mpLots.status).toBe("sin_control");
    expect(c.autoPrep!.mpLots.message).toContain(fullCase.number!);
  });

  it("sin fórmula: la OE se crea igual, sin inventar MP, y queda pendiente con el motivo", async () => {
    const { result, oePrep } = await assign({ product: `SIN FORMULA IT ${RUN}` });
    expect(oePrep?.status).toBe("applied");
    const row = await order(result.order!.id);
    expect(row.formula_version_id).toBeNull();
    const c = row.form_data as import("@/lib/orders/types").OeContent;
    expect(c.materials).toEqual([]);
    expect(c.autoPrep!.formula.status).toBe("not_found");
    expect(c.autoPrep!.pendientes[0]).toMatch(/^Fórmula: /);
    expect(c.header).toMatchObject({ quantityKg: 150, lot: "IT-OE-L1" });
  });

  it("fórmula incompleta en el banco: no se usa", async () => {
    const { result } = await assign({ product: `GEL INCOMPLETO IT ${RUN}` });
    const c = await fd(result.order!.id);
    expect(c.materials).toEqual([]);
    expect(c.autoPrep!.formula.status).toBe("incomplete");
    expect(c.autoPrep!.formula.message).toMatch(/sin porcentaje/);
  });

  it("fórmula ambigua o ilegible (inyectada): no se elige ninguna", async () => {
    const assignWorkItemDurable = await assignSvc();
    const { prepareOeFromWork } = await prep();
    for (const [status, message] of [["ambiguous", "Hay 2 archivos con ese producto."], ["error", "No se pudo leer la planilla de Drive."]] as const) {
      const r = await assignWorkItemDurable({ sector: "ELABORACION", client: CLIENT, product: `X ${status} ${RUN}`, plannedQuantity: "10", unit: "kg", plannedDate: "2026-11-11", branchOwner: "Cristian", orderNumber: oeNumber(), notes: NOTE, idempotencyKey: randomUUID() } as never, prod, randomUUID());
      await prepareOeFromWork({ orderId: r.order!.id, actor: prod, reason: "test", resolveFormula: async () => ({ ok: false, status, message }) });
      const c = await fd(r.order!.id);
      expect(c.materials).toEqual([]);
      expect(c.autoPrep!.formula).toMatchObject({ status, message });
    }
  });

  it("fórmula de Drive: ids no-uuid no rompen el guardado; la referencia queda en el hash y en la OE", async () => {
    const assignWorkItemDurable = await assignSvc();
    const { prepareOeFromWork } = await prep();
    const r = await assignWorkItemDurable({ sector: "ELABORACION", client: CLIENT, product: `DRIVE IT ${RUN}`, plannedQuantity: "100", unit: "kg", plannedDate: "2026-11-11", branchOwner: "Cristian", orderNumber: oeNumber(), notes: NOTE, idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const out = await prepareOeFromWork({
      orderId: r.order!.id,
      actor: prod,
      reason: "test",
      resolveFormula: async () => ({
        ok: true,
        ref: { source: "DRIVE", formulaProductId: "drive:FILE1", formulaVersionId: "drive:FILE1:abcd", versionHash: "sha-drive-1", driveFileId: "FILE1", driveModifiedTime: "2026-10-01T10:00:00Z", sourceSheet: "Fórmula" },
        materials: [{ materiaPrima: "Agua", codigo: "MP-IT-1", formulaPct: 90 }, { materiaPrima: "Glicerina", codigo: "MP-IT-3", formulaPct: 10 }],
        procedureSteps: [{ id: "step-0", text: "Mezclar" }],
      }),
    });
    expect(out.status).toBe("applied");
    const row = await order(r.order!.id);
    expect(row).toMatchObject({ formula_product_id: null, formula_version_id: null, formula_version_hash: "sha-drive-1" });
    const c = row.form_data as import("@/lib/orders/types").OeContent;
    expect(c.autoPrep!.formula).toMatchObject({ source: "DRIVE", driveFileId: "FILE1", formulaVersionId: "drive:FILE1:abcd" });
    expect(c.materials.map((m) => m.kgAPesar)).toEqual([90, 10]);
  });

  it("cambios del trabajo ANTES de empezar: cantidad y lote se sincronizan a la OE (con auditoría)", async () => {
    const { updateWorkItemPlanningDurable, updateWorkItemLoteVtoDurable } = await repo();
    const v = Number((await q("select version from work_items where id = $1", [fullCase.workId]))[0]!.version);
    await updateWorkItemPlanningDurable(fullCase.workId!, { plannedQuantity: "1.234,5", expectedVersion: v, updatedBy: prod.email, updatedBySector: "PRODUCCION", reason: "Más pedido" } as never);
    let c = await fd(fullCase.orderId!);
    expect(c.header.quantityKg).toBe(1234.5);
    expect(c.materials.map((m) => m.kgAPesar)).toEqual([493.8, 6.1725, 493.8, 148.14, 92.5875]);
    // El control (armado para 150 kg) sigue asociado: lotes conservados y aviso para confirmarlos con Materias Primas.
    expect(c.materials.map((m) => m.lote)).toEqual(["AG-777", "CB-12", "AG-777", "GL-3", ""]);
    expect(c.autoPrep!.pendientes).toContain("El Control semanal se armó para 150 kg y la OE es de 1.234,5 kg: confirmá los lotes de MP con Materias Primas.");
    await updateWorkItemLoteVtoDurable(fullCase.workId!, { packagingLote: "IT-OE-L1-B", reason: "Lote corregido", updatedBy: prod.email, updatedBySector: "PRODUCCION" } as never);
    c = await fd(fullCase.orderId!);
    expect(c.header.lot).toBe("IT-OE-L1-B");
    expect((await order(fullCase.orderId!)).lot).toBe("IT-OE-L1-B");
    expect(await audits(fullCase.orderId!, "OE_AUTOPREP_APPLIED")).toHaveLength(3);
  });

  it("DESPUÉS de empezar la elaboración: no se reemplaza nada automáticamente; la acción explícita muestra y aplica con confirmación", async () => {
    const { updateWorkItemPlanningDurable } = await repo();
    const { prepareOeFromWork, OeAutoPrepConflictError } = await prep();
    // El elaborador registró pH y un ajuste con motivo; la OE pasó a EN_PROCESO.
    const c0 = await fd(fullCase.orderId!);
    c0.processControl.ph = "5,6";
    c0.materials[3]!.ajuste = 0.3;
    c0.materials[3]!.ajusteMotivo = "Corrección de pesada";
    c0.materials[4]!.lote = "PF-A-MANO";
    await q("update operational_orders set form_data = $2, status = 'EN_PROCESO', version = version + 1 where id = $1", [fullCase.orderId, JSON.stringify(c0)]);
    const before = await order(fullCase.orderId!);

    const v = Number((await q("select version from work_items where id = $1", [fullCase.workId]))[0]!.version);
    await updateWorkItemPlanningDurable(fullCase.workId!, { plannedQuantity: "100", expectedVersion: v, updatedBy: prod.email, updatedBySector: "PRODUCCION", reason: "Menos pedido" } as never);
    const after = await order(fullCase.orderId!);
    expect(after.version).toBe(before.version);
    expect(after.form_data).toEqual(before.form_data);
    expect(await audits(fullCase.orderId!, "OE_AUTOPREP_SKIPPED_STARTED")).toHaveLength(1);

    // Vista previa (no guarda).
    const preview = await prepareOeFromWork({ orderId: fullCase.orderId!, actor: prod, reason: "Vista previa", explicit: true, dryRun: true });
    expect(preview.status).toBe("applied");
    expect((await order(fullCase.orderId!)).version).toBe(before.version);
    // Confirmación con versión vieja → conflicto.
    await expect(prepareOeFromWork({ orderId: fullCase.orderId!, actor: prod, reason: "x", explicit: true, expectedVersion: before.version - 1 })).rejects.toBeInstanceOf(OeAutoPrepConflictError);
    // Confirmación correcta: recalcula kg, conserva pH, ajuste con motivo y el lote escrito a mano.
    const applied = await prepareOeFromWork({ orderId: fullCase.orderId!, actor: prod, reason: "Actualización manual", explicit: true, expectedVersion: before.version });
    expect(applied.status).toBe("applied");
    const c = await fd(fullCase.orderId!);
    expect(c.header.quantityKg).toBe(100);
    expect(c.processControl.ph).toBe("5,6");
    expect(c.materials[3]).toMatchObject({ kgAPesar: 12, ajuste: 0.3, ajusteMotivo: "Corrección de pesada" });
    expect(c.materials[4]).toMatchObject({ lote: "PF-A-MANO" });
    expect(c.autoPrep!.mpLots.lines[4]!.source).toBe("MANUAL");
    expect((await order(fullCase.orderId!)).status).toBe("EN_PROCESO");
    expect(await audits(fullCase.orderId!, "OE_AUTOPREP_MANUAL_REFRESH")).toHaveLength(1);
  });

  it("dos asignaciones simultáneas con el mismo N° de OE: una sola OE y un solo trabajo vinculado", async () => {
    const number = oeNumber();
    const results = await Promise.allSettled([assign({ orderNumber: number }), assign({ orderNumber: number })]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.message).toMatch(/OE|trabajo asignado|otra operación/);
    const oes = await q("select id, linked_work_item_id from operational_orders where order_number = $1", [number]);
    expect(oes).toHaveLength(1);
    expect(await audits(String(oes[0]!.id), "OE_AUTOPREP_APPLIED")).toHaveLength(1);
  });

  it("misma asignación enviada dos veces a la vez (doble clic): un trabajo, una OE, una preparación", async () => {
    const key = randomUUID();
    const number = oeNumber();
    const results = await Promise.allSettled([assign({ orderNumber: number }, key), assign({ orderNumber: number }, key)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const oes = await q("select id from operational_orders where order_number = $1", [number]);
    expect(oes).toHaveLength(1);
    expect(await q("select id from work_items where origin_ref = $1", [`assign:idem:${key}`])).toHaveLength(1);
    expect(await audits(String(oes[0]!.id), "OE_AUTOPREP_APPLIED")).toHaveLength(1);
  });

  it("dos preparaciones simultáneas de la misma OE: una aplica, la otra no duplica", async () => {
    const assignWorkItemDurable = await assignSvc();
    const { prepareOeFromWork } = await prep();
    const r = await assignWorkItemDurable({ sector: "ELABORACION", client: CLIENT, product: PRODUCT, plannedQuantity: "50", unit: "kg", plannedDate: "2026-11-11", branchOwner: "Cristian", orderNumber: oeNumber(), packagingLote: "IT-OE-C", notes: NOTE, idempotencyKey: randomUUID() } as never, prod, randomUUID());
    const outs = await Promise.all([1, 2].map(() => prepareOeFromWork({ orderId: r.order!.id, actor: prod, reason: "concurrente" })));
    expect(outs.map((o) => o.status).sort()).toEqual(["applied", "unchanged"]);
    expect(await audits(r.order!.id, "OE_AUTOPREP_APPLIED")).toHaveLength(1);
  });

  it("cantidad en unidades: no se convierte; kg pendiente", async () => {
    const { result } = await assign({ unit: "un.", plannedQuantity: "1000" });
    const c = await fd(result.order!.id);
    expect(c.header.quantityKg).toBeNull();
    expect(c.materials.every((m) => m.kgAPesar == null)).toBe(true);
    expect(c.autoPrep!.quantity.status).toBe("pendiente");
  });

  it("ninguna de estas operaciones movió stock: libro mayor y saldos de MP idénticos", async () => {
    const [m] = await q("select count(*)::int as n from mp_stock_movements");
    const bal = await q("select codigo, stock_actual from mp_stock_balances order by codigo");
    expect(Number(m!.n)).toBe(stockBefore.movs);
    expect(JSON.stringify(bal)).toBe(stockBefore.balances);
  });
});
