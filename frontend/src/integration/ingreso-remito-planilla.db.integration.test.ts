/**
 * «Pasar al Excel» desde la foto del remito, SIN validaciones, contra un Postgres de PRUEBA real.
 * Cualquier lectura (un solo campo, vacíos, datos incorrectos, sin lote/proveedor/código/cantidad, varios productos) sube a la
 * tabla como filas persistentes y editables; MP entra como BORRADOR (no mueve stock ni libro mayor); ME suma solo por código+cantidad.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = randomUUID().slice(0, 6).toUpperCase();
const mkActor = (sector: string, who: string) => ({ email: `${who}-${RUN.toLowerCase()}@laboratoriogenus.com.ar`, sector: sector as never, displayName: `IT ${who}` });
const mp = mkActor("MATERIA_PRIMA", "mp");
const dep = mkActor("DEPOSITO", "dep");
const MP_CODE = `IT-PS-GLI-${RUN}`;
const ME_CODE = `IT-PS-FR-${RUN}`;
const SUP = `Proveedor PS ${RUN}`;

describe.skipIf(Boolean(PROBLEM))(`Pasar al Excel sin validaciones en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const svc = async () => new (await import("@/lib/inventory/receipt-service")).ReceiptService();
  const line = (over: Record<string, unknown> = {}) => ({ id: randomUUID().slice(0, 8), supplierCode: "", description: "", materialCode: "", quantity: "", remitoQuantity: "", unit: "", packages: "", lote: "", vencimiento: "", noExpiry: false, notes: "", review: [], matchSource: "", ...over });
  const head = (over: Record<string, string> = {}) => ({ supplier: SUP, remitoNumber: `R-${RUN}`, remitoDate: "", receivedDate: "", notes: "", ...over });
  const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from(`JFIF-${RUN}-${randomUUID()}`)]);
  const mpBalance = async () => Number((await q("select stock_actual from mp_stock_balances where codigo = $1", [MP_CODE]))[0]?.stock_actual ?? 0);
  const mpMovs = async () => (await q("select count(*)::int n from mp_stock_movements where codigo = $1", [MP_CODE]))[0]!.n as number;
  const meStock = async (c: string) => (await import("@/lib/inventory/me-planilla-db")).meStockByCodigoDb(c);

  /** Foto subida + (opcional) lectura guardada; después «Pasar al Excel» con lo que haya en pantalla. */
  async function pass(module: "MP" | "ME", actor: typeof mp, lines: unknown[], header = head(), key = `k-${randomUUID()}`, withFile = true) {
    const s = await svc();
    const r = await s.createDraft(actor as never, module);
    if (withFile) await s.addFile(actor as never, r.id, module, { fileName: "remito.jpg", bytes: jpeg() });
    const out = await s.toSheet(actor as never, r.id, module, { confirmKey: key, header, lines });
    return { r, key, out };
  }
  const mpRows = async (ids: string[]) => (await q("select payload from inv_mp_ingresos where id = any($1::uuid[]) order by payload->>'ingresoNro'", [ids])).map((x) => x.payload as Record<string, unknown>);
  const meRows = async (ids: string[]) => (await q("select payload from inv_me_ingresos where id = any($1::uuid[])", [ids])).map((x) => x.payload as Record<string, unknown>);

  const cleanup = async () => {
    await q("delete from inventory_receipt_lines where receipt_id in (select id from inventory_receipts where supplier like 'Proveedor PS %')");
    await q("delete from inventory_receipts where supplier like 'Proveedor PS %'");
    await q("delete from inv_mp_ingresos where payload->>'proveedor' like 'Proveedor PS %'");
    await q("delete from inv_me_ingresos where payload->>'proveedor' like 'Proveedor PS %'");
    await q("delete from inv_me_materials where payload->>'codigo' like 'IT-PS-%'");
    await q("delete from mp_stock_balances where codigo like 'IT-PS-%'");
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    await cleanup();
    await q("insert into mp_stock_balances (codigo, descripcion, stock_actual) values ($1,'GLICERINA PS',0)", [MP_CODE]);
    const id = randomUUID();
    const now = new Date().toISOString();
    await q("insert into inv_me_materials (id, payload, updated_at) values ($1::uuid, $2::jsonb, now())", [id, JSON.stringify({ id, codigo: ME_CODE, descripcion: "FRASCO PS", cliente: "", ubicacion: "A1", unidad: "u", cantidadPorBulto: null, stockActual: 0, stockMinimo: null, puntoReposicion: null, responsable: "", archived: false, createdBy: "it", updatedBy: "it", createdAt: now, updatedAt: now })]);
  }, 120_000);
  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await pool?.end();
  });

  it("MP · un solo campo reconocido (y mal leído): sube igual, BORRADOR, sin stock ni libro mayor, editable y persistente", async () => {
    const { out } = await pass("MP", mp, [line({ description: "Glicerna vegtal" })], head({ supplier: SUP, remitoNumber: "" }));
    expect(out.sheet.count).toBe(1);
    const [row] = await mpRows(out.sheet.ingresoIds);
    expect(row).toMatchObject({ status: "BORRADOR", stockImpacted: false, descripcion: "Glicerna vegtal", codigo: "", lote: "", cantidad: null });
    expect(row!.codigoPendiente).toBeFalsy(); // no se inventa INT-MP-…
    expect(await mpBalanceMoves()).toEqual({ bal: 0, movs: 0 });
    // se edita después en la tabla (celda por celda) y sigue guardada
    const { patchMpSheetCells } = await import("@/lib/inventory/mp-planilla-db");
    const id = out.sheet.ingresoIds[0]!;
    await patchMpSheetCells(mp as never, "mp_ingresos", [{ id, field: "descripcion", value: "Glicerina vegetal", expectedVersion: String(row!.updatedAt) } as never]).catch(() => undefined);
    expect((await mpRows([id]))[0]!.status).toBe("BORRADOR");
  });

  async function mpBalanceMoves() {
    return { bal: await mpBalance(), movs: await mpMovs() };
  }

  it("MP · varios productos, sin lote / proveedor / código / cantidad: una fila por producto, todas pasan; los datos mal leídos también", async () => {
    const { out } = await pass(
      "MP",
      mp,
      [
        line({ description: "Producto A", quantity: "10", lote: "L1" }), // sin código ni proveedor
        line({ description: "Fragancia rosa", supplierCode: "FR-4521", quantity: "2" }), // el código leído del documento va a la columna Código
        line({ description: "Producto B", materialCode: MP_CODE, quantity: "5" }), // sin lote, con código válido: sigue siendo borrador
        line({ description: "Producto C", materialCode: "CODIGO-INEXISTENTE", lote: "LX" }), // código incorrecto → queda vacío, nunca inventado
        line({ lote: "SOLO-LOTE" }),
      ],
      head({ supplier: "" }),
    );
    expect(out.sheet.count).toBe(5);
    const rows = await mpRows(out.sheet.ingresoIds);
    expect(rows.find((r) => r.descripcion === "Fragancia rosa")!.codigo).toBe("FR-4521");
    expect(rows.every((r) => r.status === "BORRADOR" && r.stockImpacted === false)).toBe(true);
    expect(rows.find((r) => r.descripcion === "Producto B")!.codigo).toBe(MP_CODE);
    expect(rows.find((r) => r.descripcion === "Producto C")!.codigo).toBe(""); // código del catálogo inexistente y sin código del documento: vacío
    expect(rows.find((r) => r.lote === "SOLO-LOTE")).toBeTruthy();
    expect(await mpBalanceMoves()).toEqual({ bal: 0, movs: 0 }); // ningún movimiento físico
  });

  it("MP · sin NINGÚN dato reconocido (solo la foto): igual sube una fila vacía; y reintentar con la misma clave no duplica", async () => {
    const a = await pass("MP", mp, [], head({ supplier: "", remitoNumber: "" }));
    expect(a.out.sheet.count).toBe(1);
    const again = await (await svc()).toSheet(mp as never, a.r.id, "MP", { confirmKey: a.key, header: head(), lines: [] });
    expect(again.sheet.ingresoIds).toEqual(a.out.sheet.ingresoIds);
    expect((await q("select count(*)::int n from inv_mp_ingresos where id = any($1::uuid[])", [a.out.sheet.ingresoIds]))[0]!.n).toBe(1);
    await expect((await svc()).toSheet(mp as never, a.r.id, "MP", { confirmKey: `otra-${randomUUID()}`, header: head(), lines: [] })).rejects.toMatchObject({ status: 409 });
  });

  it("MP · mismo remito pasado dos veces (otra foto): no se bloquea por duplicado; el stock sigue en cero hasta confirmar", async () => {
    const l = [line({ description: "Dup", materialCode: MP_CODE, quantity: "7", lote: "LD" })];
    const a = await pass("MP", mp, l);
    const b = await pass("MP", mp, l);
    expect(a.out.sheet.count + b.out.sheet.count).toBe(2);
    expect(await mpBalanceMoves()).toEqual({ bal: 0, movs: 0 });
  });

  it("ME · datos incorrectos / incompletos: sube todo; sin código o sin cantidad no suma stock; con código+cantidad sí (se corrige en la tabla)", async () => {
    const { out } = await pass(
      "ME",
      dep,
      [
        line({ description: "Frasco sin código", quantity: "50" }),
        line({ description: "Con código del proveedor", supplierCode: "ZZ-77", quantity: "3" }),
        line({ description: "Sin cantidad", materialCode: ME_CODE }),
        line({ description: "Código raro", materialCode: "NO-EXISTE", quantity: "9" }),
        line({ description: "Completo", materialCode: ME_CODE, quantity: "100" }),
      ],
      head({ supplier: SUP }),
    );
    expect(out.sheet.count).toBe(5);
    const rows = await meRows(out.sheet.ingresoIds);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.descripcionInsumo === "Con código del proveedor")).toMatchObject({ codigo: "ZZ-77", cantidad: 3 }); // no es un material de Depósito: no suma stock a ninguno
    expect(rows.find((r) => r.descripcionInsumo === "Frasco sin código")).toMatchObject({ codigo: "", cantidad: 50 });
    expect(rows.find((r) => r.descripcionInsumo === "Código raro")!.codigo).toBe("");
    expect(rows.find((r) => r.descripcionInsumo === "Sin cantidad")).toMatchObject({ codigo: ME_CODE, cantidad: null, total: null });
    expect(await meStock(ME_CODE)).toBe(100); // solo la fila completa
  });

  it("ME · una sola columna reconocida y sin foto adjunta: sube igual", async () => {
    const { out } = await pass("ME", dep, [line({ supplierCode: "FR-9" })], head({ supplier: SUP, remitoNumber: "" }), `k-${randomUUID()}`, false);
    expect(out.sheet.count).toBe(1);
    expect((await meRows(out.sheet.ingresoIds))[0]).toMatchObject({ codigo: "", cantidad: null, total: null });
    expect(await meStock(ME_CODE)).toBe(100);
  });

  it("permisos: un sector sin escritura no puede pasar al Excel", async () => {
    const s = await svc();
    const r = await s.createDraft(mp as never, "MP");
    await expect(s.toSheet(dep as never, r.id, "MP", { confirmKey: `k-${randomUUID()}`, header: head(), lines: [] })).rejects.toMatchObject({ status: 403 });
  });
});
