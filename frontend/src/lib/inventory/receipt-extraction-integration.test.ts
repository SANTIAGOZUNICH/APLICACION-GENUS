/**
 * Integración REAL de los proveedores (corrección posterior a #251): forma exacta del pedido a OpenAI (Responses API), detalle saneado de sus
 * errores, descarte de modelos Gemini con 404 sin gastar el cupo de llamadas y diagnóstico con prueba de TEXTO y de IMAGEN por separado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { deadModelList, extractRemito, probeExtraction, resetModelCacheForTests } from "./receipt-extraction";
import { errorInfoOf, redactOpenAI, runOpenAI } from "./receipt-openai";
import { createMemoryHealthStore } from "./receipt-provider-health";

const GKEY = "AIzaSyFAKE_GEMINI_KEY_0123456789abcdef";
const OKEY = "sk-proj-FAKE_OPENAI_KEY_0123456789abcdef";
const env = (over: Record<string, string> = {}) => ({
  INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: GKEY, CREAMY_OPENAI_API_KEY: OKEY, INGRESO_REMITO_RETRY_BASE_MS: "1",
  INGRESO_REMITO_BUDGET_MS: "6000", INGRESO_REMITO_FAST_BUDGET_MS: "2000", INGRESO_REMITO_FAST_ATTEMPT_MS: "1000", INGRESO_REMITO_ATTEMPT_MS: "3000", ...over,
}) as Partial<NodeJS.ProcessEnv>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const remito = {
  supplier: "Envases del Sur SA", remitoNumber: "0001-00004567", remitoDate: "2026-11-10", notes: "",
  lines: [{ supplierCode: "FR-30", description: "Frasco PET 30 ml", quantity: 10000, quantityText: "10.000", unit: "un", lot: "L-889", confidence: 0.95 }],
};
const gOk = (obj: unknown) => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] });
const oOk = (obj: unknown) => json(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
const g404 = () => json(404, { error: { code: 404, status: "NOT_FOUND", message: "models/x is not found for API version v1beta, or is not supported for generateContent." } });
const img = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#eee" } }).jpeg().toBuffer()), contentType: "image/jpeg" });

type Req = { url: string; init?: RequestInit; body: Record<string, unknown> & { input: Array<{ content: Array<{ type: string; text?: string }> }>; text?: unknown }; headers: Record<string, string> };
function server(opts: { listing?: Array<{ name: string; supportedGenerationMethods?: string[] }>; gemini: (model: string, n: number) => Response; openai?: (n: number, r: Req) => Response }) {
  const reqs: Req[] = [];
  let gn = 0;
  let on = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const r: Req = { url: u, init, body, headers };
    reqs.push(r);
    if (/openai\.com/.test(u)) return (opts.openai ?? (() => oOk(remito)))(on++, r);
    if (/\/v1beta\/models\?/.test(u)) return json(200, { models: opts.listing ?? [] });
    const model = /models\/([^:]+):generateContent/.exec(u)?.[1] ?? "";
    return opts.gemini(model, gn++);
  });
  return Object.assign(fn, { reqs, gen: () => reqs.filter((r) => /:generateContent/.test(r.url)), oa: () => reqs.filter((r) => /openai\.com/.test(r.url)) });
}
const L = (...names: string[]) => names.map((name) => ({ name: `models/${name}`, supportedGenerationMethods: ["generateContent"] }));

beforeEach(() => {
  resetModelCacheForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("OpenAI: forma EXACTA del pedido (Responses API)", () => {
  it("POST /v1/responses con Bearer, input_text + input_image (data URL), text.format json_object, max_output_tokens y store:false; sin campos de otras APIs", async () => {
    const f = server({ gemini: g404, openai: () => oOk(remito) });
    const parts = [{ text: "Leé este remito y devolvé JSON." }, { inline_data: { mime_type: "image/jpeg", data: "QUJD" } }];
    const r = await runOpenAI(parts, env(), f as never);
    expect(r).toMatchObject({ ok: true, model: "gpt-4o-mini" });
    const [call] = f.oa();
    expect(call!.url).toBe("https://api.openai.com/v1/responses");
    expect(call!.headers.authorization).toBe(`Bearer ${OKEY}`);
    expect(call!.body).toEqual({
      model: "gpt-4o-mini",
      input: [{ role: "user", content: [{ type: "input_text", text: "Leé este remito y devolvé JSON." }, { type: "input_image", image_url: "data:image/jpeg;base64,QUJD", detail: "high" }] }],
      text: { format: { type: "json_object" } },
      max_output_tokens: 8192,
      store: false,
    });
    for (const k of ["messages", "response_format", "max_tokens", "max_completion_tokens", "temperature"]) expect(call!.body).not.toHaveProperty(k); // nada de Chat Completions
  });
  it("json_object EXIGE la palabra «JSON» en la entrada: si el texto no la trae, se agrega (causa típica de HTTP 400)", async () => {
    const f = server({ gemini: g404 });
    await runOpenAI([{ text: "Leé este remito." }, { inline_data: { mime_type: "image/png", data: "QUJD" } }], env(), f as never);
    const content = f.oa()[0]!.body.input[0]!.content;
    expect(content.some((c) => c.type === "input_text" && /json/i.test(c.text ?? ""))).toBe(true);
  });
  it("pedido de TEXTO mínimo (prueba de configuración): sin imágenes y sin salida estructurada", async () => {
    const f = server({ gemini: g404, openai: () => oOk("OK") });
    const r = await runOpenAI([{ text: 'Respondé únicamente la palabra "OK".' }], env(), f as never, { json: false, textOnly: true, maxOutputTokens: 16 });
    expect(r).toMatchObject({ ok: true });
    expect(f.oa()[0]!.body).toEqual({ model: "gpt-4o-mini", input: [{ role: "user", content: [{ type: "input_text", text: 'Respondé únicamente la palabra "OK".' }] }], max_output_tokens: 16, store: false });
  });
  it("sin imágenes (y sin ser prueba de texto) no se llama a OpenAI", async () => {
    const f = server({ gemini: g404 });
    const r = await runOpenAI([{ text: "x" }], env(), f as never);
    expect(r).toMatchObject({ ok: false, kind: "unsupported" });
    expect(f.oa()).toHaveLength(0);
  });
});

describe("OpenAI: el detalle del HTTP 400 queda recuperable y saneado", () => {
  const bad = () => json(400, { error: { message: `Invalid value for 'input[0].content[1]'. Authorization: Bearer ${OKEY} data:image/png;base64,${"A".repeat(60)}`, type: "invalid_request_error", code: "invalid_value", param: "input[0].content[1]" } }, { "x-request-id": "req_abc123" });
  it("expone tipo, código, parámetro, request-id y mensaje; sin claves ni imágenes", async () => {
    const f = server({ gemini: g404, openai: bad });
    const r = await runOpenAI([{ text: "JSON" }, { inline_data: { mime_type: "image/jpeg", data: "QUJD" } }], env(), f as never);
    expect(r).toMatchObject({ ok: false, kind: "bad_request", http: 400, error: { type: "invalid_request_error", code: "invalid_value", param: "input[0].content[1]", requestId: "req_abc123" } });
    const blob = JSON.stringify(r);
    expect(blob).not.toContain(OKEY);
    expect(blob).not.toContain("A".repeat(60));
    expect((r as { message: string }).message).toMatch(/HTTP 400.*invalid_value.*req_abc123/);
    expect(f.oa()).toHaveLength(1); // un 400 de pedido inválido no se reintenta a ciegas
  });
  it("un 400 por el formato de salida estructurada se reintenta UNA vez sin text.format", async () => {
    const f = server({ gemini: g404, openai: (n) => (n === 0 ? json(400, { error: { message: "Unsupported value: 'text.format' ...", type: "invalid_request_error", code: "unsupported_value", param: "text.format" } }) : oOk(remito)) });
    const r = await runOpenAI([{ text: "JSON" }, { inline_data: { mime_type: "image/jpeg", data: "QUJD" } }], env(), f as never);
    expect(r).toMatchObject({ ok: true });
    expect(f.oa()[0]!.body.text).toBeDefined();
    expect(f.oa()[1]!.body).not.toHaveProperty("text");
  });
  it("errorInfoOf / redactOpenAI no dejan pasar claves ni data URLs", () => {
    expect(redactOpenAI(`x ${OKEY} y Bearer abcdefghijklmnop z`)).not.toMatch(/sk-proj|abcdefghijklmnop/);
    expect(errorInfoOf({ message: "m".repeat(900), code: "c" }, null).message.length).toBe(400);
  });
});

describe("Gemini: 404 de modelos que figuran en el listado", () => {
  const listing = L("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.8-flash");
  it("los dos primeros dan 404 → se descartan y lee con el siguiente, SIN pasar al otro proveedor ni gastar el cupo rápido", async () => {
    const f = server({ listing, gemini: (m) => (/^gemini-2\.5/.test(m) ? g404() : gOk(remito)) });
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: createMemoryHealthStore() });
    expect(out).toMatchObject({ ok: true, provider: expect.stringMatching(/^gemini/), model: "gemini-flash-latest" });
    expect(f.gen().map((r) => /models\/([^:]+):/.exec(r.url)![1])).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"]);
    expect(f.oa()).toHaveLength(0);
    expect(deadModelList()).toEqual(expect.arrayContaining(["gemini-2.5-flash", "gemini-2.5-flash-lite"]));
  });
  it("la lectura siguiente NO vuelve a pedir los modelos descartados", async () => {
    const f = server({ listing, gemini: (m) => (/^gemini-2\.5/.test(m) ? g404() : gOk(remito)) });
    const h = createMemoryHealthStore();
    await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    f.reqs.length = 0;
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    expect(out).toMatchObject({ ok: true });
    expect(f.gen().map((r) => /models\/([^:]+):/.exec(r.url)![1])).not.toContain("gemini-2.5-flash");
  });
  it("no se usan modelos del listado que no soportan generateContent", async () => {
    const f = server({
      listing: [...L("gemini-2.5-flash", "gemini-2.5-flash-lite"), { name: "models/gemini-flash-lite-latest", supportedGenerationMethods: ["embedContent"] }, ...L("gemini-flash-latest")],
      gemini: (m) => (/^gemini-2\.5/.test(m) ? g404() : gOk(remito)),
    });
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: createMemoryHealthStore() });
    expect(out).toMatchObject({ ok: true, model: "gemini-flash-latest" });
    expect(f.gen().map((r) => /models\/([^:]+):/.exec(r.url)![1])).not.toContain("gemini-flash-lite-latest");
  });
  it("todos los modelos 404 → pasa a OpenAI y lee (fallback realista), foto sin tocar", async () => {
    const f = server({ listing, gemini: () => g404(), openai: () => oOk(remito) });
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: createMemoryHealthStore() });
    expect(out).toMatchObject({ ok: true, provider: expect.stringMatching(/^openai/), model: "gpt-4o-mini" });
    expect(f.oa()).toHaveLength(1);
    expect(f.gen().length).toBeLessThanOrEqual(6); // tope de modelos descartados
  });
});

describe("extraction_health: texto e imagen por separado, con detalle técnico", () => {
  it("OpenAI 400: el diagnóstico muestra HTTP, request-id y el error saneado (no solo «bad_request»); el texto OK no se presenta como visión", async () => {
    const f = server({ listing: L("gemini-2.5-flash"), gemini: () => gOk("OK"), openai: () => json(400, { error: { message: "bad", type: "invalid_request_error", code: "invalid_value", param: "input" } }, { "x-request-id": "req_zzz" }) });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), image: true, health: createMemoryHealthStore(), storeCheck: async () => ({ persistent: true, table: "ai_provider_health" }) });
    const o = p.providers.find((x) => x.provider === "openai")!;
    expect(o).toMatchObject({ configured: true, keySource: "CREAMY_OPENAI_API_KEY", endpoint: "POST https://api.openai.com/v1/responses", requestedModel: "gpt-4o-mini", model: null, ok: false });
    expect(o.text).toMatchObject({ ok: false, kind: "bad_request", http: 400, requestId: "req_zzz", detail: expect.stringContaining("invalid_value") });
    expect(o.image).toMatchObject({ ok: false });
    expect(p.breakerStore).toEqual({ persistent: true, table: "ai_provider_health" });
    expect(JSON.stringify(p)).not.toContain(OKEY);
    expect(JSON.stringify(p)).not.toContain(GKEY);
  });
  it("Gemini sirve con el modelo 3.º tras dos 404 y la prueba de IMAGEN lo confirma por separado", async () => {
    const f = server({
      listing: L("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"),
      gemini: (m) => (/^gemini-2\.5/.test(m) ? g404() : gOk(remito)),
    });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), image: true, health: createMemoryHealthStore() });
    const g = p.providers.find((x) => x.provider === "gemini")!;
    expect(g.text).toMatchObject({ ok: true });
    expect(g.image).toMatchObject({ ok: true, read: { lines: 1 } });
    expect(g.attempts?.filter((a) => a.kind === "model").map((a) => a.model)).toEqual(expect.arrayContaining(["gemini-2.5-flash"]));
    expect(g.attempts?.find((a) => a.kind === "model")?.detail).toMatch(/not found/i);
    expect(p.skippedModels).toEqual(expect.arrayContaining(["gemini-2.5-flash"]));
  });
  it("sin image=1 la visión NO se prueba (image: null) y el mensaje lo aclara", async () => {
    const f = server({ listing: L("gemini-2.5-flash"), gemini: () => gOk("OK"), openai: () => oOk("OK") });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), health: createMemoryHealthStore() });
    expect(p.providers.every((x) => x.image === null)).toBe(true);
    expect(p.message).toMatch(/visión no se probó/);
    // El diagnóstico nunca toca inventario: solo habla con los proveedores (y no recibe base de datos).
    expect(f.reqs.every((r) => /generativelanguage|openai\.com/.test(r.url))).toBe(true);
  });
  it("tabla del circuit breaker ausente (migración 0086 sin aplicar): se informa, no rompe", async () => {
    const f = server({ listing: L("gemini-2.5-flash"), gemini: () => gOk("OK"), openai: () => oOk("OK") });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), health: createMemoryHealthStore(), storeCheck: async () => { throw new Error('relation "ai_provider_health" does not exist'); } });
    expect(p.breakerStore).toMatchObject({ persistent: false, table: "ai_provider_health", error: expect.stringContaining("does not exist") });
  });
});
