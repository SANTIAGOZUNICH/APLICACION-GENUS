/**
 * Pedidos por email: SINCRONIZACIÓN REAL y estado verdadero — Postgres de PRUEBA con Gmail e IA SIMULADOS (no hay conexión real a Google acá).
 * Cubre: pedido en el cuerpo / Excel / PDF / asunto sin «pedido», correo que no es pedido, incertidumbre → borrador a revisar, error de Gemini
 * (no se marca procesado, se reintenta sin duplicar), error de acceso a Gmail (queda registrado, nunca «éxito»), sincronización repetida,
 * recuperación de correos anteriores (7/15/30 días), borrador visible para Producción y aprobación manual. Se SALTA sin base marcada.
 */
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertMarkedDatabase, e2eEnvironmentProblem } from "../../scripts/e2e/e2e-safety.mjs";

const PROBLEM = e2eEnvironmentProblem() ?? (process.env.GENUS_E2E_DATABASE_URL ? null : "falta GENUS_E2E_DATABASE_URL");
const RUN = Date.now().toString().slice(-6);
const CLI = `CLIENTE SYNC ${RUN}`;
const PROD = `SERUM VITAMINA C ${RUN}`;
const prod = { email: `it-sync-prod-${RUN}@laboratoriogenus.com.ar`, sector: "PRODUCCION" } as never;
const deposito = { email: `it-sync-dep-${RUN}@laboratoriogenus.com.ar`, sector: "DEPOSITO" } as never;
const OWN = "agzunich@gmail.com";
const TARGET = "pedidos@laboratoriogenus.com.ar";
const TOKEN = "1//token-secreto-sync-999";
type Hdr = Array<{ name: string; value: string }>;
const forwarded = (from: string): Hdr => [{ name: "Delivered-To", value: OWN }, { name: "X-Original-To", value: TARGET }, { name: "From", value: from }, { name: "To", value: `Pedidos <${TARGET}>` }];
type Att = { attachmentId: string; filename: string; mimeType: string; size: number };
type Msg = { headers: Hdr; id: string; threadId: string; from: string; subject: string; date: string | null; bodyText: string; links: string[]; attachments: Att[] };
let seq = 0;
const mk = (over: Partial<Msg> = {}): Msg => {
  const n = ++seq;
  const from = over.from ?? `compras${n}@cliente${n}.com`;
  return { headers: forwarded(from), id: `m-${RUN}-${n}`, threadId: `t-${RUN}-${n}`, from, subject: "Hola", date: new Date().toISOString(), bodyText: "texto", links: [], attachments: [], ...over };
};
const empty = { kind: "consulta", confidence: "alta", summary: "", cliente: "", nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [] };
const order = (qty = 1000, over: Record<string, unknown> = {}) => ({ kind: "pedido_nuevo", confidence: "alta", summary: "Pedido", cliente: CLI, nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [{ producto: PROD, codigo: "", cantidad: qty, unidad: "un", presentacion: "", observaciones: "", unclearFields: [] }], ...over });

describe.skipIf(Boolean(PROBLEM))(`Pedidos por email: sincronización real${PROBLEM ? ` — saltado: ${PROBLEM}` : ""}`, { timeout: 60_000 }, () => {
  let pool: import("@neondatabase/serverless").Pool;
  let mod: typeof import("@/lib/email-orders/service");
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as Record<string, unknown>[];
  const inbox = new Map<string, Msg>();
  const answers = new Map<string, unknown>();
  const files = new Map<string, Buffer>();
  const aiParts = new Map<string, Array<Record<string, unknown>>>();
  let aiDown = false;
  let gmailError: unknown = null;
  let lastList: { scan: number; afterDate?: string } | null = null;
  const gateway = {
    accountEmail: async () => { if (gmailError) throw gmailError; return OWN; },
    listCandidates: async (o: { scan: number; afterDate?: string }) => { lastList = o; if (gmailError) throw gmailError; return [...inbox.values()].slice(0, o.scan).map((m) => ({ id: m.id, threadId: m.threadId })); },
    getHeaders: async (id: string) => { const m = inbox.get(id)!; return { id, threadId: m.threadId, date: m.date, headers: m.headers }; },
    getMessage: async (id: string) => inbox.get(id)!,
    getAttachment: async (_id: string, attId: string) => files.get(attId) ?? Buffer.from("%PDF-1.4"),
  };
  const ai = async (parts: Array<Record<string, unknown>>) => {
    const text = parts.map((p) => String(p.text ?? "")).join("\n");
    const id = [...answers.keys()].find((k) => text.includes(`De: ${inbox.get(k)!.from}`));
    if (id) aiParts.set(id, parts);
    if (aiDown) return { ok: false as const, kind: "permission", message: "Gemini 403 PERMISSION_DENIED (simulado)" };
    if (!id) return { ok: false as const, kind: "x", message: "sin respuesta simulada" };
    return { ok: true as const, json: answers.get(id), ms: 5 };
  };
  const catalog = { clients: async () => [CLI], products: async () => [PROD] };
  const svc = () => new mod.EmailOrdersService({ gateway: async () => gateway as never, ai: ai as never, catalog, aiAvailable: () => ({ available: true, reason: "" }) });
  const put = (m: Msg, answer?: unknown) => { inbox.set(m.id, m); if (answer !== undefined) answers.set(m.id, answer); return m; };
  const reset = () => { inbox.clear(); answers.clear(); files.clear(); aiParts.clear(); aiDown = false; gmailError = null; lastList = null; };
  const count = async (t: string, where = "true") => Number((await q(`select count(*)::int n from ${t} where ${where}`))[0]!.n);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.GENUS_E2E_DATABASE_URL!;
    process.env.EMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    neonConfig.webSocketConstructor = (await import("ws")).default as never;
    pool = new Pool({ connectionString: process.env.GENUS_E2E_DATABASE_URL });
    await assertMarkedDatabase(q);
    vi.resetModules();
    vi.stubEnv("VITEST", "false");
    mod = await import("@/lib/email-orders/service");
    await svc().saveConnection(prod, { refreshToken: TOKEN, accountEmail: OWN, scope: "gmail.readonly" });
  });
  afterAll(async () => {
    await q("delete from email_order_drafts where gmail_message_id like $1", [`m-${RUN}-%`]).catch(() => undefined);
    await q("delete from email_order_messages where gmail_message_id like $1", [`m-${RUN}-%`]).catch(() => undefined);
    await q("delete from email_order_sync_runs where actor like 'it-sync-%' or actor = 'cron@genus-os'").catch(() => undefined);
    await q("delete from production_pedidos where cliente = $1", [CLI]).catch(() => undefined);
    await q("delete from email_integrations where id = 'pedidos'").catch(() => undefined);
    await pool?.end();
  });

  it("1, 4, 11) pedido escrito en el cuerpo, con un asunto SIN la palabra «pedido»: borrador visible para Producción y corrida con números reales", async () => {
    reset();
    const m = put(mk({ subject: "Consulta de Juan", bodyText: "Hola, necesitamos 1.000 unidades del serum de vitamina C" }), order(1000));
    const r = await svc().analyze(prod, {});
    expect(r).toMatchObject({ status: "ok", found: 1, analyzed: 1, drafts: 1, omitted: 0, alreadyProcessed: 0 });
    expect(r.errors).toEqual([]);
    const [d] = (await svc().list(prod)).filter((x) => x.gmailMessageId === m.id);
    expect(d).toMatchObject({ status: "PENDIENTE", kind: "NUEVO" });
    expect(d!.payload.items[0]).toMatchObject({ producto: PROD, cantidad: 1000, productMatched: true });
    expect(d!.payload).toMatchObject({ confidence: "alta", classification: "pedido_nuevo", uncertain: false });
    expect(d!.source).toMatchObject({ from: m.from, subject: "Consulta de Juan" }); // referencia al correo original
    expect(d!.gmailMessageId).toBe(m.id);
    // Solo Producción ve la bandeja
    await expect(svc().list(deposito)).rejects.toMatchObject({ status: 403 });
    // La corrida quedó registrada con lo que pasó de verdad
    const st = await svc().status(prod);
    expect(st.lastRun).toMatchObject({ status: "ok", found: 1, analyzed: 1, drafts: 1, omitted: 0, errors: 0, trigger: "manual" });
    expect(st.recent!.some((x) => x.id === m.id && x.outcome === "borrador")).toBe(true);
    expect(JSON.stringify(st)).not.toContain(TOKEN);
    // No se creó ningún pedido definitivo
    expect(await count("production_pedidos", `cliente = '${CLI}'`)).toBe(0);
  });

  it("2, 3) pedido con Excel adjunto y con PDF adjunto: la IA recibe el contenido y el borrador conserva los adjuntos", async () => {
    reset();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Producto", "Cantidad"], [PROD, 800]]), "Pedido noviembre");
    files.set("X1", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer);
    const xl = put(mk({ subject: "Adjunto planilla", bodyText: "Adjunto Excel con los productos y cantidades", attachments: [{ attachmentId: "X1", filename: "pedido.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 6000 }] }), order(800));
    const pdf = put(mk({ subject: "Te paso el pedido de noviembre adjunto", bodyText: "", attachments: [{ attachmentId: "P1", filename: "pedido-noviembre.pdf", mimeType: "application/pdf", size: 8 }] }), order(600));
    const r = await svc().analyze(prod, {});
    expect(r).toMatchObject({ status: "ok", drafts: 2, found: 2 });
    expect(JSON.stringify(aiParts.get(xl.id))).toContain("Pedido noviembre"); // el texto del Excel viajó a la IA
    expect(aiParts.get(pdf.id)!.some((p) => p.inline_data)).toBe(true); // el PDF viajó como archivo
    const drafts = await svc().list(prod);
    const dx = drafts.find((x) => x.gmailMessageId === xl.id)!;
    const dp = drafts.find((x) => x.gmailMessageId === pdf.id)!;
    expect(dx.source.attachments).toEqual([expect.objectContaining({ filename: "pedido.xlsx", used: true })]);
    expect(dp.source.attachments).toEqual([expect.objectContaining({ filename: "pedido-noviembre.pdf", used: true })]);
    expect(dp.payload.items[0]!.cantidad).toBe(600);
  });

  it("5) un correo que NO es pedido se omite con su motivo, y la corrida no dice «correcto»; con duda queda un borrador A REVISAR (sin inventar cantidades)", async () => {
    reset();
    const no = put(mk({ subject: "¿Precio del serum?", bodyText: "Quería saber el precio" }), { ...empty, kind: "consulta", confidence: "alta" });
    const r = await svc().analyze(prod, {});
    expect(r).toMatchObject({ status: "sin_borradores", found: 1, analyzed: 1, drafts: 0, omitted: 1 });
    expect(r.reason).toMatch(/No se creó ningún borrador.*1 sin pedido/);
    expect((await svc().list(prod)).some((d) => d.gmailMessageId === no.id)).toBe(false);
    expect((await svc().status(prod)).lastRun).toMatchObject({ status: "sin_borradores", drafts: 0 });
    // Incertidumbre: la IA duda entre consulta y pedido
    reset();
    const dud = put(mk({ subject: "Necesitamos repetir el último pedido", bodyText: "Necesitamos repetir el último pedido, pero esta vez 500 unidades" }), { ...empty, kind: "consulta", confidence: "baja", summary: "Pide repetir un pedido sin detalle" });
    const r2 = await svc().analyze(prod, {});
    expect(r2).toMatchObject({ status: "ok", drafts: 1 });
    const d = (await svc().list(prod)).find((x) => x.gmailMessageId === dud.id)!;
    expect(d.payload).toMatchObject({ uncertain: true, confidence: "baja" });
    expect(d.payload.items).toEqual([]); // no se inventó ninguna cantidad
    expect(d.payload.doubts.join(" ")).toMatch(/No se sabe con certeza si es un pedido/);
    // No se puede aprobar sin productos: Producción lo completa o lo descarta
    await expect(svc().approve(prod, d.id)).rejects.toThrow(/Falta|No hay productos/);
    await svc().discard(prod, d.id, "no era pedido");
  });

  it("6, 8) Gemini falla: el correo NO queda procesado ni se pierde, no hay borrador; al reintentar (sin duplicar) se crea UNO", async () => {
    reset();
    const m = put(mk({ subject: "Pedido urgente" }), order(300));
    aiDown = true;
    const r1 = await svc().analyze(prod, { retryErrorsAfterMs: 30 * 60_000 });
    expect(r1).toMatchObject({ status: "error", drafts: 0, found: 1 });
    expect(r1.errors).toHaveLength(1);
    expect(r1.errors[0]!.message).toMatch(/Gemini 403/);
    expect(r1.reason).toMatch(/fallaron al analizarse/);
    const msg = (await q("select outcome, error from email_order_messages where gmail_message_id = $1", [m.id]))[0]!;
    expect(msg.outcome).toBe("error");
    expect(String(msg.error)).toMatch(/Gemini 403/);
    expect(await count("email_order_drafts", `gmail_message_id = '${m.id}'`)).toBe(0);
    expect((await svc().status(prod)).lastRun).toMatchObject({ status: "error", errors: 1 });
    // El automático NO insiste en cada corrida (espera 30 min); el manual sí
    aiDown = false;
    const auto = await svc().analyze(prod, { retryErrorsAfterMs: 30 * 60_000 });
    expect(auto).toMatchObject({ drafts: 0, alreadyProcessed: 1 });
    const manual = await svc().analyze(prod, {});
    expect(manual).toMatchObject({ status: "ok", drafts: 1 });
    expect(await count("email_order_drafts", `gmail_message_id = '${m.id}'`)).toBe(1);
    // Sin IA disponible: error claro y queda en el historial
    const noAi = new mod.EmailOrdersService({ gateway: async () => gateway as never, ai: ai as never, catalog, aiAvailable: () => ({ available: false, reason: "falta GEMINI_API_KEY" }) });
    await expect(noAi.analyze(prod, {})).rejects.toThrow(/La lectura con IA no está disponible: falta GEMINI_API_KEY/);
    expect((await svc().status(prod)).lastRun).toMatchObject({ status: "error_ia" });
  });

  it("7) error de acceso a Gmail: mensaje claro, queda registrado y NUNCA aparece como sincronización exitosa; el token no se expone", async () => {
    reset();
    gmailError = Object.assign(new Error("invalid_grant: Token has been expired or revoked."), { code: 400 });
    await expect(svc().analyze(prod, {})).rejects.toThrow(/El acceso a Gmail venció o fue revocado: reconectá la cuenta/);
    const st = await svc().status(prod);
    expect(st.lastRun).toMatchObject({ status: "error_gmail", found: 0, drafts: 0 });
    expect(st.lastRun!.reason).toMatch(/reconectá la cuenta/);
    expect(st.lastError).toMatch(/reconectá/);
    expect(JSON.stringify(st)).not.toContain(TOKEN);
    expect(JSON.stringify(await q("select * from email_order_sync_runs order by started_at desc limit 1"))).not.toContain(TOKEN);
    // «Verificar conexión» hace una consulta real y devuelve el motivo
    const probe = await svc().checkConnection(prod);
    expect(probe).toMatchObject({ ok: false, reconnect: true });
    gmailError = null;
    inbox.set("x", mk({}));
    expect(await svc().checkConnection(prod)).toMatchObject({ ok: true, account: OWN, inboxSample: 1 });
    expect((await svc().status(prod)).lastError).toBeNull();
  });

  it("9) sincronización repetida sin duplicados; y sin correos en Gmail se explica por qué", async () => {
    reset();
    const m = put(mk({ subject: "Compra" }), order(100));
    expect(await svc().analyze(prod, {})).toMatchObject({ status: "ok", drafts: 1 });
    const again = await svc().analyze(prod, {});
    expect(again).toMatchObject({ status: "sin_borradores", drafts: 0, alreadyProcessed: 1, found: 1 });
    expect(again.reason).toMatch(/No se creó ningún borrador.*1 ya estaban procesado/);
    expect(await count("email_order_drafts", `gmail_message_id = '${m.id}'`)).toBe(1);
    reset();
    const none = await svc().analyze(prod, {});
    expect(none).toMatchObject({ status: "sin_correos", found: 0, drafts: 0 });
    expect(none.reason).toMatch(/Gmail no devolvió ningún correo/);
  });

  it("10) recuperación de correos anteriores (7/15/30 días): la ventana llega a Gmail, no duplica y no vuelve a importar lo aprobado", async () => {
    reset();
    const old = put(mk({ subject: "Compra de hace 10 días", date: new Date(Date.now() - 10 * 86_400_000).toISOString() }), order(250));
    for (const days of [7, 15, 30]) {
      await svc().analyze(prod, { windowDays: days });
      const expected = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      expect(lastList!.afterDate).toBe(expected);
    }
    expect((await q("select trigger, window_days from email_order_sync_runs where actor = $1 order by started_at desc limit 1", [(prod as { email: string }).email]))[0]).toMatchObject({ trigger: "backfill", window_days: 30 });
    expect(await count("email_order_drafts", `gmail_message_id = '${old.id}'`)).toBe(1); // se importó una sola vez en las tres búsquedas
    // Aprobado manualmente: otra búsqueda de 30 días no lo vuelve a traer
    const [d] = (await svc().list(prod)).filter((x) => x.gmailMessageId === old.id);
    expect(await count("production_pedidos", `cliente = '${CLI}'`)).toBe(0); // nada se crea solo
    const done = await svc().approve(prod, d!.id);
    expect(done.pedidoIds).toHaveLength(1);
    expect(await count("production_pedidos", `cliente = '${CLI}'`)).toBe(1);
    const after = await svc().analyze(prod, { windowDays: 30 });
    expect(after).toMatchObject({ drafts: 0, alreadyProcessed: 1 });
    expect(await count("production_pedidos", `cliente = '${CLI}'`)).toBe(1);
    expect(await count("email_order_drafts", `gmail_message_id = '${old.id}'`)).toBe(1);
  });

  it("cron: exige CRON_SECRET y cada corrida automática queda registrada aunque la casilla no esté conectada", async () => {
    const route = await import("@/app/api/cron/email-orders-sync/route");
    vi.stubEnv("CRON_SECRET", "secreto-cron-test");
    const denied = await route.GET(new Request("http://x/api/cron/email-orders-sync", { headers: { authorization: "Bearer otro" } }));
    expect(denied.status).toBe(401);
    await q("update email_integrations set status = 'desconectado', refresh_token_enc = null where id = 'pedidos'");
    const res = await route.GET(new Request("http://x/api/cron/email-orders-sync", { headers: { authorization: "Bearer secreto-cron-test" } }));
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    const [run] = await q("select trigger, status, reason from email_order_sync_runs where actor = 'cron@genus-os' order by started_at desc limit 1");
    expect(run).toMatchObject({ trigger: "cron" });
    expect(["no_conectada", "error_ia"]).toContain(run!.status);
    await svc().saveConnection(prod, { refreshToken: TOKEN, accountEmail: OWN, scope: "gmail.readonly" });
  });
});
