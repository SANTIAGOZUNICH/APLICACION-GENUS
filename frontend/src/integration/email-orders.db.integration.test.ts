/**
 * Pedidos desde email (piloto) en un Postgres de PRUEBA real, con un Gmail y una IA SIMULADOS (no hay conexión real a Google en este test).
 * Verifica: ≤10 correos, borradores sin crear pedidos, sin duplicar al re-analizar, hilo/OC existente → MODIFICACIÓN sin sobrescribir,
 * aprobación idempotente (también tras un corte y en paralelo), token cifrado, permisos, y que no se toque stock/trabajos/OE/entregas.
 * Se SALTA sin base local marcada.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLI = `CLIENTE MAIL ${RUN}`;
const PROD = `SHAMPOO MAIL ${RUN}`;
const prod = { email: `it-mail-prod-${RUN}@laboratoriogenus.com.ar`, sector: "PRODUCCION" } as never;
const deposito = { email: `it-mail-dep-${RUN}@laboratoriogenus.com.ar`, sector: "DEPOSITO" } as never;

type Msg = { id: string; threadId: string; from: string; subject: string; date: string | null; bodyText: string; links: string[]; attachments: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> };
const mkMsg = (n: number, over: Partial<Msg> = {}): Msg => ({ id: `m-${RUN}-${n}`, threadId: `t-${RUN}-${n}`, from: `compras@cliente${n}.com`, subject: `Pedido ${n}`, date: "2026-10-20T12:00:00.000Z", bodyText: "texto", links: [], attachments: [], ...over });

describe.skipIf(Boolean(PROBLEM))(`Pedidos desde email en Postgres real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let mod: typeof import("@/lib/email-orders/service");
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const inbox = new Map<string, Msg>();
  const aiFor = new Map<string, unknown>();
  let aiCalls = 0;
  const gateway = {
    accountEmail: async () => "pedidos@laboratoriogenus.com.ar",
    listRecent: async (o: { max: number }) => [...inbox.values()].slice(0, o.max).map((m) => ({ id: m.id, threadId: m.threadId })),
    getMessage: async (id: string) => inbox.get(id)!,
    getAttachment: async () => Buffer.from("%PDF-1.4"),
  };
  const ai = async (parts: Array<Record<string, unknown>>) => {
    aiCalls++;
    const text = parts.map((p) => String(p.text ?? "")).join("\n");
    const id = [...aiFor.keys()].find((k) => text.includes(`De: ${inbox.get(k)!.from}`));
    if (!id) return { ok: false as const, message: "sin respuesta simulada", kind: "x" };
    const v = aiFor.get(id);
    return v === "FAIL" ? { ok: false as const, message: "La IA falló", kind: "x" } : { ok: true as const, json: v, ms: 5 };
  };
  const catalog = { clients: async () => [CLI], products: async () => [PROD] };
  const order = (over: Record<string, unknown> = {}) => ({ kind: "pedido_nuevo", confidence: "alta", summary: "Pedido", cliente: CLI, nroPedido: `OC-${RUN}-1`, fechaSolicitud: "2026-10-20", fechaEntrega: "2026-11-10", observaciones: "", unclearFields: [], items: [{ producto: PROD, codigo: "", cantidad: 500, unidad: "un", presentacion: "250 ml", observaciones: "", unclearFields: [] }, { producto: "Producto raro", codigo: "", cantidad: 20, unidad: "un", presentacion: "", observaciones: "", unclearFields: [] }], ...over });
  const svc = (extra: Record<string, unknown> = {}) => new mod.EmailOrdersService({ gateway: async () => gateway as never, ai: ai as never, catalog, aiAvailable: () => ({ available: true, reason: "" }), ...extra });
  const count = async (sqlText: string) => Number((await q(sqlText))[0]!.n);
  const world = async () => JSON.stringify(await Promise.all(["work_items", "operational_orders", "mp_stock_movements", "inv_mp_stock", "inv_me_ingresos", "inv_me_salidas", "deliveries"].map(async (t) => [t, await count(`select count(*)::int n from ${t}`).catch(() => -1)])));

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    // El servicio de pedidos usa memoria bajo Vitest: acá se necesita el camino REAL de base de datos.
    vi.stubEnv("VITEST", "false");
    mod = await import("@/lib/email-orders/service");
  }, 60_000);

  afterAll(async () => {
    await q("delete from email_order_drafts where gmail_message_id like $1", [`m-${RUN}-%`]).catch(() => undefined);
    await q("delete from email_order_messages where gmail_message_id like $1", [`m-${RUN}-%`]).catch(() => undefined);
    await q("delete from production_pedidos where cliente = $1", [CLI]).catch(() => undefined);
    await q("delete from email_integrations where id = 'pedidos'").catch(() => undefined);
    await pool?.end();
  });

  it("conexión: solo la casilla autorizada, token CIFRADO en la base, desconectar lo borra; solo Producción", async () => {
    const s = svc({ revoke: async () => undefined });
    await expect(s.saveConnection(prod, { refreshToken: "1//tok", accountEmail: "otra@gmail.com", scope: "x" })).rejects.toThrow(/pedidos@laboratoriogenus.com.ar/);
    await expect(s.saveConnection(deposito, { refreshToken: "1//tok", accountEmail: "pedidos@laboratoriogenus.com.ar", scope: "x" })).rejects.toMatchObject({ status: 403 });
    await s.saveConnection(prod, { refreshToken: "1//token-secreto-123", accountEmail: "pedidos@laboratoriogenus.com.ar", scope: "https://www.googleapis.com/auth/gmail.readonly" });
    const row = (await q("select * from email_integrations where id = 'pedidos'"))[0]!;
    expect(row.status).toBe("conectado");
    expect(String(row.refresh_token_enc)).not.toContain("token-secreto-123");
    expect(JSON.stringify(row)).not.toContain("token-secreto-123");
    const st = await s.status(prod);
    expect(JSON.stringify(st)).not.toContain("token-secreto-123");
    expect(st.connected).toBe(true);
    await s.disconnect(prod);
    const after = (await q("select * from email_integrations where id = 'pedidos'"))[0]!;
    expect(after.refresh_token_enc).toBeNull();
    expect(after.status).toBe("desconectado");
    await s.saveConnection(prod, { refreshToken: "1//otra", accountEmail: "pedidos@laboratoriogenus.com.ar", scope: "gmail.readonly" });
  });

  it("analizar: máx. 10 correos, borradores SIN crear pedidos ni tocar stock/trabajos/OE/entregas; consulta sin borrador; error de IA registrado", async () => {
    for (let n = 1; n <= 12; n++) inbox.set(`m-${RUN}-${n}`, mkMsg(n));
    aiFor.set(`m-${RUN}-1`, order());
    aiFor.set(`m-${RUN}-2`, { kind: "consulta", confidence: "alta", summary: "pregunta precio", cliente: "", nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [] });
    aiFor.set(`m-${RUN}-3`, "FAIL");
    for (let n = 4; n <= 12; n++) aiFor.set(`m-${RUN}-${n}`, { kind: "no_relacionado", confidence: "alta", summary: "", cliente: "", nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [] });
    const pedidosAntes = await count("select count(*)::int n from production_pedidos");
    const before = await world();
    const r = await svc().analyze(prod, { max: 50 });
    expect(r.requested).toBe(10); // tope duro
    expect(r.drafts).toBe(1);
    expect(r.withoutOrder).toBe(8);
    expect(r.errors).toHaveLength(1);
    expect(await count("select count(*)::int n from production_pedidos")).toBe(pedidosAntes);
    expect(await world()).toBe(before);
    const d = (await svc().list(prod))[0]!;
    expect(d).toMatchObject({ kind: "NUEVO", status: "PENDIENTE", gmailMessageId: `m-${RUN}-1` });
    expect(d.payload.cliente).toBe(CLI);
    expect(d.payload.clienteMatched).toBe(true);
    expect(d.payload.items[0]).toMatchObject({ producto: PROD, productMatched: true, cantidad: 500, ml: 250 });
    expect(d.payload.items[1]).toMatchObject({ productMatched: false });
    expect(d.payload.items[1]!.doubts.join()).toMatch(/Producto/);
    expect(d.source).toMatchObject({ from: "compras@cliente1.com", subject: "Pedido 1" });
  });

  it("re-analizar el mismo correo no duplica (ID de Gmail) y reintenta solo los que fallaron", async () => {
    aiFor.set(`m-${RUN}-3`, { kind: "consulta", confidence: "media", summary: "", cliente: "", nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [] });
    const callsBefore = aiCalls;
    const r = await svc().analyze(prod, { max: 10 });
    expect(r.drafts).toBe(0);
    expect(r.alreadyProcessed).toBe(9);
    expect(r.withoutOrder).toBe(1); // el que antes falló ahora se resolvió
    expect(aiCalls - callsBefore).toBe(1); // los ya procesados no vuelven a la IA
    expect(await count(`select count(*)::int n from email_order_drafts where gmail_message_id like 'm-${RUN}-%'`)).toBe(1);
  });

  it("respuesta en el mismo hilo / misma OC → MODIFICACIÓN para revisión, sin sobrescribir ni crear nada", async () => {
    const reply = mkMsg(20, { threadId: `t-${RUN}-1`, from: "compras@cliente1.com", subject: "RE: Pedido 1" });
    inbox.clear();
    inbox.set(reply.id, reply);
    aiFor.clear();
    aiFor.set(reply.id, order({ kind: "modificacion", items: [{ producto: PROD, codigo: "", cantidad: 800, unidad: "un", presentacion: "250 ml", observaciones: "cambiar cantidad", unclearFields: [] }] }));
    const pedidosAntes = await count("select count(*)::int n from production_pedidos");
    await svc().analyze(prod, { max: 10 });
    expect(await count("select count(*)::int n from production_pedidos")).toBe(pedidosAntes);
    const mods = (await svc().list(prod)).filter((x) => x.gmailMessageId === reply.id);
    expect(mods).toHaveLength(1);
    expect(mods[0]).toMatchObject({ kind: "MODIFICACION" });
    expect(mods[0]!.related.draftIds).toHaveLength(1);
    await expect(svc().approve(prod, mods[0]!.id)).rejects.toMatchObject({ status: 409 });
    await svc().markReviewed(prod, mods[0]!.id);
    expect((await svc().list(prod)).some((x) => x.id === mods[0]!.id)).toBe(false);
    expect(await count("select count(*)::int n from production_pedidos")).toBe(pedidosAntes);
  });

  it("editar y aprobar: crea pedidos con el flujo existente (INGRESO, KG calculado), sin trabajos/OE/stock; aprobar dos veces o en paralelo crea UNA vez", async () => {
    const d = (await svc().list(prod)).find((x) => x.gmailMessageId === `m-${RUN}-1`)!;
    const edited = { ...d.payload, items: d.payload.items.map((i, n) => (n === 1 ? { ...i, producto: PROD, productMatched: true } : i)) };
    const upd = await svc().update(prod, d.id, { expectedVersion: d.version, payload: edited });
    expect(upd.wasEdited).toBe(true);
    await expect(svc().update(prod, d.id, { expectedVersion: d.version, payload: edited })).rejects.toMatchObject({ status: 409 });
    const before = await world();
    const [a, b] = await Promise.allSettled([svc().approve(prod, d.id), svc().approve(prod, d.id)]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await q("select * from production_pedidos where cliente = $1 order by q", [CLI]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ nro_oc: `OC-${RUN}-1`, producto: PROD, q: 20, estado: "INGRESO" });
    expect(rows[1]).toMatchObject({ q: 500, ml: 250, kg: 125, s: "250 ml", fecha: expect.anything() });
    expect(await world()).toBe(before); // ni trabajos, ni OE/OA, ni stock, ni entregas
    await expect(svc().approve(prod, d.id)).rejects.toMatchObject({ status: 409 });
    expect(await count("select count(*)::int n from production_pedidos where cliente = '" + CLI + "'")).toBe(2);
    const m = await svc().metrics();
    expect(m.aprobadosCorregidos).toBeGreaterThanOrEqual(1);
  });

  it("corte a mitad de la aprobación: queda pendiente con lo ya creado y el reintento solo crea lo que falta", async () => {
    const m = mkMsg(30);
    inbox.clear(); aiFor.clear();
    inbox.set(m.id, m);
    aiFor.set(m.id, order({ nroPedido: `OC-${RUN}-30`, items: [{ producto: PROD, cantidad: 10, presentacion: "100 ml", unclearFields: [] }, { producto: PROD, cantidad: 11, presentacion: "100 ml", unclearFields: [] }] }));
    await svc().analyze(prod, { max: 10 });
    const d = (await svc().list(prod)).find((x) => x.gmailMessageId === m.id)!;
    const { getProductionPedidosService } = await import("@/lib/production-pedidos/service");
    let n = 0;
    const flaky = svc({ createPedido: async (a: never, input: never) => { if (++n === 2) throw new Error("corte"); return getProductionPedidosService().create(a, input); } });
    await expect(flaky.approve(prod, d.id)).rejects.toThrow("corte");
    const mid = (await svc().list(prod)).find((x) => x.id === d.id)!;
    expect(mid.status).toBe("PENDIENTE");
    expect(mid.payload.items.filter((i) => i.createdPedidoId)).toHaveLength(1);
    expect(await count(`select count(*)::int n from production_pedidos where nro_oc = 'OC-${RUN}-30'`)).toBe(1);
    await svc().approve(prod, d.id);
    expect(await count(`select count(*)::int n from production_pedidos where nro_oc = 'OC-${RUN}-30'`)).toBe(2);
  });

  it("descartar no crea nada; Producción solamente; sin IA disponible no analiza", async () => {
    const m = mkMsg(40);
    inbox.clear(); aiFor.clear();
    inbox.set(m.id, m);
    aiFor.set(m.id, order({ nroPedido: `OC-${RUN}-40` }));
    await svc().analyze(prod, { max: 10 });
    const d = (await svc().list(prod)).find((x) => x.gmailMessageId === m.id)!;
    await expect(svc().discard(deposito, d.id, "x")).rejects.toMatchObject({ status: 403 });
    await expect(svc().list(deposito)).rejects.toMatchObject({ status: 403 });
    await svc().discard(prod, d.id, "duplicado");
    expect(await count(`select count(*)::int n from production_pedidos where nro_oc = 'OC-${RUN}-40'`)).toBe(0);
    await expect(svc({ aiAvailable: () => ({ available: false, reason: "sin clave" }) }).analyze(prod, {})).rejects.toMatchObject({ status: 409 });
  });
});
