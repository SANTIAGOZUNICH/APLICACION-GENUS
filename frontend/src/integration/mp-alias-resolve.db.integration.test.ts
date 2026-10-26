/**
 * Control de MP — resolver «NO IDENTIFICADA» en un Postgres de PRUEBA real: coincidencias sugeridas del Stock MP, confirmar una
 * equivalencia (quién, cuándo, denominación original), que se recuerde, rechazar una que contradice la concentración, desactivarla
 * con historial, y que NADA del stock ni de las fórmulas cambie. Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const GLI = "GLICERINA VEGETAL"; // nombres reales (sin sufijo): la base es descartable; los códigos sí llevan la corrida
const PAN75 = "D-PANTENOL 75%";
const PAN50 = "PANTENOL 50%";

describe.skipIf(Boolean(PROBLEM))(`Control de MP · equivalencias en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let svc: typeof import("@/lib/mp-control/weekly-availability-service");
  const ids: string[] = [];
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const seed = async (descripcion: string, codigo: string, kg: number) => {
    const id = randomUUID();
    ids.push(id);
    await q("insert into inv_mp_stock (id, payload) values ($1,$2)", [id, { id, codigo, proveedor: "PROV IT", cliente: "", descripcion, cantidadKg: kg, ubicacion: "", lote: `L-${RUN}`, vencimiento: "2030-01-01", estadoStock: "", archived: false }]);
  };
  const stockSnapshot = async () => JSON.stringify(await q("select id, payload from inv_mp_stock where id = any($1) order by id", [ids]));

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    svc = await import("@/lib/mp-control/weekly-availability-service");
    await seed(GLI, `IT-GLI-${RUN}`, 500);
    await seed(PAN75, `IT-PAN75-${RUN}`, 40);
    await seed(PAN50, `IT-PAN50-${RUN}`, 25);
  }, 60_000);

  afterAll(async () => {
    await q("delete from inv_mp_stock where id = any($1)", [ids]).catch(() => undefined);
    await q("delete from mp_master_links where kind in ('name_alias','name_alias_log') and (key like '%glycerin%' or key like '%pantenol%')").catch(() => undefined);
    await pool?.end();
  });

  it("sugiere SOLO candidatos reales del Stock MP, con motivo y confianza; descarta concentración distinta", async () => {
    const syn = await svc.suggestAliases({ name: "Glycerin" });
    expect(syn.find((s) => s.descripcion.includes("GLICERINA VEGETAL"))).toMatchObject({ confidence: "MEDIA" });
    const pan = await svc.suggestAliases({ name: "Provitamina B5 50%" });
    const names = pan.map((s) => s.descripcion);
    expect(names.some((n) => n.includes("PANTENOL 50%"))).toBe(true);
    expect(names.some((n) => n.includes("D-PANTENOL 75%"))).toBe(false);
    expect(await svc.suggestAliases({ name: "Producto que no existe zzz" })).toEqual([]);
  });

  it("código exacto del inventario identifica sin tocar el nombre", async () => {
    const r = await svc.suggestAliases({ name: "Nombre comercial raro", code: `it-gli-${RUN}` });
    expect(r[0]).toMatchObject({ confidence: "ALTA" });
    expect(r[0]!.descripcion).toContain("GLICERINA VEGETAL");
  });

  it("confirmar: guarda quién, cuándo y la denominación original; se recuerda; NO modifica stock; desactivar deja historial", async () => {
    const before = await stockSnapshot();
    const syn = await svc.suggestAliases({ name: "Glycerin" });
    const target = syn.find((s) => s.descripcion.includes("GLICERINA VEGETAL"))!;
    await svc.approveNameAlias({ formulaName: "Glycerin", stockName: target.stockName, by: "mp-it@laboratoriogenus.com.ar", original: "Glycerin", code: "G-1" });
    const conf = await svc.listConfirmedAliases("Glycerin");
    expect(conf).toHaveLength(1);
    expect(conf[0]).toMatchObject({ stockName: target.stockName, by: "mp-it@laboratoriogenus.com.ar", original: "Glycerin" });
    expect(conf[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Se recuerda para futuros controles y ya no se vuelve a sugerir.
    expect((await svc.loadNameAliases()).some((a) => a.formulaName === "glycerin" && a.stockName === target.stockName)).toBe(true);
    expect((await svc.suggestAliases({ name: "Glycerin" })).some((s) => s.stockName === target.stockName)).toBe(false);
    // Idempotente.
    await svc.approveNameAlias({ formulaName: "Glycerin", stockName: target.stockName, by: "otro@laboratoriogenus.com.ar", original: "Glycerin" });
    expect(await svc.listConfirmedAliases("Glycerin")).toHaveLength(1);
    // Corregir / desactivar.
    await svc.removeNameAlias({ formulaName: "Glycerin", stockName: target.stockName, by: "mp-it@laboratoriogenus.com.ar" });
    expect(await svc.listConfirmedAliases("Glycerin")).toHaveLength(0);
    const log = await q("select approved_by, note from mp_master_links where kind = 'name_alias_log' and master_code = $1 order by approved_at", [target.stockName]);
    expect(log.map((l) => JSON.parse(String(l.note)).action)).toEqual(["confirmó", "desactivó"]);
    // Ni stock ni fórmulas cambiaron.
    expect(await stockSnapshot()).toBe(before);
  });

  it("rechaza confirmar una equivalencia que contradice la concentración (materiales distintos)", async () => {
    const stockName = (await svc.suggestAliases({ name: "Pantenol 50%" })).find((s) => s.descripcion.includes("50%"))!.stockName;
    await expect(svc.approveNameAlias({ formulaName: "Pantenol 75%", stockName, by: "x@laboratoriogenus.com.ar", original: "Pantenol 75%" })).rejects.toThrow(/concentración distinta/);
    expect(await svc.listConfirmedAliases("Pantenol 75%")).toHaveLength(0);
    await expect(svc.approveNameAlias({ formulaName: "Algo", stockName: "no existe en stock", by: "x@laboratoriogenus.com.ar" })).rejects.toThrow(/no existe/);
  });
});
