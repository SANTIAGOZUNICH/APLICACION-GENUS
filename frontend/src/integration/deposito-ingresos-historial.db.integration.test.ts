/**
 * Depósito → Ingresos (historial permanente) vs Inventario (stock vigente) contra un Postgres de PRUEBA real.
 * Replica lo que hace la API en cada request: hidratar desde la base → servicio → persistir filas modificadas.
 * Datos ficticios con código «IT-IH-*»: nunca se toca nada real. Se SALTA sin base local marcada.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const dep = { email: "it-dep@laboratoriogenus.com.ar", sector: "DEPOSITO" as const };
const prod = { email: "it-prod@laboratoriogenus.com.ar", sector: "PRODUCCION" as const };
const cal = { email: "it-cod@laboratoriogenus.com.ar", sector: "CODIFICADO" as const };
const COD = "IT-IH-FRASCO";
const COD2 = "IT-IH-TAPA";

describe.skipIf(Boolean(PROBLEM))(`Depósito: Ingresos = historial, Inventario = stock${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const clean = async () => {
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials"]) await q(`delete from ${t} where payload->>'codigo' like 'IT-IH-%'`);
  };
  /** Un «request» de la API: hidrata, ejecuta, persiste. */
  const request = async <T,>(fn: (s: import("@/lib/inventory/inventory-service").InventoryService) => T): Promise<T> => {
    const { memoryInventoryRepo } = await import("@/lib/inventory/memory-repo");
    const { hydrateInventoryFromNeon, persistInventorySnapshot } = await import("@/lib/inventory/neon-persist");
    const { getInventoryService } = await import("@/lib/inventory/get-inventory-service");
    await hydrateInventoryFromNeon(memoryInventoryRepo, { force: true });
    const out = fn(getInventoryService());
    await persistInventorySnapshot(memoryInventoryRepo);
    return out;
  };
  const rowCount = async (t: string) => Number((await q(`select count(*)::int n from ${t} where payload->>'codigo' like 'IT-IH-%'`))[0]!.n);
  const stock = (cod: string) => request((s) => s.listMeMaterials(dep).find((m) => m.codigo === cod)?.stockActual);
  const historial = () => request((s) => s.listMeIngresosHistorial(dep).filter((r) => r.codigo.startsWith("IT-IH-")));
  const ing = (over: Record<string, unknown> = {}) => ({ codigo: COD, descripcionInsumo: "Frasco IT", cliente: "CLIENTE IT", proveedor: "PROV IT", unidad: "u", bultos: 1, cantidad: 2000, fecha: "2026-11-02", ...over });

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await clean();
  }, 60_000);
  afterAll(async () => {
    await clean().catch(() => undefined);
    await pool?.end();
  });

  it("1-4) un ingreso de 2.000 suma 2.000 exactos, queda en el historial y sobrevive a recargar", async () => {
    const created = await request((s) => s.upsertMeIngreso(dep, ing({ id: "11111111-1111-4111-8111-111111111111" })));
    expect(await stock(COD)).toBe(2000);
    for (let i = 0; i < 2; i++) {
      vi.resetModules(); // «recargar»
      const h = await historial();
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ id: created.id, total: 2000, fecha: "2026-11-02", cliente: "CLIENTE IT", createdBy: dep.email, anulado: false });
    }
    expect(await stock(COD)).toBe(2000);
  });

  it("5-7) una salida de 500 deja stock 1.500 y el ingreso sigue mostrando 2.000 ingresadas", async () => {
    await request((s) => s.upsertMeSalida(dep, { codigo: COD, cantidad: 500, cliente: "CLIENTE IT", motivoSalida: "DESCARTE", descuentaStock: true, fecha: "2026-11-03" }));
    expect(await stock(COD)).toBe(1500);
    const h = await historial();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ total: 2000, anulado: false });
    expect(await request((s) => s.listMeIngresos(dep).filter((r) => r.codigo === COD).map((r) => r.total))).toEqual([2000]);
  });

  it("8) varios ingresos del mismo material aparecen por separado y suman en el stock", async () => {
    await request((s) => s.upsertMeIngreso(dep, ing({ id: "22222222-2222-4222-8222-222222222222", cantidad: 300, fecha: "2026-11-04" })));
    await request((s) => s.upsertMeIngreso(dep, ing({ id: "33333333-3333-4333-8333-333333333333", cantidad: 700, fecha: "2026-11-05" })));
    const h = await historial();
    expect(h.map((r) => r.total).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([300, 700, 2000]);
    expect(await stock(COD)).toBe(1500 + 300 + 700);
  });

  it("9) listar/recargar/reintentar con el mismo id NO suma stock ni crea filas", async () => {
    const before = { ing: await rowCount("inv_me_ingresos"), st: await stock(COD) };
    for (let i = 0; i < 3; i++) {
      await historial();
      await request((s) => s.listMeIngresos(dep));
      await request((s) => s.upsertMeIngreso(dep, ing({ id: "11111111-1111-4111-8111-111111111111", cantidad: 2000 })));
    }
    expect(await rowCount("inv_me_ingresos")).toBe(before.ing);
    expect(await stock(COD)).toBe(before.st);
    expect((await historial()).filter((r) => r.id === "11111111-1111-4111-8111-111111111111")).toHaveLength(1);
  });

  it("anular un ingreso lo conserva en el historial (marcado), con motivo, y baja el stock; la lista clásica ya no lo cuenta", async () => {
    const st0 = await stock(COD);
    await request((s) => s.anularMeIngreso(dep, "33333333-3333-4333-8333-333333333333", "carga errónea"));
    expect(await stock(COD)).toBe((st0 ?? 0) - 700);
    const h = await historial();
    expect(h).toHaveLength(3);
    expect(h.find((r) => r.id === "33333333-3333-4333-8333-333333333333")).toMatchObject({ anulado: true, anuladoReason: "carga errónea", total: 700 });
    expect(await request((s) => s.listMeIngresos(dep).filter((r) => r.codigo === COD))).toHaveLength(2);
  });

  it("dar de baja el material NO borra sus ingresos: quedan anulados con el motivo de la baja y sin filas eliminadas", async () => {
    await request((s) => s.upsertMeIngreso(dep, ing({ codigo: COD2, descripcionInsumo: "Tapa IT", id: "44444444-4444-4444-8444-444444444444", cantidad: 100 })));
    const n0 = await rowCount("inv_me_ingresos");
    const mat = await request((s) => s.listMeMaterials(dep).find((m) => m.codigo === COD2)!);
    await request((s) => s.deleteMeMaterial(dep, mat.id, "discontinuado"));
    expect(await rowCount("inv_me_ingresos")).toBe(n0);
    const h = (await historial()).find((r) => r.id === "44444444-4444-4444-8444-444444444444");
    expect(h).toMatchObject({ anulado: true, total: 100 });
    expect(String(h!.anuladoReason)).toMatch(/dado de baja.*discontinuado/i);
  });

  it("10) ingresos anulados ya persistidos reaparecen en el historial sin crear movimientos", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    const T = "2026-10-01T10:00:00.000Z";
    await q("insert into inv_me_ingresos (id, payload) values ($1,$2)", [id, { id, fecha: "2026-10-01", ingresoNro: "IT-IH-OLD", proveedor: "P", cliente: "CLIENTE IT", remitoNro: "", codigo: "IT-IH-OLD", descripcionInsumo: "Viejo", bultos: 1, cantidad: 90, total: 90, ubicacion: "", materialId: null, anulado: true, anuladoAt: T, anuladoReason: "histórico", createdBy: "it", updatedBy: "it", createdAt: T, updatedAt: T }]);
    const n0 = await rowCount("inv_me_ingresos");
    expect((await historial()).find((r) => r.id === id)).toMatchObject({ anulado: true, total: 90 });
    expect(await rowCount("inv_me_ingresos")).toBe(n0);
  });

  it("permisos: Producción lee el historial pero no registra; un sector sin lectura queda rechazado; Depósito conserva su escritura", async () => {
    await request((s) => expect(s.listMeIngresosHistorial(prod).length).toBeGreaterThan(0));
    await request((s) => expect(() => s.upsertMeIngreso(prod, ing({ codigo: "IT-IH-PROD" }))).toThrow());
    await request((s) => expect(() => s.listMeIngresosHistorial(cal)).toThrow());
    expect(await rowCount("inv_me_ingresos")).toBeGreaterThan(0);
  });
});
