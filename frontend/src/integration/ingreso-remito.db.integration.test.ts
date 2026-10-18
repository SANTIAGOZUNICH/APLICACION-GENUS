/**
 * Ingreso de MP / ME con foto de remito contra un Postgres de PRUEBA real: borrador sin stock, catálogo real (nunca crea
 * materiales), confirmación atómica e idempotente por el mecanismo existente (MP: servicio + libro mayor; ME: inv_me_ingresos),
 * duplicados / recepciones parciales, concurrencia, comprobante permanente, permisos por sector y que lo histórico no cambie.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = randomUUID().slice(0, 6).toUpperCase();
const mkActor = (sector: string, who: string) => ({ email: `${who}-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: sector as never, displayName: `IT ${who}` });
const mp = mkActor("MATERIA_PRIMA", "mp");
const mp2 = mkActor("MATERIA_PRIMA", "mp2");
const dep = mkActor("DEPOSITO", "dep");
const prod = mkActor("PRODUCCION", "prod");
const dir = mkActor("DIRECCION", "dir");
const MP_CODE = `IT-RC-GLI-${RUN}`;
const MP_CODE2 = `IT-RC-ALC-${RUN}`;
const ME_CODE = `IT-RC-FR-${RUN}`;
const ME_CODE2 = `IT-RC-TA-${RUN}`;
let n = 0;
/** JPEG mínimo con firma válida; el contador lo hace único (distinto sha256). */
const jpeg = (tag = "") => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from(`JFIF-${RUN}-${tag}-${++n}-${randomUUID()}`)]);
const pdf = () => new Uint8Array(Buffer.from(`%PDF-1.4\n% ${RUN} ${++n} ${randomUUID()}\n%%EOF`));
const tomorrow = () => new Date().toISOString().slice(0, 10);

describe.skipIf(Boolean(PROBLEM))(`Ingreso con remito en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => new (await import("@/lib/inventory/receipt-service")).ReceiptService();
  const lib = () => import("@/lib/inventory/receipt-service");
  const balance = async (code: string) => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [code]))[0]?.stock_actual ?? 0);
  const movements = async (code: string) => (await q("select count(*)::int n from mp_stock_movements where codigo = $1", [code]))[0]!.n as number;
  const meStock = async (code: string) => (await import("@/lib/inventory/me-planilla-db")).meStockByCodigoDb(code);
  const rejects = (p: Promise<unknown>, status: number, code?: string) => expect(p).rejects.toMatchObject({ status, ...(code ? { code } : {}) });

  const mpLine = (over: Record<string, string | boolean> = {}) => ({
    id: randomUUID().slice(0, 8), supplierCode: "AB-77", description: "Glicerina vegetal", materialCode: MP_CODE, quantity: "100", remitoQuantity: "", unit: "kg", packages: "", lote: `L-${RUN}`,
    vencimiento: "2029-05-31", noExpiry: false, notes: "", review: [], matchSource: "", ...over,
  });
  const meLine = (over: Record<string, string | boolean> = {}) => ({ ...mpLine({ supplierCode: "FR-9", description: "Frasco 250", materialCode: ME_CODE, quantity: "1000", unit: "un", lote: "", vencimiento: "", ...over }) });
  const header = (remitoNumber: string, over: Record<string, string> = {}) => ({ supplier: `Proveedor IT ${RUN} SA`, remitoNumber, remitoDate: tomorrow(), receivedDate: tomorrow(), notes: "", ...over });

  /** Borrador completo: crear → adjuntar → guardar. */
  async function draft(module: "MP" | "ME", actor: typeof mp, remito: string, lines: unknown[], opts: { files?: number; header?: Record<string, string> } = {}) {
    const s = await svc();
    let r = await s.createDraft(actor as never, module);
    for (let i = 0; i < (opts.files ?? 1); i++) await s.addFile(actor as never, r.id, module, { fileName: `remito-${i + 1}.jpg`, bytes: jpeg() });
    r = await s.saveDraft(actor as never, r.id, module, { expectedVersion: r.version, header: header(remito, opts.header), lines });
    return r;
  }
  const confirm = async (module: "MP" | "ME", actor: typeof mp, r: { id: string; version: number }, extra: Record<string, unknown> = {}) =>
    (await svc()).confirm(actor as never, r.id, module, { expectedVersion: r.version, confirmKey: `k-${randomUUID()}`, ...extra } as never);

  const cleanup = async () => {
    await q("delete from inventory_receipt_lines where material_code like 'IT-RC-%'");
    await q("delete from inventory_receipts where supplier like 'Proveedor IT %'");
    await q("delete from inventory_ingreso_adjuntos where uploaded_by like '%-" + RUN.toLowerCase() + "@%'");
    await q("delete from inv_mp_ingresos where payload->>'codigo' like 'IT-RC-%'");
    await q("delete from inv_mp_stock where payload->>'codigo' like 'IT-RC-%'");
    await q("delete from mp_stock_movements where codigo like 'IT-RC-%'");
    await q("delete from mp_stock_balances where codigo like 'IT-RC-%'");
    await q("delete from inv_me_ingresos where payload->>'codigo' like 'IT-RC-%'");
    await q("delete from inv_me_materials where payload->>'codigo' like 'IT-RC-%'");
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await cleanup();
    // Catálogo real de la prueba: MP = códigos que ya existen en el libro mayor; ME = materiales de Depósito.
    for (const [c, d] of [[MP_CODE, "GLICERINA VEGETAL USP"], [MP_CODE2, "ALCOHOL CETILICO"]]) {
      await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1,$2,0)", [c, d]);
    }
    for (const [c, d] of [[ME_CODE, "FRASCO PET 250 ML"], [ME_CODE2, "TAPA ROSCA 24/410"]]) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await q("insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, $2::jsonb, now())", [id, JSON.stringify({ id, codigo: c, descripcion: d, cliente: "", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", observacion: "", updatedAt: now, archived: false })]);
    }
  }, 120_000);

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await pool?.end();
  });

  it("MP con foto: el borrador NO mueve stock; al confirmar suma UNA vez (lote + libro mayor) y queda el comprobante vinculado", async () => {
    const r = await draft("MP", mp, `R-${RUN}-1`, [mpLine({ quantity: "100" })]);
    expect(r.status).toBe("BORRADOR");
    expect(await balance(MP_CODE)).toBe(0);
    expect((await q("select count(*)::int n from inv_mp_ingresos where payload->>'codigo' = $1", [MP_CODE]))[0]!.n).toBe(0);
    const a = await (await svc()).analyze(mp as never, r.id, "MP");
    expect(a.ready).toBe(true);

    const c = await confirm("MP", mp, r);
    expect(c.status).toBe("CONFIRMADO");
    expect(await balance(MP_CODE)).toBe(100);
    const ing = (await q("select payload from inv_mp_ingresos where payload->>'codigo' = $1", [MP_CODE]))[0]!.payload as Record<string, unknown>;
    expect(ing).toMatchObject({ status: "CONFIRMADO", stockImpacted: true, lote: `L-${RUN}`, vencimiento: "2029-05-31", remitoNro: `R-${RUN}-1`, fecha: tomorrow(), createdBy: mp.email });
    const lots = await q("select payload from inv_mp_stock where payload->>'codigo' = $1", [MP_CODE]);
    expect(lots).toHaveLength(1);
    expect((lots[0]!.payload as Record<string, unknown>).cantidadKg).toBe(100);
    // Trazabilidad: línea ↔ ingreso, proveedor, usuario, fecha de recepción y archivo.
    expect(c.confirmedLines[0]).toMatchObject({ materialCode: MP_CODE, quantity: 100, lote: `L-${RUN}`, ingresoId: ing.id, ingresoNro: ing.ingresoNro, supplierCode: "AB-77" });
    expect(c.confirmedBy).toBe(mp.email);
    expect(c.files).toHaveLength(1);
    expect(c.movements.some((m) => m.ingresoId === ing.id && m.quantity === 100)).toBe(true);
    // El historial actual del sector (ingresos) y la foto del ingreso salen del mismo registro.
    const { getIngresoAdjuntosService } = await import("@/lib/inventory/ingreso-adjuntos-service");
    const fotos = await getIngresoAdjuntosService().list(mp as never, "MP", String(ing.id));
    expect(fotos).toHaveLength(1);
    expect((await getIngresoAdjuntosService().counts(mp as never, "MP"))[String(ing.id)]).toBe(1);
    const dl = await getIngresoAdjuntosService().download(prod as never, fotos[0]!.id);
    expect(dl.bytes.length).toBeGreaterThan(10);
  });

  it("remito con varios materiales y varias páginas (foto + PDF): una línea de ingreso por material", async () => {
    const s = await svc();
    let r = await s.createDraft(mp as never, "MP");
    await s.addFile(mp as never, r.id, "MP", { fileName: "p1.jpg", bytes: jpeg("p1") });
    await s.addFile(mp as never, r.id, "MP", { fileName: "p2.pdf", bytes: pdf() });
    r = await s.saveDraft(mp as never, r.id, "MP", { expectedVersion: r.version, header: header(`R-${RUN}-2`), lines: [mpLine({ quantity: "50" }), mpLine({ materialCode: MP_CODE2, supplierCode: "ZZ", description: "Alcohol", quantity: "25,5", lote: "LA-1" })] });
    const c = await confirm("MP", mp, r);
    expect(c.files.map((f) => f.contentType).sort()).toEqual(["application/pdf", "image/jpeg"]);
    expect(c.confirmedLines).toHaveLength(2);
    expect(await balance(MP_CODE)).toBe(150);
    expect(await balance(MP_CODE2)).toBe(25.5);
  });

  it("ME con foto: suma al libro de Depósito (stock derivado), nro correlativo, material existente", async () => {
    const before = await meStock(ME_CODE);
    const r = await draft("ME", dep, `R-${RUN}-3`, [meLine({ quantity: "1.000", packages: "10" })]);
    expect(await meStock(ME_CODE)).toBe(before);
    const c = await confirm("ME", dep, r);
    expect(c.status).toBe("CONFIRMADO");
    expect(await meStock(ME_CODE)).toBe(before + 1000);
    const row = (await q("select payload from inv_me_ingresos where payload->>'codigo' = $1", [ME_CODE]))[0]!.payload as Record<string, unknown>;
    expect(row).toMatchObject({ total: 1000, bultos: 10, cantidad: 100, remitoNro: `R-${RUN}-3`, createdBy: dep.email, fecha: tomorrow() });
    expect(String(row.ingresoNro)).toMatch(/^ME-I-\d{5}$/);
    // El material NO se duplicó ni se creó otro.
    expect((await q("select count(*)::int n from inv_me_materials where payload->>'codigo' = $1", [ME_CODE]))[0]!.n).toBe(1);
  });

  it("material no encontrado / sin elegir: se rechaza y NO se crea ningún material ni ingreso", async () => {
    const matBefore = (await q("select count(*)::int n from inv_me_materials"))[0]!.n;
    const r = await draft("ME", dep, `R-${RUN}-4`, [meLine({ materialCode: `IT-RC-NOEXISTE-${RUN}` }), meLine({ materialCode: "" })]);
    await rejects(confirm("ME", dep, r), 422, "INVALID");
    expect((await q("select count(*)::int n from inv_me_materials"))[0]!.n).toBe(matBefore);
    expect((await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-4`]))[0]!.n).toBe(0);
    const a = await (await svc()).analyze(dep as never, r.id, "ME");
    expect(a.validation.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["UNKNOWN_MATERIAL", "NO_MATERIAL"]));
  });

  it("cantidad, unidad, lote y vencimiento incorrectos o faltantes: se piden ANTES de confirmar", async () => {
    const bad = async (module: "MP" | "ME", actor: typeof mp, lines: unknown[], code: string, remito: string) => {
      const r = await draft(module, actor, remito, lines);
      await expect((await svc()).confirm(actor as never, r.id, module, { expectedVersion: r.version, confirmKey: `k-${randomUUID()}` })).rejects.toMatchObject({ status: 422, code: "INVALID", details: { issues: expect.arrayContaining([expect.objectContaining({ code })]) } });
    };
    await bad("MP", mp, [mpLine({ quantity: "0" })], "QTY", `R-${RUN}-5a`);
    await bad("MP", mp, [mpLine({ quantity: "-3" })], "QTY", `R-${RUN}-5b`);
    await bad("MP", mp, [mpLine({ unit: "litros" })], "UNIT", `R-${RUN}-5c`);
    await bad("MP", mp, [mpLine({ lote: "" })], "LOTE", `R-${RUN}-5d`);
    await bad("MP", mp, [mpLine({ vencimiento: "" })], "VTO", `R-${RUN}-5e`);
    await bad("ME", dep, [meLine({ unit: "kg" })], "UNIT", `R-${RUN}-5f`);
    expect(await balance(MP_CODE)).toBe(150);
  });

  it("MP: conversión de unidades (g → kg) y «Sin vencimiento» explícito", async () => {
    const r = await draft("MP", mp, `R-${RUN}-6`, [mpLine({ quantity: "2500", unit: "g", vencimiento: "", noExpiry: true, lote: "LG-1" })]);
    await confirm("MP", mp, r);
    expect(await balance(MP_CODE)).toBe(152.5);
  });

  it("sin foto o PDF no se confirma (el comprobante es obligatorio)", async () => {
    const r = await draft("MP", mp, `R-${RUN}-7`, [mpLine()], { files: 0 });
    await rejects(confirm("MP", mp, r), 422, "INVALID");
    expect(await balance(MP_CODE)).toBe(152.5);
  });

  it("remito duplicado: advierte y exige reconocerlo; no se suma dos veces sin confirmación expresa", async () => {
    const remito = `R-${RUN}-8`;
    const first = await draft("ME", dep, remito, [meLine({ quantity: "300" })]);
    await confirm("ME", dep, first);
    const stock = await meStock(ME_CODE);
    const again = await draft("ME", dep, `R-${RUN}-008`, [meLine({ quantity: "300" })]); // mismo n.º con ceros a la izquierda
    const a = await (await svc()).analyze(dep as never, again.id, "ME");
    expect(a.warnings[0]).toMatchObject({ kind: "remito_exacto", requiresAck: true });
    await rejects(confirm("ME", dep, again), 409, "DUPLICATE");
    expect(await meStock(ME_CODE)).toBe(stock);
    // Reconocido expresamente → se carga (decisión consciente de la persona).
    await confirm("ME", dep, again, { acknowledgeDuplicates: true });
    expect(await meStock(ME_CODE)).toBe(stock + 300);
  });

  it("misma foto en otro remito: advertencia de archivo repetido", async () => {
    const s = await svc();
    const bytes = jpeg("misma");
    const a1 = await s.createDraft(mp as never, "MP");
    await s.addFile(mp as never, a1.id, "MP", { fileName: "x.jpg", bytes });
    const d1 = await s.saveDraft(mp as never, a1.id, "MP", { expectedVersion: a1.version, header: header(`R-${RUN}-9a`), lines: [mpLine({ lote: "LF-1" })] });
    await confirm("MP", mp, d1);
    const a2 = await s.createDraft(mp as never, "MP");
    await s.addFile(mp as never, a2.id, "MP", { fileName: "y.jpg", bytes });
    const d2 = await s.saveDraft(mp as never, a2.id, "MP", { expectedVersion: a2.version, header: header(`R-${RUN}-9b`), lines: [mpLine({ lote: "LF-2" })] });
    const an = await s.analyze(mp as never, d2.id, "MP");
    expect(an.warnings.some((w) => w.kind === "archivo_repetido" && w.requiresAck)).toBe(true);
    await rejects(confirm("MP", mp, d2), 409, "DUPLICATE");
  });

  it("recepción parcial legítima del mismo remito: no se bloquea, queda vinculada y el stock suma lo efectivamente recibido", async () => {
    const remito = `R-${RUN}-10`;
    const before = await balance(MP_CODE2);
    const first = await draft("MP", mp, remito, [mpLine({ materialCode: MP_CODE2, quantity: "60", remitoQuantity: "100", lote: "LP-1" })]);
    const c1 = await confirm("MP", mp, first);
    expect(c1.confirmedLines[0]).toMatchObject({ quantity: 60, remitoQuantity: 100 });
    const second = await draft("MP", mp, remito, [mpLine({ materialCode: MP_CODE2, quantity: "40", remitoQuantity: "100", lote: "LP-2" })]);
    const a = await (await svc()).analyze(mp as never, second.id, "MP");
    expect(a.warnings).toHaveLength(1);
    expect(a.warnings[0]).toMatchObject({ kind: "remito_parcial", requiresAck: false });
    const c2 = await confirm("MP", mp, second, { parentReceiptId: c1.id });
    expect(c2.parentReceiptId).toBe(c1.id);
    expect(await balance(MP_CODE2)).toBe(before + 100);
  });

  it("doble confirmación (misma clave) y reintentos: el stock se suma UNA sola vez; otra clave sobre lo ya confirmado se rechaza", async () => {
    const r = await draft("MP", mp, `R-${RUN}-11`, [mpLine({ quantity: "7", lote: "LD-1" })]);
    const before = await balance(MP_CODE);
    const s = await svc();
    const key = `k-${randomUUID()}`;
    const first = await s.confirm(mp as never, r.id, "MP", { expectedVersion: r.version, confirmKey: key });
    const replay = await s.confirm(mp as never, r.id, "MP", { expectedVersion: r.version, confirmKey: key });
    expect(replay.id).toBe(first.id);
    expect(replay.confirmedLines.map((l) => l.ingresoId)).toEqual(first.confirmedLines.map((l) => l.ingresoId));
    expect(await balance(MP_CODE)).toBe(before + 7);
    await rejects(s.confirm(mp as never, r.id, "MP", { expectedVersion: r.version, confirmKey: `k-${randomUUID()}` }), 409, "ALREADY_CONFIRMED");
    expect(await balance(MP_CODE)).toBe(before + 7);
    expect(await movements(MP_CODE)).toBeGreaterThan(0);
  });

  it("solicitudes simultáneas sobre el mismo borrador (MP y ME): suma una sola vez", async () => {
    const s = await svc();
    const rm = await draft("MP", mp, `R-${RUN}-12`, [mpLine({ quantity: "11", lote: "LC-1" })]);
    const beforeMp = await balance(MP_CODE);
    const keyM = `k-${randomUUID()}`;
    const resM = await Promise.allSettled([
      ...Array.from({ length: 4 }, () => s.confirm(mp as never, rm.id, "MP", { expectedVersion: rm.version, confirmKey: keyM })),
      ...Array.from({ length: 2 }, () => s.confirm(mp2 as never, rm.id, "MP", { expectedVersion: rm.version, confirmKey: `k-${randomUUID()}` })),
    ]);
    expect(resM.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await balance(MP_CODE)).toBe(beforeMp + 11);
    expect((await q("select count(*)::int n from inv_mp_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-12`]))[0]!.n).toBe(1);

    const re = await draft("ME", dep, `R-${RUN}-13`, [meLine({ quantity: "90" })]);
    const beforeMe = await meStock(ME_CODE);
    const keyE = `k-${randomUUID()}`;
    const resE = await Promise.allSettled(Array.from({ length: 5 }, () => s.confirm(dep as never, re.id, "ME", { expectedVersion: re.version, confirmKey: keyE })));
    expect(resE.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await meStock(ME_CODE)).toBe(beforeMe + 90);
    expect((await q("select count(*)::int n from inv_me_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-13`]))[0]!.n).toBe(1);
  });

  it("dos usuarios cargando el MISMO remito a la vez (borradores distintos): solo uno entra sin reconocer el duplicado", async () => {
    const s = await svc();
    const remito = `R-${RUN}-14`;
    const d1 = await draft("MP", mp, remito, [mpLine({ quantity: "13", lote: "LU-1" })]);
    const d2 = await draft("MP", mp2, remito, [mpLine({ quantity: "13", lote: "LU-1" })]);
    const before = await balance(MP_CODE);
    const res = await Promise.allSettled([
      s.confirm(mp as never, d1.id, "MP", { expectedVersion: d1.version, confirmKey: `k-${randomUUID()}` }),
      s.confirm(mp2 as never, d2.id, "MP", { expectedVersion: d2.version, confirmKey: `k-${randomUUID()}` }),
    ]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((x) => x.status === "rejected")[0]).toMatchObject({ reason: { status: 409, code: "DUPLICATE" } });
    expect(await balance(MP_CODE)).toBe(before + 13);
  });

  it("todo-o-nada: si una línea falla en el inventario, NO queda ni el ingreso de la otra, ni stock, y el borrador sigue pudiendo confirmarse", async () => {
    // La línea 2 choca con un ingreso previo idéntico (regla de duplicados de las planillas) → falla DESPUÉS de crear la línea 1.
    const { runMpInventoryOp } = await import("@/lib/inventory/mp-planilla-db");
    await runMpInventoryOp(mp as never, ({ service }) => service.upsertMpIngreso(mp as never, { fecha: tomorrow(), remitoNro: `R-${RUN}-15`, codigo: MP_CODE2, lote: "LX-9", cantidad: 5, proveedor: "Otro proveedor", descripcion: "x" }));
    const beforeA = await balance(MP_CODE);
    const beforeB = await balance(MP_CODE2);
    const r = await draft("MP", mp, `R-${RUN}-15`, [mpLine({ quantity: "9", lote: "LX-1" }), mpLine({ materialCode: MP_CODE2, quantity: "5", lote: "LX-9" })]);
    await expect(confirm("MP", mp, r)).rejects.toMatchObject({ code: "REJECTED_BY_INVENTORY" });
    expect(await balance(MP_CODE)).toBe(beforeA);
    expect(await balance(MP_CODE2)).toBe(beforeB);
    expect((await q("select count(*)::int n from inv_mp_ingresos where payload->>'codigo' = $1 and payload->>'lote' = 'LX-1'", [MP_CODE]))[0]!.n).toBe(0);
    expect((await q("select status from inventory_receipts where id = $1", [r.id]))[0]!.status).toBe("BORRADOR");
  });

  it("error al subir la imagen: no queda archivo ni referencia, y la confirmación sigue exigiendo comprobante", async () => {
    const s = await svc();
    const r = await s.createDraft(mp as never, "MP");
    const { getFileStorage } = await import("@/lib/storage/file-storage");
    const storage = getFileStorage();
    const original = storage.put.bind(storage);
    storage.put = async () => {
      throw new Error("Blob caído");
    };
    try {
      await expect(s.addFile(mp as never, r.id, "MP", { fileName: "x.jpg", bytes: jpeg("falla") })).rejects.toThrow();
    } finally {
      storage.put = original;
    }
    expect((await q("select count(*)::int n from inventory_ingreso_adjuntos where receipt_id = $1", [r.id]))[0]!.n).toBe(0);
    // Archivos inválidos (formato, firma, tamaño, vacío) se rechazan.
    await rejects(s.addFile(mp as never, r.id, "MP", { fileName: "x.exe", bytes: jpeg() }), 400);
    await rejects(s.addFile(mp as never, r.id, "MP", { fileName: "x.jpg", bytes: new Uint8Array([1, 2, 3, 4]) }), 400);
    await rejects(s.addFile(mp as never, r.id, "MP", { fileName: "x.jpg", bytes: new Uint8Array() }), 400);
    await rejects(s.addFile(mp as never, r.id, "MP", { fileName: "x.jpg", bytes: new Uint8Array(4 * 1024 * 1024 + 10).fill(0xff) }), 400);
    const sameBytes = jpeg("repetida");
    const f1 = await s.addFile(mp as never, r.id, "MP", { fileName: "a.jpg", bytes: sameBytes });
    const f2 = await s.addFile(mp as never, r.id, "MP", { fileName: "b.jpg", bytes: sameBytes });
    expect(f2.id).toBe(f1.id); // mismo archivo en el mismo remito: no se duplica
  });

  it("lectura automática: desactivada por defecto (carga manual igual); error del servicio no rompe; la sugerencia no se confirma sola", async () => {
    const { ReceiptService } = await lib();
    const off = new ReceiptService();
    expect(off.config().available).toBe(false);
    const r0 = await draft("MP", mp, `R-${RUN}-16`, [], { files: 1 });
    const res0 = await off.extract(mp as never, r0.id, "MP");
    expect(res0).toMatchObject({ applied: false });
    expect(res0.message).toMatch(/no está activada/);

    const failing = new ReceiptService({ extractionConfig: () => ({ available: true, provider: "gemini", model: "m", code: "ok", reason: "" }), extract: async () => ({ ok: false, kind: "unavailable", message: "Servicio caído" }) });
    const res1 = await failing.extract(mp as never, r0.id, "MP");
    expect(res1).toMatchObject({ applied: false, message: "Servicio caído" });

    const readerFor = (supplierCode: string) => new ReceiptService({
      extractionConfig: () => ({ available: true, provider: "gemini", model: "m", code: "ok", reason: "" }),
      extract: async () => ({
        ok: true, provider: "gemini:test",
        data: { supplier: `Proveedor IT ${RUN} SA`, remitoNumber: `R-${RUN}-16`, remitoDate: "2026-10-01", notes: "", headerReview: [], lines: [{ supplierCode, description: "Glicerina", quantity: "20", unit: "kg", packages: "", lote: "LE-1", vencimiento: "", notes: "", review: ["vencimiento"] }] },
      }),
    });
    const ok = readerFor("NUEVO-1"); // código del proveedor nunca usado antes → sin material pre-seleccionado
    const res2 = await ok.extract(mp as never, r0.id, "MP");
    expect(res2.applied).toBe(true);
    expect(res2.receipt.draft.lines[0]).toMatchObject({ description: "Glicerina", quantity: "20", materialCode: "" });
    expect(res2.receipt.draft.lines[0]!.review).toEqual(expect.arrayContaining(["vencimiento", "materialCode"])); // sin material inequívoco: queda marcado «Revisar»
    expect(res2.receipt.draft.header.remitoDate).toBe(tomorrow()); // lo que ya escribió la persona no se pisa
    expect(res2.receipt.status).toBe("BORRADOR");
    expect(await q("select 1 from inv_mp_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-16`])).toHaveLength(0);
    // Sin elegir el material ni vencimiento, no se puede confirmar.
    await rejects(confirm("MP", mp, res2.receipt), 422, "INVALID");
    // Un uso previo confirmado (mismo proveedor + mismo código) pre-selecciona el material en una lectura posterior.
    const r3 = await draft("MP", mp, `R-${RUN}-17`, [], { files: 1 });
    const res3 = await readerFor("AB-77").extract(mp as never, r3.id, "MP"); // AB-77 ya se usó (test 1) con este proveedor
    expect(res3.receipt.draft.lines[0]!.materialCode).toBe(MP_CODE);
  });

  it("lectura automática (Gemini simulado): completa encabezado y TODAS las líneas, elige el material solo si es inequívoco, no pisa lo manual y no mueve stock", async () => {
    const { ReceiptService } = await lib();
    const svcRead = new ReceiptService({
      extractionConfig: () => ({ available: true, provider: "gemini", model: "m", code: "ok", reason: "" }),
      extract: async () => ({
        ok: true, provider: "gemini:test",
        data: {
          supplier: `Proveedor IT ${RUN} SA`, remitoNumber: `R-${RUN}-30`, remitoDate: "2026-10-15", notes: "Entrega 1 de 2", headerReview: [],
          lines: [
            { supplierCode: "NUEVO-9", description: "Glicerina vegetal USP bidón x 25 kg", quantity: "250", unit: "kg", packages: "10", lote: "LG-9", vencimiento: "2029-01-31", notes: "", review: [] },
            { supplierCode: "ZZ-2", description: "Insumo sin identificar", quantity: "40", unit: "kg", packages: "", lote: "", vencimiento: "", notes: "", review: ["lote", "vencimiento"] },
            { supplierCode: MP_CODE, description: "glicerina", quantity: "5", unit: "kg", packages: "", lote: "LG-10", vencimiento: "2029-02-28", notes: "", review: [] },
          ],
        },
      }),
    });
    const r0 = await draft("MP", mp, "", [], { files: 1, header: { supplier: "", remitoNumber: "", remitoDate: "" } });
    const stockBefore = await balance(MP_CODE);
    const res = await svcRead.extract(mp as never, r0.id, "MP");
    expect(res).toMatchObject({ applied: true, kind: "ok", message: "Remito analizado. Revisá los datos antes de confirmar." });
    const d = res.receipt.draft;
    expect(d.header).toMatchObject({ supplier: `Proveedor IT ${RUN} SA`, remitoNumber: `R-${RUN}-30`, remitoDate: "2026-10-15", notes: "Entrega 1 de 2" });
    expect(d.header.receivedDate).toBeTruthy(); // la fecha de recepción sigue siendo aparte
    expect(d.lines).toHaveLength(3); // una línea por renglón del remito
    expect(d.lines[0]).toMatchObject({ materialCode: MP_CODE, matchSource: "nombre", quantity: "250", unit: "kg", packages: "10", lote: "LG-9", vencimiento: "2029-01-31", supplierCode: "NUEVO-9" });
    expect(d.lines[1]).toMatchObject({ materialCode: "", matchSource: "" }); // ambiguo/insuficiente: no se elige
    expect(d.lines[1]!.review).toEqual(expect.arrayContaining(["lote", "vencimiento", "materialCode"]));
    expect(d.lines[2]).toMatchObject({ materialCode: MP_CODE, matchSource: "codigo" }); // el código impreso es un código interno exacto
    // Al mismo tiempo devuelve las sugerencias para que la pantalla las muestre sin pedir nada más.
    expect(res.analysis).toBeTruthy();
    expect(Array.isArray(res.analysis!.suggestions[d.lines[1]!.id])).toBe(true);
    expect(res.analysis!.suggestions[d.lines[0]!.id]!.map((x) => x.code)).toContain(MP_CODE);
    expect(res.analysis!.validation.ok).toBe(false); // falta elegir material, lote y vencimiento de la línea 2
    // La lectura no tocó nada de inventario.
    expect(await balance(MP_CODE)).toBe(stockBefore);
    expect(await q("select 1 from inv_mp_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-30`])).toHaveLength(0);
    // Una segunda lectura NO pisa lo que la persona ya modificó (encabezado ni líneas).
    const edited = await svcRead.saveDraft(mp as never, r0.id, "MP", { expectedVersion: res.receipt.version, header: { ...d.header, supplier: "Proveedor corregido a mano" }, lines: d.lines.map((l, i) => (i === 0 ? { ...l, quantity: "260" } : l)) });
    const again = await svcRead.extract(mp as never, r0.id, "MP");
    expect(again.applied).toBe(true);
    expect(again.message).toMatch(/no se tocaron/);
    expect(again.receipt.draft.header.supplier).toBe("Proveedor corregido a mano");
    expect(again.receipt.draft.lines[0]!.quantity).toBe("260");
    expect(again.receipt.version).toBeGreaterThan(edited.version);
    // Sin elegir el material de la línea 2 (ni lote/vencimiento) la confirmación sigue bloqueada.
    await rejects(confirm("MP", mp, again.receipt), 422, "INVALID");
    expect(await balance(MP_CODE)).toBe(stockBefore);
  });

  it("lectura automática: un fallo se informa con el motivo y deja el borrador intacto (Reintentar funciona)", async () => {
    const { ReceiptService } = await lib();
    let calls = 0;
    const flaky = new ReceiptService({
      extractionConfig: () => ({ available: true, provider: "gemini", model: "m", code: "ok", reason: "" }),
      extract: async () => {
        calls++;
        if (calls === 1) return { ok: false as const, kind: "unreadable" as const, message: "No pudimos interpretar automáticamente este remito. Podés reintentar o completar los datos manualmente." };
        return { ok: true as const, provider: "gemini:test", data: { supplier: `Proveedor IT ${RUN} SA`, remitoNumber: `R-${RUN}-31`, remitoDate: "", notes: "", headerReview: ["remitoDate"], lines: [{ supplierCode: "", description: "Alcohol cetilico", quantity: "10", unit: "kg", packages: "", lote: "", vencimiento: "", notes: "", review: ["lote", "vencimiento"] }] } };
      },
    });
    const r = await draft("MP", mp, "", [], { files: 1, header: { supplier: "", remitoNumber: "", remitoDate: "" } });
    const first = await flaky.extract(mp as never, r.id, "MP");
    expect(first).toMatchObject({ applied: false, kind: "unreadable" });
    expect(first.message).toMatch(/reintentar o completar los datos manualmente/);
    expect(first.receipt.draft.extraction).toMatchObject({ ok: false });
    expect(first.receipt.draft.lines).toHaveLength(0);
    const retry = await flaky.extract(mp as never, r.id, "MP");
    expect(retry.applied).toBe(true);
    expect(retry.receipt.draft.lines[0]).toMatchObject({ materialCode: MP_CODE2, matchSource: "nombre" });
    expect(retry.receipt.draft.extraction).toMatchObject({ ok: true, note: "Revisar: remitoDate" });
  });

  it("consulta posterior: la recepción confirmada se lee con quién, cuándo, líneas, archivos y movimiento; el historial la lista", async () => {
    const s = await svc();
    const list = await s.list(prod as never, "MP");
    expect(list.every((x) => x.status === "CONFIRMADO")).toBe(true);
    const target = list.find((x) => x.remitoNumber === `R-${RUN}-1`)!;
    expect(target).toMatchObject({ supplier: `Proveedor IT ${RUN} SA`, lineCount: 1, fileCount: 1 });
    const got = await s.get(prod as never, target.id, "MP");
    expect(got.confirmedBy).toBe(mp.email);
    expect(got.confirmedAt).toBeTruthy();
    expect(got.confirmedLines[0]!.ingresoNro).toMatch(/^MP-I-/);
    expect(got.movements.length).toBeGreaterThan(0);
    // Un borrador ajeno no se ve desde un sector que solo supervisa.
    const dr = await s.createDraft(mp as never, "MP");
    await rejects(s.get(prod as never, dr.id, "MP"), 403);
    expect((await s.list(prod as never, "MP")).some((x) => x.id === dr.id)).toBe(false);
    expect((await s.list(mp as never, "MP")).some((x) => x.id === dr.id)).toBe(true);
  });

  it("editar/agregar fotos de un ingreso confirmado NO genera otro movimiento ni toca el stock; el comprobante original no se quita", async () => {
    const list = await (await svc()).list(mp as never, "MP");
    const target = await (await svc()).get(mp as never, list.find((x) => x.remitoNumber === `R-${RUN}-1`)!.id, "MP");
    const ingresoId = target.confirmedLines[0]!.ingresoId;
    const before = JSON.stringify([await balance(MP_CODE), await movements(MP_CODE), (await q("select payload from inv_mp_ingresos where id = $1", [ingresoId]))[0]!.payload]);
    const { getIngresoAdjuntosService } = await import("@/lib/inventory/ingreso-adjuntos-service");
    const a = getIngresoAdjuntosService();
    const extra = await a.upload(mp as never, { module: "MP", ingresoId, fileName: "extra.jpg", contentType: "image/jpeg", bytes: jpeg("extra") });
    expect((await a.list(mp as never, "MP", ingresoId)).length).toBe(2);
    await a.remove(mp as never, extra.id); // una foto agregada después sí se puede quitar
    const original = target.files[0]!;
    await rejects(a.remove(mp as never, original.id), 400);
    await rejects((await svc()).removeFile(mp as never, target.id, "MP", original.id), 409);
    expect(JSON.stringify([await balance(MP_CODE), await movements(MP_CODE), (await q("select payload from inv_mp_ingresos where id = $1", [ingresoId]))[0]!.payload])).toBe(before);
  });

  it("permisos por sector, verificados en el servidor", async () => {
    const s = await svc();
    await rejects(s.createDraft(prod as never, "MP"), 403);
    await rejects(s.createDraft(prod as never, "ME"), 403);
    await rejects(s.createDraft(dep as never, "MP"), 403); // Depósito no registra materias primas
    await rejects(s.createDraft(mp as never, "ME"), 403); // Materia Prima no registra envases
    const dm = await s.createDraft(mp as never, "MP");
    await rejects(s.saveDraft(dep as never, dm.id, "MP", { expectedVersion: dm.version, header: {}, lines: [] }), 403);
    await rejects(s.get(dep as never, dm.id, "ME"), 403); // un id de MP consultado como ME
    await rejects(s.addFile(prod as never, dm.id, "MP", { fileName: "a.jpg", bytes: jpeg() }), 403);
    await rejects(s.confirm(prod as never, dm.id, "MP", { expectedVersion: dm.version, confirmKey: "abcdefgh12" }), 403);
    await rejects(s.catalog(mkActor("CODIFICADO", "cod") as never, "MP", ""), 403);
    // Dirección supervisa y puede registrar en ambos; Producción puede leer el catálogo y el historial.
    expect((await s.catalog(prod as never, "MP", MP_CODE)).map((c) => c.code)).toContain(MP_CODE);
    expect((await s.catalog(dir as never, "ME", ME_CODE)).map((c) => c.code)).toContain(ME_CODE);
    await expect(s.createDraft(dir as never, "ME")).resolves.toBeTruthy();
    // Un usuario de otro sector no puede confirmar un borrador de un sector sin permiso.
    const dr = await draft("MP", mp, `R-${RUN}-18`, [mpLine({ lote: "LS-1" })]);
    await rejects(confirm("MP", dep, dr), 403);
    await rejects(confirm("ME", dep, dr), 403); // ni usando el otro módulo
  });

  it("catálogo: solo materiales existentes (MP: libro mayor/stock; ME: Depósito); se puede buscar por código o descripción", async () => {
    const s = await svc();
    expect((await s.catalog(mp as never, "MP", "glicerina")).map((c) => c.code)).toContain(MP_CODE);
    expect((await s.catalog(dep as never, "ME", "tapa")).map((c) => c.code)).toEqual([ME_CODE2]);
    expect((await s.catalog(dep as never, "ME", "no-existe-zzz"))).toEqual([]);
    const c = (await s.catalog(dep as never, "ME", ME_CODE))[0]!;
    expect(c).toMatchObject({ unit: "u", description: "FRASCO PET 250 ML" });
  });

  it("stock histórico preservado: ingresos y lotes anteriores no cambian al confirmar una recepción nueva", async () => {
    const legacy = (await q("select id, payload from inv_mp_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-1`]))[0]!;
    const snapshot = JSON.stringify([legacy.payload, (await q("select payload from inv_me_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-3`]))[0]!.payload]);
    const r = await draft("MP", mp, `R-${RUN}-19`, [mpLine({ quantity: "3", lote: "LH-1" })]);
    await confirm("MP", mp, r);
    const r2 = await draft("ME", dep, `R-${RUN}-20`, [meLine({ quantity: "5" })]);
    await confirm("ME", dep, r2);
    expect(JSON.stringify([(await q("select payload from inv_mp_ingresos where id = $1", [legacy.id]))[0]!.payload, (await q("select payload from inv_me_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-3`]))[0]!.payload])).toBe(snapshot);
  });

  it("borrador: versión optimista, descartar y que un descartado no se confirme", async () => {
    const s = await svc();
    const r = await s.createDraft(mp as never, "MP");
    const saved = await s.saveDraft(mp as never, r.id, "MP", { expectedVersion: r.version, header: header(`R-${RUN}-21`), lines: [mpLine()] });
    await rejects(s.saveDraft(mp2 as never, r.id, "MP", { expectedVersion: r.version, header: header("otro"), lines: [] }), 409, "CONFLICT");
    await s.addFile(mp as never, r.id, "MP", { fileName: "a.jpg", bytes: jpeg() });
    await s.discard(mp as never, r.id, "MP");
    await rejects(s.confirm(mp as never, r.id, "MP", { expectedVersion: saved.version, confirmKey: `k-${randomUUID()}` }), 409, "DISCARDED");
    await rejects(s.addFile(mp as never, r.id, "MP", { fileName: "b.jpg", bytes: jpeg() }), 409);
    expect(await q("select 1 from inv_mp_ingresos where payload->>'remitoNro' = $1", [`R-${RUN}-21`])).toHaveLength(0);
  });
});
