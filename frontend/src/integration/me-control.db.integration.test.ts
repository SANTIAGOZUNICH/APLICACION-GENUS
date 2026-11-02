/**
 * Control inteligente de ME (0076) contra un Postgres de PRUEBA real (mismo SQL que Neon).
 * Datos ficticios con prefijo «IT-MC»: nunca se toca nada real. La IA se simula (`ask`): no se llama a ningún proveedor.
 * Se SALTA sin base local marcada. Se corre con el runner de integración (ver scripts/e2e/README.md).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const dep = { email: "it-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" };
const prodA = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" };
const dir = { email: "it-dir@laboratoriogenus.com.ar", sector: "DIRECCION" };
const cal = { email: "it-cal@laboratoriogenus.com.ar", sector: "CALIDAD" };
const T = "2026-10-01T10:00:00.000Z";
const TODAY = "2026-11-02";
const WEEK = "2026-11-02";
const CLIENT = "IT-MC AQUALO";
const PRODUCT = "SERUM CAPILAR";

describe.skipIf(Boolean(PROBLEM))(`Control de ME${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = () => import("@/lib/me-control/service");
  const uid = () => randomUUID();

  const mat = (codigo: string, descripcion: string, cliente = CLIENT, producto = "") => q("insert into inv_me_materials (id, payload) values (gen_random_uuid(), $1)", [{ id: uid(), codigo, descripcion, cliente, producto, ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: T, archived: false }]);
  const ingreso = (codigo: string, total: number) => q("insert into inv_me_ingresos (id, payload) values (gen_random_uuid(), $1)", [{ id: uid(), fecha: "2026-10-01", ingresoNro: `I-${codigo}-${total}`, proveedor: "PROV IT", cliente: CLIENT, remitoNro: "R", codigo, descripcionInsumo: codigo, bultos: 1, cantidad: total, total, ubicacion: "A1", materialId: null, anulado: false, createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
  const job = async (qty: number, date = WEEK, over: { product?: string; client?: string; sector?: string; unit?: string } = {}) => {
    const sector = over.sector ?? "ENVASADO_PREMIUM";
    const line = sector === "ELABORACION" || sector === "CODIFICADO" ? null : "Línea 1";
    const branch = sector === "ELABORACION" ? "Cristian" : null;
    return String((await q("insert into work_items (client, product, planned_quantity, unit, sector, line, branch_owner, status, created_by, planned_date) values ($1,$2,$3,$4,$5::work_item_sector,$6,$7,'PUBLICADO','it',$8) returning id", [over.client ?? CLIENT, over.product ?? PRODUCT, String(qty), over.unit ?? "un.", sector, line, branch, date]))[0]!.id);
  };
  const sync = async (ask?: NonNullable<import("@/lib/me-control/service").SyncOptions["ask"]>) => (await svc()).syncMeControl({ today: TODAY, ai: Boolean(ask), ask });
  const alerts = async (statuses: Array<"ABIERTA" | "CERRADA" | "RESUELTA"> = ["ABIERTA"]) => (await (await svc()).listAlerts(dep, { statuses, sync: false })).alerts.filter((a) => a.client.startsWith("IT-MC"));
  const counts = async () => ({
    ingresos: Number((await q("select count(*)::int n from inv_me_ingresos"))[0]!.n),
    salidas: Number((await q("select count(*)::int n from inv_me_salidas"))[0]!.n),
    ajustes: Number((await q("select count(*)::int n from inv_ajustes"))[0]!.n),
  });
  const aiPick = (code: string, verdict = "probable") => async () => ({ ok: true as const, json: { results: [{ gapId: "0", options: [{ code, verdict, reason: "rosca y medida coinciden según el nombre" }] }] } });

  const clean = async () => {
    await q("delete from me_control_alerts where client like 'IT-MC%'");
    await q("delete from me_product_materials where client like 'IT-MC%'");
    await q("delete from me_material_compat where base_codigo like 'IT-MC-%' or accessory_codigo like 'IT-MC-%'");
    await q("delete from work_items where client like 'IT-MC%'");
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'IT-MC-%'`);
    await q("delete from inv_audit where payload->>'module' = 'me_control' and payload->>'actor' like 'it-%'");
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.GENUS_ME_CONTROL_AUTOSYNC = "0";
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await clean();
  }, 60_000);
  beforeEach(async () => {
    await clean();
    (globalThis as unknown as { __genusMeAi?: Map<string, number> }).__genusMeAi?.clear();
  });
  afterAll(async () => {
    await clean().catch(() => undefined);
    await pool?.end();
  });

  it("la migración 0076 es aditiva e idempotente (se aplica dos veces sin error)", async () => {
    const sqlText = readFileSync("drizzle/0076_me_control.sql", "utf8");
    for (let i = 0; i < 2; i++) for (const stmt of sqlText.split("--> statement-breakpoint").map((x) => x.replace(/--[^\n]*\n/g, "").trim()).filter(Boolean)) await q(stmt);
    const t = (await q("select table_name from information_schema.tables where table_name in ('me_product_materials','me_material_compat','me_control_alerts')")).map((r) => r.table_name);
    expect(t.sort()).toEqual(["me_control_alerts", "me_material_compat", "me_product_materials"]);
  });

  it("1) trabajo nuevo sin ningún ME asociado → alerta «REVISAR», sin inventar faltantes de SKU", async () => {
    await job(2000);
    await sync();
    const [a] = await alerts();
    expect(a).toMatchObject({ client: CLIENT, product: PRODUCT, status: "ABIERTA", sinAsociacion: true, totalQty: 2000 });
    expect(a!.shortages).toEqual([]);
    expect(a!.lines.join(" ")).toMatch(/no tiene materiales de empaque asociados/i);
  });

  it("ejemplo del pedido: 2.000 uds, 1.200 frascos y ningún dropper → faltan 800 frascos y la necesidad estimada de 2.000 droppers (a identificar)", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await ingreso("IT-MC-FRASCO", 1200);
    await job(2000);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO", qtyPerUnit: 1 });
    await sync();
    const [a] = await alerts();
    expect(a!.shortages).toEqual([expect.objectContaining({ codigo: "IT-MC-FRASCO", needed: 2000, stock: 1200, faltante: 800, confirmation: "CONFIRMADO" })]);
    expect(a!.unidentified).toEqual([expect.objectContaining({ role: "DISPENSADOR", estimated: 2000 })]);
    expect(a!.lines.join("\n")).toMatch(/800 × IT-MC-FRASCO/);
    expect(a!.lines.join("\n")).toMatch(/falta identificar el material exacto/);
  });

  it("3) la IA sugiere un dropper real: queda «sugerido» (no confirmado) hasta que Depósito lo confirma; después es faltante confirmado", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await mat("IT-MC-DROP-A", "Dropper Aqualo 30 ml");
    await ingreso("IT-MC-FRASCO", 1200);
    await job(2000);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await sync(aiPick("IT-MC-DROP-A"));
    let cfg = await s.getProductConfig(dep, CLIENT, PRODUCT);
    const sug = cfg.rows.find((r) => r.materialCodigo === "IT-MC-DROP-A")!;
    expect(sug).toMatchObject({ status: "SUGERIDO", source: "IA" });
    let [a] = await alerts();
    expect(a!.shortages.find((x) => x.codigo === "IT-MC-DROP-A")).toMatchObject({ confirmation: "SUGERIDO", faltante: 2000 });
    expect(a!.lines.join("\n")).toMatch(/sugerido por IA/);
    await s.confirmRow(dep, sug.id);
    [a] = await alerts();
    expect(a!.shortages.find((x) => x.codigo === "IT-MC-DROP-A")).toMatchObject({ confirmation: "CONFIRMADO", needed: 2000, stock: 0, faltante: 2000 });
    expect(a!.unidentified).toEqual([]);
    // la compatibilidad queda guardada para futuras producciones
    expect((await q("select status from me_material_compat where base_codigo='IT-MC-FRASCO' and accessory_codigo='IT-MC-DROP-A'"))[0]).toMatchObject({ status: "COMPATIBLE" });
  });

  it("la IA no puede inventar: un código fuera de los candidatos reales se descarta", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await mat("IT-MC-DROP-A", "Dropper Aqualo 30 ml");
    await job(500);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await sync(aiPick("IT-MC-INVENTADO", "compatible"));
    const cfg = await s.getProductConfig(dep, CLIENT, PRODUCT);
    expect(cfg.rows.map((r) => r.materialCodigo)).toEqual(["IT-MC-FRASCO"]);
    const [a] = await alerts();
    expect(a!.unidentified.map((u) => u.role)).toEqual(["DISPENSADOR"]);
  });

  it("15) sugerencia incorrecta de la IA corregida manualmente: se reemplaza por el dropper correcto y no vuelve a proponerse el rechazado", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await mat("IT-MC-DROP-A", "Dropper Aqualo 30 ml");
    await mat("IT-MC-DROP-B", "Dropper Aqualo 50 ml");
    await job(100);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await sync(aiPick("IT-MC-DROP-B"));
    const bad = (await s.getProductConfig(dep, CLIENT, PRODUCT)).rows.find((r) => r.materialCodigo === "IT-MC-DROP-B")!;
    expect(bad.status).toBe("SUGERIDO");
    const fixed = await s.replaceRow(dep, bad.id, "IT-MC-DROP-A");
    expect(fixed).toMatchObject({ materialCodigo: "IT-MC-DROP-A", status: "CONFIRMADO", source: "MANUAL" });
    await sync(aiPick("IT-MC-DROP-B"));
    const rows = (await s.getProductConfig(dep, CLIENT, PRODUCT)).rows;
    expect(rows.filter((r) => r.role === "DISPENSADOR").map((r) => [r.materialCodigo, r.status])).toEqual([["IT-MC-DROP-A", "CONFIRMADO"]]);
    // marcar la pieza como incompatible y rechazar: no se vuelve a sugerir
    await s.setCompat(dep, { baseCodigo: "IT-MC-FRASCO", accessoryCodigo: "IT-MC-DROP-B", status: "INCOMPATIBLE" });
    expect((await q("select status from me_material_compat where accessory_codigo='IT-MC-DROP-B'"))[0]).toMatchObject({ status: "INCOMPATIBLE" });
  });

  it("6) stock parcial, 7) dos trabajos que comparten el mismo material (el stock se cuenta una sola vez) y 8) stock suficiente", async () => {
    await mat("IT-MC-POTE", "Pote crema 50 g");
    await mat("IT-MC-TAPA", "Tapa pote 50 g");
    await ingreso("IT-MC-POTE", 1000);
    await ingreso("IT-MC-TAPA", 5000);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: "CREMA A", materialCodigo: "IT-MC-POTE" });
    await s.addMaterial(dep, { client: CLIENT, product: "CREMA A", materialCodigo: "IT-MC-TAPA" });
    await s.addMaterial(dep, { client: CLIENT, product: "CREMA B", materialCodigo: "IT-MC-POTE" });
    await s.addMaterial(dep, { client: CLIENT, product: "CREMA B", materialCodigo: "IT-MC-TAPA" });
    await job(600, "2026-11-02", { product: "CREMA A" });
    await job(600, "2026-11-03", { product: "CREMA B" });
    await sync();
    const list = await alerts();
    // 1.000 potes alcanzan para el primero (600) pero NO para los dos (1.200): faltan 200 en el segundo; las tapas alcanzan.
    expect(list.map((a) => [a.product, a.shortages.map((x) => [x.codigo, x.faltante])])).toEqual([["CREMA B", [["IT-MC-POTE", 200]]]]);
    // con stock suficiente para todo, la alerta se resuelve
    await ingreso("IT-MC-POTE", 500);
    await sync();
    expect(await alerts()).toEqual([]);
    expect((await alerts(["RESUELTA"])).map((a) => a.product)).toEqual(["CREMA B"]);
  });

  it("9) cambio de semana y 10) cancelación de trabajo; 11) recepción de material que resuelve el faltante", async () => {
    await mat("IT-MC-FRASCO", "Frasco 100 ml Aqualo");
    await mat("IT-MC-TAPA", "Tapa 100 ml Aqualo");
    await ingreso("IT-MC-TAPA", 9999);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-TAPA" });
    const id = await job(300, "2026-11-02");
    await sync();
    expect((await alerts()).map((a) => a.weekStart)).toEqual(["2026-11-02"]);
    await q("update work_items set planned_date='2026-11-10' where id=$1", [id]);
    await sync();
    const moved = await alerts();
    expect(moved.map((a) => a.weekStart)).toEqual(["2026-11-09"]);
    expect((await alerts(["RESUELTA"])).map((a) => a.weekStart)).toEqual(["2026-11-02"]);
    await ingreso("IT-MC-FRASCO", 300); // recepción real: resuelve
    await sync();
    expect(await alerts()).toEqual([]);
    await q("delete from inv_me_ingresos where payload->>'codigo'='IT-MC-FRASCO'");
    await sync();
    expect(await alerts()).toHaveLength(1);
    await q("update work_items set operational_status='cancelado' where id=$1", [id]);
    await sync();
    expect(await alerts()).toEqual([]);
  });

  it("12) la alerta persiste tras recargar, 13) se cierra a mano (quién y cuándo) sin borrar el faltante, 14) un faltante mayor la reabre", async () => {
    await mat("IT-MC-FRASCO", "Frasco 100 ml Aqualo");
    await mat("IT-MC-TAPA", "Tapa 100 ml Aqualo");
    await ingreso("IT-MC-TAPA", 9999);
    await ingreso("IT-MC-FRASCO", 100);
    const s0 = await svc();
    await s0.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await s0.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-TAPA" });
    await job(500, "2026-11-02");
    await sync();
    await sync();
    await Promise.all([sync(), sync(), sync()]);
    expect(await q("select count(*)::int n from me_control_alerts where client like 'IT-MC%'")).toEqual([{ n: 1 }]); // sin duplicados
    vi.resetModules(); // «recargar»: otra instancia del servidor
    const s = await svc();
    const [open] = (await s.listAlerts(dep, { sync: false })).alerts.filter((a) => a.client.startsWith("IT-MC"));
    expect(open).toMatchObject({ status: "ABIERTA", shortages: [expect.objectContaining({ faltante: 400 })] });
    // Producción y Dirección consultan pero no cierran
    expect((await s.listAlerts(prodA, { sync: false })).alerts.some((a) => a.client.startsWith("IT-MC"))).toBe(true);
    await expect(s.closeAlert(prodA, open!.id)).rejects.toThrow(/Solo Depósito/);
    await expect(s.closeAlert(dir, open!.id)).rejects.toThrow(/Solo Depósito/);
    const closed = await s.closeAlert(dep, open!.id);
    expect(closed).toMatchObject({ status: "CERRADA", closedBy: dep.email });
    expect(closed.closedAt).toBeTruthy();
    expect(await alerts()).toEqual([]); // ya no se muestra como abierta…
    await sync();
    const [still] = await alerts(["CERRADA"]);
    expect(still!.shortages[0]).toMatchObject({ faltante: 400 }); // …pero el faltante sigue calculado: cerrar no lo borra ni lo marca recibido
    await sync(); // otra pasada: sigue cerrada, sin reabrir ni duplicar
    expect(await alerts()).toEqual([]);
    await job(300, "2026-11-04"); // aparece otro trabajo del mismo producto → empeora
    await sync();
    const [re] = await alerts();
    expect(re).toMatchObject({ status: "ABIERTA", reopenCount: 1, closedBy: null });
    expect(re!.shortages[0]).toMatchObject({ faltante: 700 });
    expect(await q("select count(*)::int n from me_control_alerts where client like 'IT-MC%'")).toEqual([{ n: 1 }]);
  });

  it("14b) un faltante que MEJORA tras cerrar no reabre la alerta", async () => {
    await mat("IT-MC-FRASCO", "Frasco 100 ml Aqualo");
    await mat("IT-MC-TAPA", "Tapa 100 ml Aqualo");
    await ingreso("IT-MC-TAPA", 9999);
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-TAPA" });
    await job(500);
    await sync();
    const [a] = await alerts();
    await s.closeAlert(dep, a!.id);
    await ingreso("IT-MC-FRASCO", 300); // llega parte del material
    await sync();
    expect(await alerts()).toEqual([]);
    expect((await alerts(["CERRADA"]))[0]!.shortages[0]).toMatchObject({ faltante: 200 });
  });

  it("16) permisos: Calidad no ve el control; Producción/Dirección no confirman ni editan asociaciones; Depósito sí", async () => {
    await mat("IT-MC-FRASCO", "Frasco 100 ml Aqualo");
    const s = await svc();
    await expect(s.getWeekReport(cal, WEEK)).rejects.toThrow(/no puede consultar/);
    await expect(s.listAlerts(cal, { sync: false })).rejects.toThrow(/no puede consultar/);
    await expect(s.addMaterial(prodA, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" })).rejects.toThrow(/Solo Depósito/);
    await expect(s.addMaterial(dir, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" })).rejects.toThrow(/Solo Depósito/);
    await expect(s.suggestWithAi(prodA, CLIENT, PRODUCT)).rejects.toThrow(/Solo Depósito/);
    await expect(s.setCompat(dir, { baseCodigo: "IT-MC-FRASCO", accessoryCodigo: "IT-MC-FRASCO", status: "COMPATIBLE" })).rejects.toThrow(/Solo Depósito/);
    await expect(s.getWeekReport(prodA, WEEK)).resolves.toBeTruthy();
    await expect(s.getWeekReport(dir, WEEK)).resolves.toBeTruthy();
    await expect(s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-NO-EXISTE" })).rejects.toThrow(/no existe en el inventario/);
    await expect(s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO", qtyPerUnit: 0 })).rejects.toThrow(/mayor que 0/);
  });

  it("17) planificar, sincronizar y configurar NO genera ningún movimiento de stock ni toca la planificación", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await ingreso("IT-MC-FRASCO", 1200);
    const id = await job(2000);
    const before = await counts();
    const jobBefore = (await q("select planned_quantity, planned_date::text d, status::text s, version from work_items where id=$1", [id]))[0];
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await sync();
    await sync();
    const [a] = await alerts();
    await s.closeAlert(dep, a!.id);
    expect(await counts()).toEqual(before);
    expect((await q("select planned_quantity, planned_date::text d, status::text s, version from work_items where id=$1", [id]))[0]).toEqual(jobBefore);
    const stock = (await s.getProductConfig(dep, CLIENT, PRODUCT)).rows[0]!.stock;
    expect(stock).toBe(1200);
  });

  it("el control semanal muestra cliente, producto, cantidad, material, necesario, stock, faltante y estado; Envasado Masivo y Premium", async () => {
    await mat("IT-MC-FRASCO", "Frasco gotero 30 ml Aqualo");
    await mat("IT-MC-DROP-A", "Dropper Aqualo 30 ml");
    await mat("IT-MC-ETIQ", "Etiqueta Aqualo Serum Capilar");
    await ingreso("IT-MC-FRASCO", 1200);
    await ingreso("IT-MC-ETIQ", 2500);
    await job(2000, WEEK, { sector: "ENVASADO_MASIVO" });
    await job(100, WEEK, { sector: "ELABORACION", unit: "kg" }); // Elaboración no es Envasado: no entra
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-DROP-A" });
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-ETIQ" });
    const r = await s.getWeekReport(prodA, "2026-11-05");
    expect(r.weekStart).toBe("2026-11-02");
    const j = r.jobs.filter((x) => x.job.client === CLIENT);
    expect(j).toHaveLength(1);
    expect(j[0]!.stateLabel).toBe("Stock insuficiente");
    expect(j[0]!.lines.map((l) => [l.materialCodigo, l.needed, l.stock, l.faltante, l.state])).toEqual([
      ["IT-MC-FRASCO", 2000, 1200, 800, "FALTANTE"],
      ["IT-MC-DROP-A", 2000, 0, 2000, "FALTANTE"],
      ["IT-MC-ETIQ", 2000, 2500, 0, "OK"],
    ]);
  });

  it("trabajo en kg sin unidades de embalaje: queda «pendiente de confirmación», no se inventa una cantidad", async () => {
    await mat("IT-MC-FRASCO", "Frasco 100 ml");
    await job(50, WEEK, { unit: "kg" });
    const s = await svc();
    await s.addMaterial(dep, { client: CLIENT, product: PRODUCT, materialCodigo: "IT-MC-FRASCO" });
    const r = await s.getWeekReport(dep, WEEK);
    expect(r.jobs.find((x) => x.job.client === CLIENT)).toMatchObject({ qtyIssue: true, state: expect.stringMatching(/PENDIENTE_CONFIRMACION|MATERIAL_SIN_IDENTIFICAR/) });
  });
});
