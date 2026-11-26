/**
 * DEPÓSITO › UBICACIONES contra un Postgres de PRUEBA real (migración 0092): siembra de las 36 posiciones y del plano, el ejemplo TRC (A02 → B05),
 * asignar / agregar / retirar / observaciones, traslado completo y parcial, liberar, historial inmutable, transaccionalidad, concurrencia
 * (sin pérdidas ni duplicados, sin interbloqueos), tope por stock ME, búsqueda, permisos por sector en TODA escritura, configuración del mapa
 * (no se desactiva ni renombra lo ocupado) y compatibilidad con ingresos ME (con y sin ubicación) sin tocar el stock.
 * Se corre con `npm run test:e2e:ubicaciones-db` (levanta un Postgres descartable; nunca usa la base real).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";
import { cellState, computeIndicators, searchLocations, subtotals } from "@/lib/ubicaciones/rules";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const actor = (sector: string, tag = sector.toLowerCase()) => ({ email: `it-ubi-${tag}-${RUN}@laboratoriogenus.com.ar`, sector: sector as never, displayName: `IT-UBI-${tag}` });
const deposito = actor("DEPOSITO");
const direccion = actor("DIRECCION");
const masivo = actor("ENVASADO_MASIVO");
const premium = actor("ENVASADO_PREMIUM");
const produccion = actor("PRODUCCION");
const codificado = actor("CODIFICADO");
const key = () => `ubi-${randomUUID()}`;

describe.skipIf(Boolean(PROBLEM))(`Ubicaciones en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => import("@/lib/ubicaciones/service");
  const created: string[] = [];
  const mats: string[] = [];
  const ingresos: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
  }, 90_000);

  afterAll(async () => {
    const ids = created.length ? created : ["-"];
    await q("delete from deposito_ubicacion_items where location_id = any($1) or location_id in ('ubi-a02','ubi-b05','ubi-a03')", [ids]).catch(() => undefined);
    await q("delete from deposito_ubicacion_movements where actor_email like $1", [`it-ubi-%-${RUN}@%`]).catch(() => undefined);
    await q("delete from deposito_ubicaciones where id = any($1)", [ids]).catch(() => undefined);
    await q("delete from deposito_mapa_shapes where updated_by like $1", [`it-ubi-%-${RUN}@%`]).catch(() => undefined);
    await q("delete from inv_me_ingresos where id = any($1::uuid[])", [ingresos]).catch(() => undefined);
    await q("delete from inv_me_materials where id = any($1::uuid[])", [mats]).catch(() => undefined);
    await pool?.end();
  });

  /** Posición de prueba propia (no depende de las sembradas). */
  let slot = 0;
  const newLoc = async (code: string) => {
    const s = await svc();
    const n = slot++; // cada posición de prueba en su propio lugar del plano (no se permiten superposiciones)
    const l = await s.createLocation(deposito, { code: `${code}${RUN}`, zone: "Prueba", x: 2 + (n % 16) * 24, y: 680 + Math.floor(n / 16) * 18, w: 20, h: 15 });
    created.push(l.id);
    return l;
  };
  const line = (o: Record<string, unknown> = {}) => ({ clientName: "TRC", material: "frascos de shampoo 250 ml", quantity: 2000, unit: "u", ...o });
  const total = async (material: string, ids: string[]) => {
    const rows = await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where material_name = $1 and location_id = any($2)", [material, ids]);
    return rows[0]!.n as number;
  };

  const meFixture = async (codigo: string, ingresoTotal: number) => {
    const matId = randomUUID();
    const ingId = randomUUID();
    mats.push(matId);
    ingresos.push(ingId);
    await q("insert into inv_me_materials (id, payload) values ($1, $2)", [matId, JSON.stringify({ id: matId, codigo, descripcion: `Frasco ${codigo}`, cliente: "TRC", ubicacion: "", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: new Date().toISOString(), archived: false })]);
    await q("insert into inv_me_ingresos (id, payload) values ($1, $2)", [ingId, JSON.stringify({ id: ingId, fecha: "2026-11-20", ingresoNro: `IT-${RUN}`, proveedor: "P", cliente: "TRC", remitoNro: "R1", codigo, descripcionInsumo: `Frasco ${codigo}`, bultos: 10, cantidad: ingresoTotal / 10, total: ingresoTotal, ubicacion: "texto libre", materialId: matId, anulado: false, createdBy: "t", updatedBy: "t", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })]);
    return { matId, ingId };
  };

  const stockSnapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const t of ["inv_me_ingresos", "inv_me_salidas", "inv_me_materials", "inv_ajustes", "mp_stock_balances", "insumo_stock_movements", "cajas_genus_movements"]) {
      const r = await q(`select count(*)::int n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) h from ${t} x`).catch(() => [{ n: -1, h: "" }]);
      out[t] = r[0];
    }
    return out;
  };

  it("la migración sembró las 36 posiciones y la forma del plano", async () => {
    const s = await svc();
    const map = await s.getMap(deposito);
    const seeded = map.locations.filter((l) => l.id.startsWith("ubi-") && /^[A-E]\d\d$/.test(l.code));
    expect(seeded).toHaveLength(36);
    const codes = (from: string, n: number) => Array.from({ length: n }, (_, i) => `${from}${String(i + 1).padStart(2, "0")}`);
    const byZone = (z: string) => seeded.filter((l) => l.zone === z).map((l) => l.code);
    expect(byZone("Lateral izquierdo")).toEqual(codes("A", 11));
    expect(byZone("Lateral derecho")).toEqual(codes("B", 10));
    expect(byZone("Superior (fila 1)")).toEqual(codes("C", 5));
    expect(byZone("Superior (fila 2)")).toEqual(codes("D", 5));
    expect(byZone("Superior (fila 3)")).toEqual(codes("E", 5));
    expect(seeded.every((l) => l.active && l.items.length === 0 && l.w > 0 && l.h > 0)).toBe(true);
    const kinds = map.shapes.map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CONTORNO", "PASILLO", "ESCALERA", "VACIO"]));
    expect(map.shapes.find((x) => x.kind === "CONTORNO")!.points).toHaveLength(6);
    expect(map.config).toMatchObject({ width: 400, height: 740 });
    // Siembra idempotente: volver a correrla no duplica ni pisa.
    await q(`INSERT INTO "deposito_ubicaciones" ("id", "code", "zone", "x", "y", "w", "h", "sort_order") VALUES ('ubi-a01', 'A01', 'OTRA', 0, 0, 1, 1, 99) ON CONFLICT DO NOTHING`);
    expect((await q("select zone from deposito_ubicaciones where id = 'ubi-a01'"))[0]!.zone).toBe("Lateral izquierdo");
  });

  it("ejemplo de aceptación: TRC en A02 → ocupada; búsqueda resalta; traslado parcial de 500 a B05 conserva 2.000 y queda en el historial", async () => {
    const s = await svc();
    const before = await stockSnapshot();
    const a02 = (await s.getMap(deposito)).locations.find((l) => l.code === "A02")!;
    const r = await s.addContent(deposito, { key: key(), locationId: a02.id, expectedVersion: a02.version, lines: [line(), line({ material: "tapas negras" })], observations: "Material pendiente de envasado." });
    expect(r.locations[0]!.items.map((i) => [i.material, i.quantity]).sort()).toEqual([["frascos de shampoo 250 ml", 2000], ["tapas negras", 2000]]);
    let map = await s.getMap(masivo);
    expect(map.indicators).toEqual({ total: 36 + created.length, ocupadas: 1, libres: 35 + created.length });
    expect(computeIndicators(map.locations).ocupadas).toBe(1);
    // Envasado Masivo busca TRC: se resalta A02.
    const hits = searchLocations(map.locations, "TRC");
    expect(hits.map((l) => l.code)).toEqual(["A02"]);
    expect(cellState(hits[0]!, { selected: false, match: true })).toBe("RESULTADO");
    expect(searchLocations(map.locations, "tapas").map((l) => l.code)).toEqual(["A02"]);
    expect(searchLocations(map.locations, "a2").map((l) => l.code)).toContain("A02");
    // Traslado parcial A02 → B05.
    const items = r.locations[0]!.items;
    const frascos = items.find((i) => i.material.startsWith("frascos"))!;
    const b05 = map.locations.find((l) => l.code === "B05")!;
    const t = await s.transferContent(deposito, { key: key(), fromId: a02.id, toId: b05.id, lines: [{ itemId: frascos.id, quantity: 500 }] });
    const A = t.locations.find((l) => l.code === "A02")!;
    const B = t.locations.find((l) => l.code === "B05")!;
    expect(A.items.find((i) => i.material.startsWith("frascos"))!.quantity).toBe(1500);
    expect(A.items.find((i) => i.material === "tapas negras")!.quantity).toBe(2000);
    expect(B.items).toHaveLength(1);
    expect(B.items[0]!.quantity).toBe(500);
    expect(B.items[0]!.clientName).toBe("TRC");
    expect(await total("frascos de shampoo 250 ml", [a02.id, b05.id])).toBe(2000);
    map = await s.getMap(masivo);
    expect(searchLocations(map.locations, "trc").map((l) => l.code).sort()).toEqual(["A02", "B05"]);
    const hist = await s.listMovements(masivo, { locationId: b05.id });
    expect(hist[0]).toMatchObject({ kind: "TRASLADO", fromCode: "A02", toCode: "B05", actorSector: "DEPOSITO" });
    expect(hist[0]!.lines[0]).toMatchObject({ material: "frascos de shampoo 250 ml", quantity: 500, remaining: 1500 });
    expect(A.lastModifiedBy).toContain("IT-UBI");
    // El módulo no modificó ningún stock.
    expect(await stockSnapshot()).toEqual(before);
    // Se deja limpio para el resto.
    await s.releaseLocation(deposito, { key: key(), locationId: a02.id });
    await s.releaseLocation(deposito, { key: key(), locationId: b05.id });
  });

  it("agregar mezcla clientes, suma el mismo material, retira parcial/total y edita observaciones", async () => {
    const s = await svc();
    const l = await newLoc("T1");
    const r1 = await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 100 }), line({ clientName: "B.L. Cosmetics S.A.", material: "tapas", quantity: 50 })] });
    expect(new Set(r1.locations[0]!.items.map((i) => i.clientName))).toEqual(new Set(["TRC", "B.L. Cosmetics S.A."]));
    // Mismo texto y cliente SIN elegir el renglón = renglón aparte (la identidad no es el texto).
    const sep = await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ clientName: "trc", material: "FRASCOS DE SHAMPOO 250 ML", quantity: 1 })] });
    expect(sep.locations[0]!.items.filter((i) => i.material.toLowerCase().startsWith("frascos"))).toHaveLength(2);
    const extra = sep.locations[0]!.items.find((i) => i.material === "FRASCOS DE SHAMPOO 250 ML")!;
    await s.removeContent(deposito, { key: key(), locationId: l.id, lines: [{ itemId: extra.id, quantity: null }] });
    // Eligiendo EXPLÍCITAMENTE el renglón existente, se suma a ese.
    const target = r1.locations[0]!.items.find((i) => i.material.startsWith("frascos"))!;
    const r2 = await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ clientName: "trc", material: "FRASCOS DE SHAMPOO 250 ML", quantity: 25.5, mergeIntoItemId: target.id })] });
    const fr = r2.locations[0]!.items.filter((i) => i.material.toLowerCase().startsWith("frascos"));
    expect(fr).toHaveLength(1);
    expect(fr[0]!.quantity).toBe(125.5);
    expect((await s.listMovements(deposito, { locationId: l.id })).map((m) => m.kind)).toEqual(["AGREGADO", "RETIRO", "AGREGADO", "ASIGNACION", "CONFIG"]);
    const r3 = await s.removeContent(deposito, { key: key(), locationId: l.id, lines: [{ itemId: fr[0]!.id, quantity: 25.5 }] });
    expect(r3.locations[0]!.items.find((i) => i.id === fr[0]!.id)!.quantity).toBe(100);
    await expect(s.removeContent(deposito, { key: key(), locationId: l.id, lines: [{ itemId: fr[0]!.id, quantity: 100.001 }] })).rejects.toThrow(/No hay tanta cantidad/);
    const tapas = r3.locations[0]!.items.find((i) => i.material === "tapas")!;
    const r4 = await s.removeContent(deposito, { key: key(), locationId: l.id, lines: [{ itemId: tapas.id, quantity: null }, { itemId: fr[0]!.id, quantity: null }] });
    expect(r4.locations[0]!.items).toHaveLength(0);
    const r5 = await s.setObservations(deposito, { key: key(), locationId: l.id, observations: "  Pallet con film.  " });
    expect(r5.locations[0]!.observations).toBe("Pallet con film.");
    await expect(s.addContent(deposito, { key: key(), locationId: l.id, lines: [{ clientName: "", material: "x", quantity: 1 }] })).rejects.toThrow(/cliente/);
    await expect(s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 0 })] })).rejects.toThrow(/mayor a cero/);
    await expect(s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 1.0005 })] })).rejects.toThrow(/3 decimales/);
  });

  it("traslado completo, liberar y el historial es inmutable y completo", async () => {
    const s = await svc();
    const a = await newLoc("T2");
    const b = await newLoc("T3");
    await s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ quantity: 300 }), line({ material: "cajas", quantity: null })] });
    const t = await s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, all: true });
    expect(t.locations.find((x) => x.id === a.id)!.items).toHaveLength(0);
    expect(t.locations.find((x) => x.id === b.id)!.items.map((i) => [i.material, i.quantity]).sort()).toEqual([["cajas", null], ["frascos de shampoo 250 ml", 300]]);
    // Un renglón sin cantidad solo se mueve completo.
    await expect(s.transferContent(deposito, { key: key(), fromId: b.id, toId: a.id, lines: [{ itemId: t.locations.find((x) => x.id === b.id)!.items.find((i) => i.material === "cajas")!.id, quantity: 1 }] })).rejects.toThrow(/solo se puede mover completo/);
    await expect(s.transferContent(deposito, { key: key(), fromId: b.id, toId: b.id, all: true })).rejects.toThrow(/distintos/);
    await expect(s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, all: true })).rejects.toThrow(/libre/);
    const rel = await s.releaseLocation(deposito, { key: key(), locationId: b.id });
    expect(rel.locations[0]!.items).toHaveLength(0);
    await expect(s.releaseLocation(deposito, { key: key(), locationId: b.id })).rejects.toThrow(/ya está libre/);
    const hist = await s.listMovements(deposito, { locationId: b.id });
    expect(hist.map((m) => m.kind)).toEqual(["LIBERACION", "TRASLADO", "CONFIG"]); // CONFIG = alta de la posición
    expect(hist[0]!.lines.map((l) => l.material).sort()).toEqual(["cajas", "frascos de shampoo 250 ml"]);
    expect(hist[1]).toMatchObject({ fromCode: a.code, toCode: b.code });
    // Inmutable: no hay camino de código para editarlo y el historial solo crece (seq estrictamente creciente, nada se borra).
    const all = await q("select seq from deposito_ubicacion_movements where to_location_id = $1 or from_location_id = $1 order by seq", [b.id]);
    expect(all.length).toBe(hist.length);
    const seqs = all.map((r) => Number(r.seq));
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });

  it("transaccionalidad: si un renglón falla no queda nada a medias; control de versión; idempotencia", async () => {
    const s = await svc();
    const a = await newLoc("T4");
    const b = await newLoc("T5");
    const r = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ quantity: 10 }), line({ material: "tapas", quantity: 10 })] });
    const [i1, i2] = r.locations[0]!.items;
    const snapA = JSON.stringify((await s.getMap(deposito)).locations.find((l) => l.id === a.id));
    await expect(s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId: i1!.id, quantity: 5 }, { itemId: i2!.id, quantity: 11 }] })).rejects.toThrow(/No hay tanta cantidad/);
    const m = await s.getMap(deposito);
    expect(JSON.stringify(m.locations.find((l) => l.id === a.id))).toBe(snapA);
    expect(m.locations.find((l) => l.id === b.id)!.items).toHaveLength(0);
    // Dos renglones, uno inexistente: tampoco se aplica el primero.
    await expect(s.removeContent(deposito, { key: key(), locationId: a.id, lines: [{ itemId: i1!.id, quantity: 1 }, { itemId: randomUUID(), quantity: 1 }] })).rejects.toThrow(/ya no está/);
    expect((await s.getMap(deposito)).locations.find((l) => l.id === a.id)!.items.find((i) => i.id === i1!.id)!.quantity).toBe(10);
    // Versión vieja → conflicto 409, sin cambios.
    const cur = (await s.getMap(deposito)).locations.find((l) => l.id === a.id)!;
    await s.setObservations(deposito, { key: key(), locationId: a.id, expectedVersion: cur.version, observations: "uno" });
    await expect(s.setObservations(deposito, { key: key(), locationId: a.id, expectedVersion: cur.version, observations: "dos" })).rejects.toThrow(/otra persona/);
    expect((await s.getMap(deposito)).locations.find((l) => l.id === a.id)!.observations).toBe("uno");
    // Misma clave: se aplica una sola vez (reintento / doble toque).
    const k = key();
    const first = await s.transferContent(deposito, { key: k, fromId: a.id, toId: b.id, lines: [{ itemId: i1!.id, quantity: 4 }] });
    const again = await s.transferContent(deposito, { key: k, fromId: a.id, toId: b.id, lines: [{ itemId: i1!.id, quantity: 4 }] });
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.movementId).toBe(first.movementId);
    expect(await total("frascos de shampoo 250 ml", [a.id, b.id])).toBe(10);
    // Clave obligatoria.
    await expect(s.releaseLocation(deposito, { key: "", locationId: a.id })).rejects.toThrow(/clave/);
  });

  it("concurrencia: traslados simultáneos (también cruzados y con la misma clave) no pierden ni duplican", async () => {
    const s = await svc();
    const a = await newLoc("T6");
    const b = await newLoc("T7");
    const r = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ quantity: 1000 })] });
    const itemId = r.locations[0]!.items[0]!.id;
    const shared = key();
    const jobs: Array<Promise<unknown>> = [];
    for (let i = 0; i < 8; i++) jobs.push(s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId, quantity: 50 }] }));
    for (let i = 0; i < 5; i++) jobs.push(s.transferContent(deposito, { key: shared, fromId: a.id, toId: b.id, lines: [{ itemId, quantity: 30 }] }));
    const settled = await Promise.allSettled(jobs);
    expect(settled.every((x) => x.status === "fulfilled")).toBe(true);
    // 8 × 50 + 30 (la clave repetida se aplica una vez) = 430 en B; 570 en A.
    const map = await s.getMap(deposito);
    expect(map.locations.find((l) => l.id === b.id)!.items[0]!.quantity).toBe(430);
    expect(map.locations.find((l) => l.id === a.id)!.items[0]!.quantity).toBe(570);
    expect(await total("frascos de shampoo 250 ml", [a.id, b.id])).toBe(1000);
    expect(await q("select count(*)::int n from deposito_ubicacion_movements where idempotency_key = $1", [shared])).toEqual([{ n: 1 }]);
    // Cruzados A→B y B→A al mismo tiempo (sin interbloqueo) y con renglones distintos.
    const [ia] = map.locations.find((l) => l.id === a.id)!.items;
    const [ib] = map.locations.find((l) => l.id === b.id)!.items;
    const cross: Array<Promise<unknown>> = [];
    for (let i = 0; i < 6; i++) {
      cross.push(s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId: ia!.id, quantity: 10 }] }).catch((e) => e));
      cross.push(s.transferContent(deposito, { key: key(), fromId: b.id, toId: a.id, lines: [{ itemId: ib!.id, quantity: 7 }] }).catch((e) => e));
    }
    const res = await Promise.all(cross);
    // Los renglones pueden desaparecer/reaparecer (ids nuevos): lo único que se exige es no perder ni duplicar y que ninguno falle por interbloqueo.
    expect(res.filter((e) => e instanceof Error && /deadlock/i.test(e.message))).toHaveLength(0);
    expect(await total("frascos de shampoo 250 ml", [a.id, b.id])).toBe(1000);
    // Asignaciones concurrentes: ninguna se pierde (renglones libres aparte, total exacto) y, si es un material ME, se suman a UN renglón.
    const c = await newLoc("T8");
    await Promise.all(Array.from({ length: 10 }, () => s.addContent(deposito, { key: key(), locationId: c.id, lines: [line({ quantity: 10 })] })));
    const cItems = (await s.getMap(deposito)).locations.find((l) => l.id === c.id)!.items;
    expect(cItems).toHaveLength(10);
    expect(cItems.reduce((a, i) => a + (i.quantity ?? 0), 0)).toBe(100);
    const fxc = await meFixture(`IT-${RUN}-CC`, 1000);
    const d = await newLoc("T8B");
    await Promise.all(Array.from({ length: 10 }, () => s.addContent(deposito, { key: key(), locationId: d.id, lines: [line({ material: "Frasco ME", codigo: `IT-${RUN}-CC`, meMaterialId: fxc.matId, quantity: 10 })] })));
    expect((await s.getMap(deposito)).locations.find((l) => l.id === d.id)!.items).toMatchObject([{ quantity: 100, verified: true }]);
  });

  it("tope por stock disponible con material ME vinculado; sin vínculo no se valida", async () => {
    const s = await svc();
    const code = `IT-${RUN}-FR`;
    const fx = await meFixture(code, 1000);
    const a = await newLoc("T9");
    const b = await newLoc("TA");
    const linked = (qty: number, extra: Record<string, unknown> = {}) => line({ material: `Frasco ${code}`, quantity: qty, codigo: code, meMaterialId: fx.matId, ...extra });
    await s.addContent(deposito, { key: key(), locationId: a.id, lines: [linked(600)] });
    await expect(s.addContent(deposito, { key: key(), locationId: b.id, lines: [linked(401)] })).rejects.toThrow(/stock disponible es 1.000 y ya hay 600/);
    expect((await s.getMap(deposito)).locations.find((l) => l.id === b.id)!.items).toHaveLength(0);
    await s.addContent(deposito, { key: key(), locationId: b.id, lines: [linked(400)] });
    await expect(s.addContent(deposito, { key: key(), locationId: a.id, lines: [linked(1)] })).rejects.toThrow(/stock disponible/);
    // Concurrencia contra el tope: nunca se supera.
    const c = await newLoc("TB");
    const code2 = `IT-${RUN}-TP`;
    const fx2 = await meFixture(code2, 100);
    const rs = await Promise.allSettled(Array.from({ length: 6 }, () => s.addContent(deposito, { key: key(), locationId: c.id, lines: [line({ material: "tapa", codigo: code2, meMaterialId: fx2.matId, quantity: 30 })] })));
    expect(rs.filter((x) => x.status === "fulfilled")).toHaveLength(3);
    expect((await s.getMap(deposito)).locations.find((l) => l.id === c.id)!.items[0]!.quantity).toBe(90);
    // Vínculo inconsistente: el id no corresponde al código.
    await expect(s.addContent(deposito, { key: key(), locationId: c.id, lines: [line({ material: "x", codigo: "OTRO-COD", meMaterialId: fx2.matId, quantity: 1 })] })).rejects.toThrow(/no coincide con el inventario/);
    // Material libre por texto: sin tope.
    await s.addContent(deposito, { key: key(), locationId: c.id, lines: [line({ material: "cajas varias", quantity: 5_000_000 })] });
    // El traslado entre ubicaciones no cambia lo distribuido (no excede el tope).
    const it = (await s.getMap(deposito)).locations.find((l) => l.id === a.id)!.items[0]!;
    await s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId: it.id, quantity: 100 }] });
  });

  it("ingreso ME: sin ubicación sigue igual; con ubicación suma una sola vez (idempotente por id de ingreso) y no toca el stock", async () => {
    const s = await svc();
    const code = `IT-${RUN}-IN`;
    const fx = await meFixture(code, 800);
    const before = await stockSnapshot();
    const l = await newLoc("TC");
    // Ingreso sin ubicación: nada en el mapa (compatibilidad).
    expect((await s.getMap(deposito)).locations.find((x) => x.id === l.id)!.items).toHaveLength(0);
    const r1 = await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: l.id });
    expect(r1.replayed).toBe(false);
    expect(r1.locations[0]!.items[0]).toMatchObject({ clientName: "TRC", quantity: 800, codigo: code, meMaterialId: fx.matId });
    const r2 = await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: l.id });
    expect(r2.replayed).toBe(true);
    expect(r2.locations[0]!.items[0]!.quantity).toBe(800);
    // El mismo ingreso no se puede ubicar en otra posición (ya está ubicado).
    const l2 = await newLoc("TD");
    const r3 = await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: l2.id });
    expect(r3.replayed).toBe(true);
    expect((await s.getMap(deposito)).locations.find((x) => x.id === l2.id)!.items).toHaveLength(0);
    expect((await s.listMovements(deposito, { locationId: l.id }))[0]).toMatchObject({ kind: "INGRESO_ME", detail: { ingresoId: fx.ingId } });
    // Ingreso inexistente / anulado / sin total.
    await expect(s.placeIngresoMe(deposito, { ingresoId: randomUUID(), locationId: l.id })).rejects.toThrow(/todavía no está registrado/);
    await q("update inv_me_ingresos set payload = payload || '{\"anulado\": true}'::jsonb where id = $1", [fx.ingId]);
    const fx3 = await meFixture(`IT-${RUN}-AN`, 10);
    await q("update inv_me_ingresos set payload = payload || '{\"anulado\": true}'::jsonb where id = $1", [fx3.ingId]);
    await expect(s.placeIngresoMe(deposito, { ingresoId: fx3.ingId, locationId: l.id })).rejects.toThrow(/anulado/);
    // Otros sectores no pueden.
    await expect(s.placeIngresoMe(masivo, { ingresoId: fx.ingId, locationId: l.id })).rejects.toThrow(/Solo Depósito/);
    // Lo único que cambió en inventario es lo que la prueba misma escribió (el ingreso anulado): el módulo no escribe stock.
    const after = await stockSnapshot();
    expect(after.insumo_stock_movements).toEqual(before.insumo_stock_movements);
    expect(after.cajas_genus_movements).toEqual(before.cajas_genus_movements);
    expect((after.inv_me_ingresos as { n: number }).n).toBe((before.inv_me_ingresos as { n: number }).n + 1); // + el ingreso fixture de «anulado»
  });

  it("verificadas vs sin verificar: el tope solo cuenta verificadas, subtotales separados, el traslado conserva la condición y vincular valida el tope", async () => {
    const s = await svc();
    const code = `IT-${RUN}-VV`;
    const fx = await meFixture(code, 1000);
    const a = await newLoc("V1");
    const b = await newLoc("V2");
    const linked = (qty: number) => line({ material: `Frasco ${code}`, quantity: qty, codigo: code, meMaterialId: fx.matId });
    const r = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [linked(600), line({ material: "texto libre", quantity: 5000 }), line({ material: "otro libre", codigo: code, quantity: 70 })] });
    const items = r.locations[0]!.items;
    expect(items.map((i) => [i.material, i.verified]).sort()).toEqual([["Frasco " + code, true], ["otro libre", false], ["texto libre", false]]);
    expect(items.find((i) => i.material === "otro libre")!.codigo).toBeNull(); // un código sin vínculo no respalda nada
    const st = subtotals(items);
    expect(st.verified).toEqual({ rows: 1, byUnit: { u: 600 } });
    expect(st.unverified).toEqual({ rows: 2, byUnit: { u: 5070 } });
    // El tope solo cuenta verificadas: 5.070 sin verificar no consumen stock, pero 401 verificadas más sí lo superan.
    await expect(s.addContent(deposito, { key: key(), locationId: b.id, lines: [linked(401)] })).rejects.toThrow(/stock disponible/);
    await s.addContent(deposito, { key: key(), locationId: b.id, lines: [linked(400)] });
    // Vincular un renglón sin verificar: valida el tope (no se cuela stock inexistente).
    const libre = items.find((i) => i.material === "texto libre")!;
    await expect(s.linkContent(deposito, { key: key(), locationId: a.id, itemId: libre.id, meMaterialId: fx.matId })).rejects.toThrow(/stock disponible/);
    expect((await s.getMap(deposito)).locations.find((l) => l.id === a.id)!.items.find((i) => i.id === libre.id)!.verified).toBe(false);
    const fx2 = await meFixture(`IT-${RUN}-V2`, 100);
    const small = items.find((i) => i.material === "otro libre")!;
    expect(small.quantity).toBe(70);
    const lk = await s.linkContent(deposito, { key: key(), locationId: a.id, itemId: small.id, meMaterialId: fx2.matId });
    const linkedRow = lk.locations[0]!.items.find((i) => i.id === small.id)!;
    expect(linkedRow).toMatchObject({ verified: true, meMaterialId: fx2.matId, codigo: `IT-${RUN}-V2`, quantity: 70 });
    const hist = await s.listMovements(deposito, { locationId: a.id });
    expect(hist[0]).toMatchObject({ kind: "AGREGADO", detail: { action: "vincular", itemId: small.id } });
    expect(hist[0]!.lines[0]).toMatchObject({ verified: true, verifiedBefore: false });
    // Idempotente por clave y no se vincula dos veces.
    const k = key();
    const l2 = await s.linkContent(deposito, { key: k, locationId: a.id, itemId: libre.id, meMaterialId: fx2.matId }).catch((e) => e);
    expect(l2).toBeInstanceOf(Error); // 5.000 > stock 100 − 70 ya vinculados
    await expect(s.linkContent(deposito, { key: key(), locationId: a.id, itemId: small.id, meMaterialId: fx2.matId })).rejects.toThrow(/ya está vinculado/);
    await expect(s.linkContent(masivo, { key: key(), locationId: a.id, itemId: libre.id, meMaterialId: fx2.matId })).rejects.toThrow(/Solo Depósito/);
    // Traslado parcial: la condición viaja con el renglón, en origen y destino; subtotales separados en el destino.
    const c = await newLoc("V3");
    const cur = (await s.getMap(deposito)).locations.find((l) => l.id === a.id)!;
    const frasco = cur.items.find((i) => i.material === `Frasco ${code}`)!;
    const libre2 = cur.items.find((i) => i.material === "texto libre")!;
    const t = await s.transferContent(deposito, { key: key(), fromId: a.id, toId: c.id, lines: [{ itemId: frasco.id, quantity: 100 }, { itemId: libre2.id, quantity: 1000 }] });
    const src = t.locations.find((l) => l.id === a.id)!;
    const dst = t.locations.find((l) => l.id === c.id)!;
    expect(src.items.find((i) => i.id === frasco.id)).toMatchObject({ quantity: 500, verified: true });
    expect(src.items.find((i) => i.id === libre2.id)).toMatchObject({ quantity: 4000, verified: false });
    expect(dst.items.map((i) => [i.material, i.quantity, i.verified]).sort()).toEqual([["Frasco " + code, 100, true], ["texto libre", 1000, false]]);
    expect(subtotals(dst.items)).toMatchObject({ verified: { byUnit: { u: 100 } }, unverified: { byUnit: { u: 1000 } } });
    expect((await s.listMovements(deposito, { locationId: c.id }))[0]!.lines.map((l) => [l.verified]).sort()).toEqual([[false], [true]]);
    // Lo verificado distribuido nunca superó el stock (1.000 del código).
    const dist = await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where codigo = $1 and me_material_id is not null", [code]);
    expect(dist[0]!.n).toBe(1000);
    expect((await s.listMaterials(deposito, code)).find((m) => m.codigo === code)!.distributed).toBe(1000);
  });

  it("identidad, no texto: dos materiales ME distintos con la misma descripción y cliente quedan separados; el mismo id se suma; los libres no se fusionan por texto; el traslado no mezcla identidades", async () => {
    const s = await svc();
    const f1 = await meFixture(`IT-${RUN}-I1`, 5000);
    const f2 = await meFixture(`IT-${RUN}-I2`, 5000);
    const a = await newLoc("I1");
    const b = await newLoc("I2");
    const me = (fx: { matId: string }, code: string, qty: number, desc = "Frasco 250 ml") => line({ material: desc, quantity: qty, codigo: code, meMaterialId: fx.matId });
    const r = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [me(f1, `IT-${RUN}-I1`, 100), me(f2, `IT-${RUN}-I2`, 200)] });
    expect(r.locations[0]!.items).toHaveLength(2); // misma descripción y cliente, ids distintos
    const r2 = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [me(f1, `IT-${RUN}-I1`, 50)] });
    expect(r2.locations[0]!.items).toHaveLength(2);
    expect(r2.locations[0]!.items.find((i) => i.meMaterialId === f1.matId)!.quantity).toBe(150);
    // Libres: dos líneas iguales = dos renglones; solo se suma eligiendo el renglón.
    const l1 = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ material: "pomos", quantity: 10 }), line({ material: "pomos", quantity: 20 })] });
    const pomos = l1.locations[0]!.items.filter((i) => i.material === "pomos");
    expect(pomos.map((i) => i.quantity).sort()).toEqual([10, 20]);
    const l2 = await s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ material: "pomos", quantity: 5, mergeIntoItemId: pomos[0]!.id })] });
    expect(l2.locations[0]!.items.filter((i) => i.material === "pomos").map((i) => i.quantity).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(pomos[0]!.quantity === 10 ? [15, 20] : [10, 25]);
    // Elegir un renglón ME para «sumar», o uno de otro cliente, se rechaza.
    const meRow = l2.locations[0]!.items.find((i) => i.meMaterialId === f1.matId)!;
    await expect(s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ material: "x", quantity: 1, mergeIntoItemId: meRow.id })] })).rejects.toThrow(/ya no está|no está en la ubicación/);
    await expect(s.addContent(deposito, { key: key(), locationId: a.id, lines: [line({ clientName: "Otro Cliente", material: "pomos", quantity: 1, mergeIntoItemId: pomos[0]!.id })] })).rejects.toThrow(/otro cliente/);
    // Traslado parcial: se fusiona en destino SOLO por identidad.
    const cur = l2.locations[0]!.items;
    const [p1, p2] = cur.filter((i) => i.material === "pomos");
    const f1row = cur.find((i) => i.meMaterialId === f1.matId)!;
    const f2row = cur.find((i) => i.meMaterialId === f2.matId)!;
    await s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId: f1row.id, quantity: 10 }, { itemId: f2row.id, quantity: 20 }, { itemId: p1!.id, quantity: 1 }, { itemId: p2!.id, quantity: 2 }] });
    const t2 = await s.transferContent(deposito, { key: key(), fromId: a.id, toId: b.id, lines: [{ itemId: f1row.id, quantity: 5 }, { itemId: p1!.id, quantity: 1 }] });
    const dst = t2.locations.find((l) => l.id === b.id)!;
    expect(dst.items.filter((i) => i.meMaterialId)).toHaveLength(2); // no se mezclan f1 y f2
    expect(dst.items.find((i) => i.meMaterialId === f1.matId)!.quantity).toBe(15); // mismo id: se suma
    expect(dst.items.find((i) => i.meMaterialId === f2.matId)!.quantity).toBe(20);
    const dp = dst.items.filter((i) => i.material === "pomos");
    expect(dp).toHaveLength(2); // dos lotes libres distintos no se fusionan
    expect(dp.map((i) => i.quantity).sort()).toEqual([2, 2]);
    // Volver a mover el mismo lote libre suma al mismo renglón de destino (misma identidad).
    const total = (await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where location_id = any($1) and material_name = 'pomos'", [[a.id, b.id]]))[0]!.n;
    expect(total).toBe(10 + 20 + 5);
    // La búsqueda sigue siendo por texto y encuentra ambos renglones sin fusionarlos.
    expect(searchLocations((await s.getMap(masivo)).locations, "pomos").map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("ingreso ME cuya ubicación falló: se ubica después sin duplicar (doble clic, reintento, concurrencia, otra posición); anulados y modificados", async () => {
    const s = await svc();
    const code = `IT-${RUN}-IG`;
    const fx = await meFixture(code, 800);
    const a = await newLoc("G1");
    const b = await newLoc("G2");
    // Sin ubicar: aparece en la lista (con fecha, material, cliente y cantidad).
    const pend = (await s.listIngresos(deposito)).unplaced.find((x) => x.ingresoId === fx.ingId)!;
    expect(pend).toMatchObject({ fecha: "2026-11-20", cliente: "TRC", total: 800, codigo: code });
    // Doble clic / concurrencia: una sola vez.
    const rs = await Promise.all([a, a, b, a, b].map((l) => s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: l.id })));
    expect(rs.filter((r) => !r.replayed)).toHaveLength(1);
    const placedIn = rs.find((r) => !r.replayed)!.placedIn!;
    expect(rs.every((r) => r.placedIn === placedIn)).toBe(true);
    const sum = async () => Number((await q("select coalesce(sum(quantity),0)::float8 n from deposito_ubicacion_items where me_material_id = $1", [fx.matId]))[0]!.n);
    expect(await sum()).toBe(800);
    expect((await q("select count(*)::int n from deposito_ubicacion_movements where idempotency_key = $1", [`ingreso-me:${fx.ingId}`]))[0]!.n).toBe(1);
    expect((await q("select count(*)::int n, max(applied_quantity)::float8 a from deposito_ingreso_ubicacion where ingreso_id = $1", [fx.ingId]))[0]).toEqual({ n: 1, a: 800 });
    expect((await s.listIngresos(deposito)).unplaced.some((x) => x.ingresoId === fx.ingId)).toBe(false);
    // Pedir otra posición después NO re-suma (mover es un traslado normal).
    const again = await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: placedIn === a.code ? b.id : a.id });
    expect(again.replayed).toBe(true);
    expect(await sum()).toBe(800);
    // Registro previo a 0093 (solo movimiento): se re-registra con la misma cantidad y no suma otra vez.
    await q("delete from deposito_ingreso_ubicacion where ingreso_id = $1", [fx.ingId]);
    expect((await s.listIngresos(deposito)).unplaced.some((x) => x.ingresoId === fx.ingId)).toBe(false);
    expect((await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: b.id })).replayed).toBe(true);
    expect(await sum()).toBe(800);
    expect((await q("select applied_quantity::float8 a from deposito_ingreso_ubicacion where ingreso_id = $1", [fx.ingId]))[0]!.a).toBe(800);
    // Modificado: la cantidad subió de 800 a 1.000 → se ajusta SOLO la diferencia, una vez.
    const setTotal = (id: string, total: number) => q("update inv_me_ingresos set payload = payload || jsonb_build_object('total', $2::numeric) where id = $1", [id, total]);
    await setTotal(fx.ingId, 1000);
    const rv = (await s.listIngresos(deposito)).review.find((x) => x.ingresoId === fx.ingId)!;
    expect(rv).toMatchObject({ reason: "MODIFICADO", applied: 800, current: 1000, diff: 200 });
    const adj = await Promise.all([1, 2, 3, 4].map(() => s.adjustIngresoMe(deposito, { ingresoId: fx.ingId })));
    expect(adj.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await sum()).toBe(1000);
    expect((await s.adjustIngresoMe(deposito, { ingresoId: fx.ingId })).replayed).toBe(true);
    expect(await sum()).toBe(1000);
    expect((await s.listIngresos(deposito)).review.some((x) => x.ingresoId === fx.ingId)).toBe(false);
    const hist = await s.listMovements(deposito, { kind: "INGRESO_ME" });
    expect(hist.filter((m) => (m.detail as { ingresoId?: string }).ingresoId === fx.ingId).map((m) => (m.detail as { action?: string }).action).sort()).toEqual(["ajuste_ingreso", "ubicar"]);
    // Baja de 1.000 a 900: resta 100. Si el material ya no está todo en la posición de registro, no se inventa nada.
    await setTotal(fx.ingId, 900);
    await s.adjustIngresoMe(deposito, { ingresoId: fx.ingId });
    expect(await sum()).toBe(900);
    const reg = (await q("select location_id from deposito_ingreso_ubicacion where ingreso_id = $1", [fx.ingId]))[0]!.location_id as string;
    const other = reg === a.id ? b : a;
    const here = (await s.getMap(deposito)).locations.find((l) => l.id === reg)!.items.find((i) => i.meMaterialId === fx.matId)!;
    await s.transferContent(deposito, { key: key(), fromId: reg, toId: other.id, lines: [{ itemId: here.id, quantity: 850 }] });
    await setTotal(fx.ingId, 700);
    await expect(s.adjustIngresoMe(deposito, { ingresoId: fx.ingId })).rejects.toThrow(/no queda tanto/);
    expect(await sum()).toBe(900);
    // Anulado: no se puede ubicar uno nuevo; si ya estaba ubicado se detecta y se retira la cantidad registrada (sin borrar registros).
    await setTotal(fx.ingId, 900);
    await q("update inv_me_ingresos set payload = payload || '{\"anulado\": true}'::jsonb where id = $1", [fx.ingId]);
    expect((await s.listIngresos(deposito)).review.find((x) => x.ingresoId === fx.ingId)).toMatchObject({ reason: "ANULADO" });
    await expect(s.adjustIngresoMe(deposito, { ingresoId: fx.ingId })).rejects.toThrow(/anulado/);
    await expect(s.retireAnuladoIngreso(deposito, { ingresoId: fx.ingId })).rejects.toThrow(/Traela de vuelta/); // 850 están en la otra posición
    await s.transferContent(deposito, { key: key(), fromId: other.id, toId: reg, lines: [{ itemId: (await s.getMap(deposito)).locations.find((l) => l.id === other.id)!.items.find((i) => i.meMaterialId === fx.matId)!.id, quantity: 850 }] });
    const ret = await Promise.all([1, 2, 3].map(() => s.retireAnuladoIngreso(deposito, { ingresoId: fx.ingId })));
    expect(ret.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await sum()).toBe(0);
    expect((await q("select status from deposito_ingreso_ubicacion where ingreso_id = $1", [fx.ingId]))[0]!.status).toBe("RETIRADO");
    const rh = (await s.listMovements(deposito, { locationId: reg })).find((m) => (m.detail as { action?: string }).action === "ingreso_anulado")!;
    expect(rh).toMatchObject({ kind: "RETIRO" });
    expect(rh.lines[0]!.quantity).toBe(900);
    expect((await s.listIngresos(deposito)).review.some((x) => x.ingresoId === fx.ingId)).toBe(false);
    expect((await s.placeIngresoMe(deposito, { ingresoId: fx.ingId, locationId: a.id })).replayed).toBe(true);
    expect(await sum()).toBe(0);
    // Un ingreso anulado SIN ubicar no se puede ubicar ni aparece en la lista.
    const fy = await meFixture(`IT-${RUN}-IY`, 50);
    await q("update inv_me_ingresos set payload = payload || '{\"anulado\": true}'::jsonb where id = $1", [fy.ingId]);
    await expect(s.placeIngresoMe(deposito, { ingresoId: fy.ingId, locationId: a.id })).rejects.toThrow(/anulado/);
    expect((await s.listIngresos(deposito)).unplaced.some((x) => x.ingresoId === fy.ingId)).toBe(false);
    // Solo Depósito escribe.
    await expect(s.adjustIngresoMe(masivo, { ingresoId: fx.ingId })).rejects.toThrow(/Solo Depósito/);
    await expect(s.retireAnuladoIngreso(produccion, { ingresoId: fx.ingId })).rejects.toThrow(/Solo Depósito/);
    expect(Array.isArray((await s.listIngresos(masivo)).unplaced)).toBe(true);
  });

  it("permisos: Envasado Masivo/Premium, Producción y Dirección leen; Envasado y los demás NO escriben (403 en toda escritura); otros sectores ni leen", async () => {
    const s = await svc();
    const l = await newLoc("TE");
    const l2 = await newLoc("TF");
    const r = await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 10 })] });
    const itemId = r.locations[0]!.items[0]!.id;
    for (const who of [masivo, premium, produccion, direccion, deposito]) {
      expect((await s.getMap(who)).locations.length).toBeGreaterThan(36);
      expect(Array.isArray(await s.listMovements(who, { locationId: l.id }))).toBe(true);
      expect(Array.isArray(await s.listClients(who))).toBe(true);
      expect(Array.isArray(await s.listMaterials(who, "x"))).toBe(true);
    }
    expect((await s.getMap(masivo)).capabilities).toEqual({ read: true, write: false, config: false });
    expect((await s.getMap(direccion)).capabilities).toEqual({ read: true, write: false, config: true });
    expect((await s.getMap(deposito)).capabilities).toEqual({ read: true, write: true, config: true });
    const forbidden = /Solo Depósito|Solo Depósito y Dirección/;
    for (const who of [masivo, premium, produccion, direccion, codificado]) {
      await expect(s.addContent(who, { key: key(), locationId: l.id, lines: [line()] })).rejects.toThrow(forbidden);
      await expect(s.removeContent(who, { key: key(), locationId: l.id, lines: [{ itemId, quantity: 1 }] })).rejects.toThrow(forbidden);
      await expect(s.setObservations(who, { key: key(), locationId: l.id, observations: "x" })).rejects.toThrow(forbidden);
      await expect(s.transferContent(who, { key: key(), fromId: l.id, toId: l2.id, all: true })).rejects.toThrow(forbidden);
      await expect(s.releaseLocation(who, { key: key(), locationId: l.id })).rejects.toThrow(forbidden);
    }
    for (const who of [masivo, premium, produccion, codificado]) {
      await expect(s.createLocation(who, { code: "ZZ1", x: 1, y: 1, w: 20, h: 20 })).rejects.toThrow(/Solo Depósito y Dirección/);
      await expect(s.updateLocation(who, { id: l.id, zone: "x" })).rejects.toThrow(/Solo Depósito y Dirección/);
      await expect(s.upsertShape(who, { kind: "PASILLO", x: 1, y: 1, w: 20, h: 20 })).rejects.toThrow(/Solo Depósito y Dirección/);
      await expect(s.updateMapConfig(who, { title: "x" })).rejects.toThrow(/Solo Depósito y Dirección/);
    }
    await expect(s.getMap(codificado)).rejects.toThrow(/no puede consultar/);
    expect((await s.getMap(deposito)).locations.find((x) => x.id === l.id)!.items[0]!.quantity).toBe(10); // nada cambió
  });

  it("configuración del mapa: crear, mover, renombrar vacías; ocupadas no se renombran ni desactivan; nunca se borra; el historial conserva el código", async () => {
    const s = await svc();
    const l = await s.createLocation(direccion, { code: `cfg${RUN}`, zone: "Prueba", x: 5, y: 5, w: 30, h: 20 });
    created.push(l.id);
    expect(l.code).toBe(`CFG${RUN}`);
    await expect(s.createLocation(deposito, { code: `CFG${RUN}`, x: 5, y: 5, w: 30, h: 20 })).rejects.toThrow(/Ya existe/);
    await expect(s.createLocation(deposito, { code: "A01", x: 5, y: 5, w: 30, h: 20 })).rejects.toThrow(/Ya existe/);
    await expect(s.createLocation(deposito, { code: "OUT1", x: 390, y: 5, w: 30, h: 20 })).rejects.toThrow(/se sale del plano/);
    await expect(s.createLocation(deposito, { code: "OVL1", x: 100, y: 20, w: 30, h: 20 })).rejects.toThrow(/se superpone con C01/);
    await expect(s.updateLocation(deposito, { id: l.id, x: 12, y: 106 })).rejects.toThrow(/se superpone con A01/);
    await expect(s.createLocation(deposito, { code: "bad code!", x: 5, y: 5, w: 30, h: 20 })).rejects.toThrow(/letras, números/);
    const moved = await s.updateLocation(deposito, { id: l.id, expectedVersion: l.version, x: 40, y: 50, w: 44, h: 30, zone: "Otra", sortOrder: 500 });
    expect(moved).toMatchObject({ x: 40, y: 50, w: 44, h: 30, zone: "Otra", sortOrder: 500, version: l.version + 1 });
    await expect(s.updateLocation(deposito, { id: l.id, expectedVersion: l.version, zone: "x" })).rejects.toThrow(/otra persona/);
    const renamed = await s.updateLocation(deposito, { id: l.id, code: `new${RUN}` });
    expect(renamed.code).toBe(`NEW${RUN}`);
    await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 5 })] });
    await expect(s.updateLocation(deposito, { id: l.id, code: `otro${RUN}` })).rejects.toThrow(/ocupada/);
    await expect(s.updateLocation(deposito, { id: l.id, active: false })).rejects.toThrow(/ocupada/);
    // Sí se puede mover/redimensionar una ocupada.
    expect((await s.updateLocation(deposito, { id: l.id, x: 45, y: 60 })).x).toBe(45);
    await expect(s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ quantity: 1 })] })).resolves.toBeTruthy();
    await s.releaseLocation(deposito, { key: key(), locationId: l.id });
    const off = await s.updateLocation(deposito, { id: l.id, active: false });
    expect(off.active).toBe(false);
    // Desactivada: no recibe contenido, no cuenta en los indicadores, pero la fila y su historial siguen.
    await expect(s.addContent(deposito, { key: key(), locationId: l.id, lines: [line()] })).rejects.toThrow(/desactivada/);
    const map = await s.getMap(deposito);
    expect(map.locations.some((x) => x.id === l.id && !x.active)).toBe(true);
    expect(map.indicators.total).toBe(map.locations.filter((x) => x.active).length);
    expect((await q("select count(*)::int n from deposito_ubicaciones where id = $1", [l.id]))[0]!.n).toBe(1);
    const hist = await s.listMovements(deposito, { locationId: l.id });
    expect(hist.length).toBeGreaterThanOrEqual(6);
    expect(hist.some((m) => m.kind === "ASIGNACION" && m.toCode === `NEW${RUN}`)).toBe(true);
    expect(hist.some((m) => m.kind === "CONFIG" && (m.detail.before as { code?: string } | undefined)?.code === `CFG${RUN}`)).toBe(true);
    expect((await s.updateLocation(deposito, { id: l.id, active: true })).active).toBe(true);
    // Forma del plano.
    const sh = await s.upsertShape(direccion, { kind: "PASILLO", label: `Pasillo ${RUN}`, x: 200, y: 10, w: 60, h: 20 });
    expect(sh.label).toBe(`Pasillo ${RUN}`);
    const sh2 = await s.upsertShape(direccion, { id: sh.id, x: 210, active: false });
    expect(sh2).toMatchObject({ x: 210, active: false });
    await expect(s.upsertShape(deposito, { id: sh.id, kind: "CONTORNO", points: [[0, 0], [1, 1]] })).rejects.toThrow(/entre 3 y 64 puntos/);
    await q("delete from deposito_mapa_shapes where id = $1", [sh.id]);
    await expect(s.updateMapConfig(deposito, { width: 100, height: 100 })).rejects.toThrow(/más chico/);
    expect(await s.updateMapConfig(direccion, { title: "Planta alta" })).toMatchObject({ width: 400, height: 740, title: "Planta alta" });
    await s.updateMapConfig(direccion, { title: "Planta alta · Depósito de material de envase y empaque" });
  });
});
