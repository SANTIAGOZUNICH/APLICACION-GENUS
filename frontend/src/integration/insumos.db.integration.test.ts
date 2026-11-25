/**
 * Módulo INSUMOS contra un Postgres de PRUEBA real (migración 0088): siembra, retiro de uno y varios insumos,
 * responsables por sector (y rechazo de responsables de otro sector en el backend), doble envío / reintento / carrera sin duplicados,
 * reportes y filtros, anulación y corrección auditadas, catálogo editable y RBAC por sector.
 * Se corre con `npm run test:e2e:insumos-db` (levanta un Postgres descartable; nunca usa la base real).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import { aggregateRetiros, filterRetiros, retirosToRows } from "@/lib/insumos/insumos-reports";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const MARK = `IT-INS-${RUN}`;
const actor = (sector: string, tag = sector.toLowerCase()) => ({ email: `it-ins-${tag}-${RUN}@laboratoriogenus.com.ar`, sector: sector as never, displayName: `${MARK}-${tag}` });
const masivo = actor("ENVASADO_MASIVO");
const codificado = actor("CODIFICADO");
const mp = actor("MATERIA_PRIMA");
const admin = actor("ADMINISTRACION");
const direccion = actor("DIRECCION");
const deposito = actor("DEPOSITO");
const produccion = actor("PRODUCCION");
const key = () => `ins-${randomUUID()}`;

describe.skipIf(Boolean(PROBLEM))(`Insumos en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => import("@/lib/insumos/insumos-service");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 90_000);

  afterAll(async () => {
    const ids = "select id from insumo_retiros where registrado_por_name like $1";
    await q(`delete from insumo_stock_movements where retiro_id in (${ids}) or insumo_id in (select id from insumo_items where created_by like $2)`, [`${MARK}%`, `it-ins-%-${RUN}@%`]).catch(() => undefined);
    await q("delete from insumo_stock_audit where actor_email like $1", [`it-ins-%-${RUN}@%`]).catch(() => undefined);
    await q(`delete from insumo_retiro_events where retiro_id in (${ids})`, [`${MARK}%`]).catch(() => undefined);
    await q(`delete from insumo_retiro_items where retiro_id in (${ids})`, [`${MARK}%`]).catch(() => undefined);
    await q("delete from insumo_retiros where registrado_por_name like $1", [`${MARK}%`]).catch(() => undefined);
    await q("delete from insumo_items where created_by like $1", [`it-ins-%-${RUN}@%`]).catch(() => undefined);
    await q("delete from insumo_responsables where created_by like $1", [`it-ins-%-${RUN}@%`]).catch(() => undefined);
    await pool?.end();
  });

  const respId = async (sector: string, name: string) => {
    const rows = await q("select id from insumo_responsables where sector = $1 and name = $2", [sector, name]);
    return rows[0]!.id as string;
  };

  it("la migración sembró los 6 insumos y los 13 responsables con ids estables (FILM ≠ STRETCH FILM)", async () => {
    const items = await q("select id, name from insumo_items where id in ('papel-higienico','bobina-de-papel','guantes','cinta','film','stretch-film') order by sort_order");
    expect(items.map((i) => i.name)).toEqual(["PAPEL HIGIENICO", "BOBINA DE PAPEL", "GUANTES", "CINTA", "FILM", "STRETCH FILM"]);
    const resp = await q("select sector, name from insumo_responsables where id not like 'it-%' order by sector, sort_order");
    const bySector = (s: string) => resp.filter((r) => r.sector === s).map((r) => r.name);
    expect(bySector("ENVASADO_MASIVO")).toEqual(["GABO", "NICO Y", "NICO M", "AGUS"]);
    expect(bySector("ENVASADO_PREMIUM")).toEqual(["JOAQUIN", "BELEN"]);
    expect(bySector("CODIFICADO")).toEqual(["JULIAN", "GABO"]);
    expect(bySector("ELABORACION")).toEqual(["SANTINO", "NICOLAS", "CRISTIAN"]);
    expect(bySector("MATERIA_PRIMA")).toEqual(["VALENTIN", "SANTINO"]);
    // «GABO» y «SANTINO» existen en dos sectores: registros (ids) distintos.
    expect(await respId("ENVASADO_MASIVO", "GABO")).not.toBe(await respId("CODIFICADO", "GABO"));
    expect(await respId("ELABORACION", "SANTINO")).not.toBe(await respId("MATERIA_PRIMA", "SANTINO"));
  });

  it("la siembra es idempotente: volver a correrla no pisa ediciones ni duplica", async () => {
    const before = await q("select count(*)::int n from insumo_items");
    await q(`INSERT INTO "insumo_items" ("id", "name", "sort_order") VALUES ('guantes', 'OTRO', 99), ('film', 'FILM', 5) ON CONFLICT DO NOTHING`);
    const after = await q("select count(*)::int n from insumo_items");
    expect(after[0]!.n).toBe(before[0]!.n);
    expect((await q("select name from insumo_items where id = 'guantes'"))[0]!.name).toBe("GUANTES");
  });

  it("el catálogo de cada sector muestra SOLO sus responsables", async () => {
    const s = await svc();
    const cm = await s.getCatalog(masivo);
    expect(cm.registrationSector).toBe("ENVASADO_MASIVO");
    expect(cm.responsables.map((r) => r.name)).toEqual(["GABO", "NICO Y", "NICO M", "AGUS"]);
    expect(cm.items.map((i) => i.name)).toEqual(expect.arrayContaining(["FILM", "STRETCH FILM"]));
    const cc = await s.getCatalog(codificado);
    expect(cc.responsables.map((r) => r.name)).toEqual(["JULIAN", "GABO"]);
    const cmp = await s.getCatalog(mp);
    expect(cmp.responsables.map((r) => r.name)).toEqual(["VALENTIN", "SANTINO"]);
  });

  it("registra un retiro de UN insumo: persiste con snapshot, usuario que registra y fecha automática", async () => {
    const s = await svc();
    const { retiro, created } = await s.createRetiro(masivo, { clientRequestId: key(), responsableId: await respId("ENVASADO_MASIVO", "NICO Y"), lines: [{ insumoId: "guantes", cantidad: 3 }] });
    expect(created).toBe(true);
    expect(retiro).toMatchObject({ sector: "ENVASADO_MASIVO", responsableName: "NICO Y", status: "ACTIVO", registradoPorEmail: masivo.email, registradoPorName: masivo.displayName });
    expect(retiro.lines).toEqual([{ insumoId: "guantes", insumoName: "GUANTES", cantidad: 3 }]);
    expect(Date.now() - new Date(retiro.createdAt).getTime()).toBeLessThan(60_000);
    const ev = await s.listRetiroEvents(admin, retiro.id);
    expect(ev.map((e) => e.action)).toEqual(["CREADO"]);
    expect(ev[0]).toMatchObject({ actorEmail: masivo.email, before: null });
  });

  it("registra un retiro de VARIOS insumos en una sola operación (renglones en 0 no se guardan)", async () => {
    const s = await svc();
    const { retiro } = await s.createRetiro(codificado, {
      clientRequestId: key(),
      responsableId: await respId("CODIFICADO", "JULIAN"),
      lines: [{ insumoId: "film", cantidad: 2 }, { insumoId: "stretch-film", cantidad: 1 }, { insumoId: "cinta", cantidad: 0 }, { insumoId: "papel-higienico", cantidad: 6 }],
    });
    expect(retiro.lines.map((l) => [l.insumoName, l.cantidad])).toEqual([["FILM", 2], ["PAPEL HIGIENICO", 6], ["STRETCH FILM", 1]]);
    const rows = await q("select cantidad from insumo_retiro_items where retiro_id = $1", [retiro.id]);
    expect(rows).toHaveLength(3);
  });

  it("rechaza (backend) un responsable de OTRO sector, aunque tenga el mismo nombre", async () => {
    const s = await svc();
    // GABO de Codificado no puede registrar para Envasado Masivo y viceversa.
    await expect(s.createRetiro(masivo, { clientRequestId: key(), responsableId: await respId("CODIFICADO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/no pertenece a tu sector/);
    await expect(s.createRetiro(codificado, { clientRequestId: key(), responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/no pertenece a tu sector/);
    await expect(s.createRetiro(mp, { clientRequestId: key(), responsableId: await respId("ELABORACION", "SANTINO"), lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/no pertenece a tu sector/);
    await expect(s.createRetiro(masivo, { clientRequestId: key(), responsableId: "no-existe", lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/no existe/);
    expect((await q("select count(*)::int n from insumo_retiros where registrado_por_name like $1 and sector = 'ENVASADO_MASIVO' and responsable_id = 'codificado-gabo'", [`${MARK}%`]))[0]!.n).toBe(0);
  });

  it("valida cantidades en el backend (negativas, decimales, todo en 0, insumo inexistente)", async () => {
    const s = await svc();
    const r = await respId("ENVASADO_MASIVO", "AGUS");
    const bad = (lines: unknown) => s.createRetiro(masivo, { clientRequestId: key(), responsableId: r, lines: lines as never });
    await expect(bad([{ insumoId: "guantes", cantidad: -1 }])).rejects.toThrow();
    await expect(bad([{ insumoId: "guantes", cantidad: 1.5 }])).rejects.toThrow();
    await expect(bad([{ insumoId: "guantes", cantidad: 0 }])).rejects.toThrow(/al menos un insumo/);
    await expect(bad([{ insumoId: "inventado", cantidad: 1 }])).rejects.toThrow(/no existe en el catálogo/);
    await expect(s.createRetiro(masivo, { clientRequestId: "corta", responsableId: r, lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/clave/);
  });

  it("reintento y doble toque con la MISMA clave: un solo retiro; la carrera también", async () => {
    const s = await svc();
    const k = key();
    const input = { clientRequestId: k, responsableId: await respId("ENVASADO_PREMIUM", "BELEN"), lines: [{ insumoId: "cinta", cantidad: 4 }] };
    const prem = actor("ENVASADO_PREMIUM");
    const first = await s.createRetiro(prem, input);
    const retry = await s.createRetiro(prem, input);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.retiro.id).toBe(first.retiro.id);
    const k2 = key();
    const race = await Promise.all([1, 2, 3, 4].map(() => s.createRetiro(prem, { ...input, clientRequestId: k2 }).catch((e) => e)));
    expect(race.filter((r) => r instanceof Error)).toHaveLength(0);
    expect(new Set(race.map((r) => (r as { retiro: { id: string } }).retiro.id)).size).toBe(1);
    expect(race.filter((r) => (r as { created: boolean }).created)).toHaveLength(1);
    expect((await q("select count(*)::int n from insumo_retiros where client_request_id = any($1)", [[k, k2]]))[0]!.n).toBe(2);
    expect((await q("select count(*)::int n from insumo_retiro_items where retiro_id = $1", [first.retiro.id]))[0]!.n).toBe(1);
    expect((await q("select count(*)::int n from insumo_retiro_events where retiro_id = $1", [first.retiro.id]))[0]!.n).toBe(1);
  });

  it("una clave ya usada por OTRO usuario no devuelve su retiro", async () => {
    const s = await svc();
    const k = key();
    await s.createRetiro(masivo, { clientRequestId: k, responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }] });
    await expect(s.createRetiro(actor("ENVASADO_MASIVO", "otro"), { clientRequestId: k, responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/otro registro/);
  });

  it("el retiro y sus renglones son atómicos: si un renglón falla no queda nada", async () => {
    const s = await svc();
    const k = key();
    await expect(s.createRetiro(masivo, { clientRequestId: k, responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }, { insumoId: "inventado", cantidad: 1 }] })).rejects.toThrow();
    expect((await q("select count(*)::int n from insumo_retiros where client_request_id = $1", [k]))[0]!.n).toBe(0);
  });

  it("RBAC por sector: Depósito, Producción, Administración y Dirección NO registran; los operativos no consultan reportes ni administran", async () => {
    const s = await svc();
    const input = { clientRequestId: key(), responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 1 }] };
    for (const a of [deposito, produccion, admin, direccion]) await expect(s.createRetiro(a, { ...input, clientRequestId: key() })).rejects.toThrow(/no registra/);
    await expect(s.listRetiros(masivo)).rejects.toThrow(/Solo Administración y Dirección/);
    await expect(s.listRetiros(deposito)).rejects.toThrow(/Solo Administración y Dirección/);
    await expect(s.createInsumoItem(masivo, { name: "X" })).rejects.toThrow(/Solo Administración/);
    await expect(s.createResponsable(codificado, { sector: "CODIFICADO", name: "X" })).rejects.toThrow(/Solo Administración/);
    await expect(s.getCatalog(deposito)).rejects.toThrow(/acceso/);
    await expect(s.anularRetiro(masivo, randomUUID(), "motivo")).rejects.toThrow(/Solo Administración/);
    await expect(s.listRetiros(admin)).resolves.toBeTruthy();
    await expect(s.listRetiros(direccion)).resolves.toBeTruthy();
  });

  it("reportes: historial con filtros (sector, responsable, insumo, fechas) y agregaciones consistentes con la base", async () => {
    const s = await svc();
    const { retiros } = await s.listRetiros(admin, { sector: "CODIFICADO" });
    const mine = retiros.filter((r) => r.registradoPorName.startsWith(MARK));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.sector === "CODIFICADO")).toBe(true);
    const julian = await s.listRetiros(admin, { responsableId: await respId("CODIFICADO", "JULIAN") });
    expect(julian.retiros.filter((r) => r.registradoPorName.startsWith(MARK)).length).toBeGreaterThan(0);
    const stretch = await s.listRetiros(admin, { insumoId: "stretch-film" });
    expect(stretch.retiros.every((r) => r.lines.some((l) => l.insumoId === "stretch-film"))).toBe(true);
    const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const day = await s.listRetiros(admin, { from: today, to: today });
    expect(day.retiros.filter((r) => r.registradoPorName.startsWith(MARK)).length).toBeGreaterThan(0);
    const past = await s.listRetiros(admin, { from: "2000-01-01", to: "2000-01-02" });
    expect(past.retiros).toHaveLength(0);
    await expect(s.listRetiros(admin, { from: "no-es-fecha" })).rejects.toThrow(/no es válida/);
    // El filtrado SQL y el puro coinciden.
    const all = (await s.listRetiros(admin, {})).retiros;
    expect(filterRetiros(all, { sector: "CODIFICADO" }).map((r) => r.id).sort()).toEqual(retiros.map((r) => r.id).sort());
    const agg = aggregateRetiros(all, { sector: "CODIFICADO" });
    expect(agg.unidades).toBe(retiros.filter((r) => r.status === "ACTIVO").reduce((n, r) => n + r.lines.reduce((m, l) => m + l.cantidad, 0), 0));
    expect(retirosToRows(all, { insumoId: "stretch-film" }).every((r) => r[4] === "STRETCH FILM")).toBe(true);
  });

  it("anular: motivo obligatorio, auditoría con antes/después, sin borrar, y excluido de los totales pero visible en el historial", async () => {
    const s = await svc();
    const { retiro } = await s.createRetiro(mp, { clientRequestId: key(), responsableId: await respId("MATERIA_PRIMA", "VALENTIN"), lines: [{ insumoId: "bobina-de-papel", cantidad: 7 }] });
    await expect(s.anularRetiro(admin, retiro.id, "")).rejects.toThrow(/motivo/);
    const before = aggregateRetiros((await s.listRetiros(admin, { sector: "MATERIA_PRIMA" })).retiros, { sector: "MATERIA_PRIMA", insumoId: "bobina-de-papel" });
    const anulado = await s.anularRetiro(direccion, retiro.id, "Se cargó dos veces");
    expect(anulado).toMatchObject({ status: "ANULADO", anuladoBy: direccion.email, anuladoMotivo: "Se cargó dos veces" });
    expect(anulado.anuladoAt).toBeTruthy();
    const again = await s.anularRetiro(admin, retiro.id, "otra vez");
    expect(again.anuladoMotivo).toBe("Se cargó dos veces"); // idempotente
    const ev = await s.listRetiroEvents(admin, retiro.id);
    expect(ev.map((e) => e.action)).toEqual(["CREADO", "ANULADO"]);
    expect(ev[1]).toMatchObject({ actorEmail: direccion.email, motivo: "Se cargó dos veces", before: { status: "ACTIVO" }, after: { status: "ANULADO" } });
    expect((await q("select count(*)::int n from insumo_retiros where id = $1", [retiro.id]))[0]!.n).toBe(1);
    const list = (await s.listRetiros(admin, { sector: "MATERIA_PRIMA" })).retiros;
    expect(list.find((r) => r.id === retiro.id)?.status).toBe("ANULADO");
    const after = aggregateRetiros(list, { sector: "MATERIA_PRIMA", insumoId: "bobina-de-papel" });
    expect(after.unidades).toBe(before.unidades - 7);
    await expect(s.correctRetiro(admin, retiro.id, { motivo: "x ok", lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/anulado/);
  });

  it("corregir: cambia cantidades/insumos/responsable con motivo y auditoría; el renglón quitado queda en 0 (sin borrados)", async () => {
    const s = await svc();
    const { retiro } = await s.createRetiro(masivo, { clientRequestId: key(), responsableId: await respId("ENVASADO_MASIVO", "GABO"), lines: [{ insumoId: "guantes", cantidad: 2 }, { insumoId: "film", cantidad: 5 }] });
    await expect(s.correctRetiro(admin, retiro.id, { motivo: "", lines: [{ insumoId: "guantes", cantidad: 3 }] })).rejects.toThrow(/motivo/);
    await expect(s.correctRetiro(admin, retiro.id, { motivo: "Cambio de responsable", responsableId: await respId("CODIFICADO", "JULIAN") })).rejects.toThrow(/pertenecer al sector/);
    await expect(s.correctRetiro(admin, retiro.id, { motivo: "Sin cambios" })).rejects.toThrow(/No hay cambios/);
    const fixed = await s.correctRetiro(admin, retiro.id, { motivo: "Se contó mal", responsableId: await respId("ENVASADO_MASIVO", "AGUS"), lines: [{ insumoId: "guantes", cantidad: 4 }, { insumoId: "cinta", cantidad: 1 }] });
    expect(fixed.responsableName).toBe("AGUS");
    expect(fixed.lines.map((l) => [l.insumoName, l.cantidad])).toEqual([["CINTA", 1], ["GUANTES", 4]]);
    expect(fixed.registradoPorEmail).toBe(masivo.email); // quien registró no cambia
    const raw = await q("select insumo_id, cantidad from insumo_retiro_items where retiro_id = $1 order by insumo_id", [retiro.id]);
    expect(raw).toEqual([{ insumo_id: "cinta", cantidad: 1 }, { insumo_id: "film", cantidad: 0 }, { insumo_id: "guantes", cantidad: 4 }]);
    const ev = await s.listRetiroEvents(admin, retiro.id);
    expect(ev.map((e) => e.action)).toEqual(["CREADO", "CORREGIDO"]);
    expect(ev[1]).toMatchObject({ actorEmail: admin.email, motivo: "Se contó mal", before: { responsableName: "GABO" }, after: { responsableName: "AGUS" } });
    expect(ev[1]!.before!.lines.map((l) => l.cantidad).sort()).toEqual([2, 5]);
    expect(ev[1]!.after!.lines.map((l) => l.cantidad).sort()).toEqual([1, 4]);
    const sector = (await s.listRetiros(admin, { sector: "ENVASADO_MASIVO" })).retiros.find((r) => r.id === retiro.id)!;
    expect(sector.sector).toBe("ENVASADO_MASIVO"); // el sector no se corrige
  });

  it("catálogo editable sin tocar código: alta, edición, baja lógica, orden; los retiros viejos conservan el nombre", async () => {
    const s = await svc();
    const it = await s.createInsumoItem(admin, { name: `  bolsa ${RUN} ` });
    expect(it).toMatchObject({ name: `BOLSA ${RUN}`, active: true });
    await expect(s.createInsumoItem(admin, { name: `BOLSA ${RUN}` })).rejects.toThrow(/Ya existe/);
    await expect(s.createInsumoItem(admin, { name: "stretch film" })).rejects.toThrow(/Ya existe/);
    const resp = await s.createResponsable(direccion, { sector: "ELABORACION", name: `tester ${RUN}` });
    expect(resp).toMatchObject({ sector: "ELABORACION", name: `TESTER ${RUN}`, active: true });
    await expect(s.createResponsable(admin, { sector: "ELABORACION", name: `TESTER ${RUN}` })).rejects.toThrow(/Ya existe/);
    await expect(s.createResponsable(admin, { sector: "DEPOSITO", name: "X" })).rejects.toThrow(/sector operativo/);
    // Aparecen para el sector correcto.
    const elab = actor("ELABORACION");
    expect((await s.getCatalog(elab)).responsables.map((r) => r.name)).toContain(`TESTER ${RUN}`);
    expect((await s.getCatalog(masivo)).responsables.map((r) => r.name)).not.toContain(`TESTER ${RUN}`);
    const { retiro } = await s.createRetiro(elab, { clientRequestId: key(), responsableId: resp.id, lines: [{ insumoId: it.id, cantidad: 2 }] });
    // Renombrar el insumo y el responsable no cambia el historial (snapshot).
    await s.updateInsumoItem(admin, it.id, { name: `BOLSA NUEVA ${RUN}` });
    await s.updateResponsable(admin, resp.id, { name: `OTRO ${RUN}` });
    const hist = (await s.listRetiros(admin, { sector: "ELABORACION" })).retiros.find((r) => r.id === retiro.id)!;
    expect(hist.lines[0]!.insumoName).toBe(`BOLSA ${RUN}`);
    expect(hist.responsableName).toBe(`TESTER ${RUN}`);
    // Baja lógica: ya no se ofrece ni se puede elegir; el historial sigue.
    await s.updateInsumoItem(admin, it.id, { active: false });
    await s.updateResponsable(admin, resp.id, { active: false });
    const cat = await s.getCatalog(elab);
    expect(cat.items.map((i) => i.id)).not.toContain(it.id);
    expect(cat.responsables.map((r) => r.id)).not.toContain(resp.id);
    await expect(s.createRetiro(elab, { clientRequestId: key(), responsableId: resp.id, lines: [{ insumoId: "guantes", cantidad: 1 }] })).rejects.toThrow(/baja/);
    await expect(s.createRetiro(elab, { clientRequestId: key(), responsableId: await respId("ELABORACION", "CRISTIAN"), lines: [{ insumoId: it.id, cantidad: 1 }] })).rejects.toThrow(/baja/);
    const all = await s.getCatalog(admin, { all: true });
    expect(all.items.find((i) => i.id === it.id)?.active).toBe(false);
    // Orden.
    const base = (await s.getCatalog(admin, { all: true })).items.filter((i) => ["guantes", "film"].includes(i.id)).map((i) => i.id);
    const reordered = await s.reorderInsumoItems(admin, [...base].reverse());
    expect(reordered.findIndex((i) => i.id === "film")).toBeLessThan(reordered.findIndex((i) => i.id === "guantes"));
    await s.reorderInsumoItems(admin, base); // se deja como estaba
  });
});
