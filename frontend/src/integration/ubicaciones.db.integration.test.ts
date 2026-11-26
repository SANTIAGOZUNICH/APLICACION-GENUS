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
import { cellState, computeIndicators, searchLocations } from "@/lib/ubicaciones/rules";

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
    // Mismo cliente + mismo material (con otra escritura del cliente) = un solo renglón sumado.
    const r2 = await s.addContent(deposito, { key: key(), locationId: l.id, lines: [line({ clientName: "trc", material: "FRASCOS DE SHAMPOO 250 ML", quantity: 25.5 })] });
    const fr = r2.locations[0]!.items.filter((i) => i.material.toLowerCase().startsWith("frascos"));
    expect(fr).toHaveLength(1);
    expect(fr[0]!.quantity).toBe(125.5);
    expect((await s.listMovements(deposito, { locationId: l.id })).map((m) => m.kind)).toEqual(["AGREGADO", "ASIGNACION", "CONFIG"]);
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
    // Asignaciones concurrentes de lo mismo a una misma posición: se suman, sin duplicar renglones.
    const c = await newLoc("T8");
    await Promise.all(Array.from({ length: 10 }, () => s.addContent(deposito, { key: key(), locationId: c.id, lines: [line({ quantity: 10 })] })));
    expect((await s.getMap(deposito)).locations.find((l) => l.id === c.id)!.items).toMatchObject([{ quantity: 100 }]);
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
