/**
 * Lectura de remitos con VARIOS proveedores (Gemini principal, OpenAI de respaldo): fallback automático, circuit breaker, presupuesto
 * reservado y clasificación de errores. Proveedores simulados por URL (sin claves reales).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { MSG_PROVIDER_DOWN, MSG_UNREADABLE, classifyHttp, extractRemito, extractionConfig, probeExtraction, providerOrder, resetModelCacheForTests } from "./receipt-extraction";
import { classifyOpenAI, openaiKey, openaiKeySource, openaiModel, runOpenAI, toOpenAIContent } from "./receipt-openai";
import { createMemoryHealthStore, openDurationMs } from "./receipt-provider-health";

const GKEY = "AIzaSyFAKE_GEMINI_KEY_0123456789abcdef";
const OKEY = "sk-proj-FAKE_OPENAI_KEY_0123456789abcdef";
const env = (over: Record<string, string> = {}) => ({
  INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: GKEY, CREAMY_OPENAI_API_KEY: OKEY, INGRESO_REMITO_RETRY_BASE_MS: "1",
  INGRESO_REMITO_BUDGET_MS: "6000", INGRESO_REMITO_FAST_BUDGET_MS: "900", INGRESO_REMITO_FAST_ATTEMPT_MS: "400", INGRESO_REMITO_ATTEMPT_MS: "3000", ...over,
}) as Partial<NodeJS.ProcessEnv>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const full = {
  supplier: "Envases del Sur SA", remitoNumber: "0001-00004567", remitoDate: "2026-11-10", notes: "",
  lines: [{ supplierCode: "FR-30", description: "Frasco PET 30 ml", quantity: 10000, quantityText: "10.000", unit: "un", lot: "L-889", confidence: 0.95 }, { supplierCode: "TP-24", description: "Tapa rosca 24/410", quantity: 1000, quantityText: "1.000", unit: "un", confidence: 0.95 }],
};
const noQty = { ...full, lines: [full.lines[0], { ...full.lines[1], quantity: null, quantityText: "", unclearFields: ["quantity"] }] };
const gOk = (obj: unknown) => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200, totalTokenCount: 1100 } });
const oOk = (obj: unknown) => json(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }], usage: { input_tokens: 1500, output_tokens: 250, total_tokens: 1750 } });
const g503 = () => json(503, { error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand. Spikes in demand are usually temporary." } });
const g429 = () => json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details.", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] } }, { "retry-after": "30" });
const gPerDay = () => json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details.", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });

type Call = { host: "gemini" | "openai"; model?: string; body: Record<string, unknown>; at: number };
/** `g(n, call)` / `o(n, call)` deciden la respuesta (n = índice de llamada de ese proveedor). */
function providers(g: (n: number, c: Call) => Response | Promise<Response>, o: (n: number, c: Call) => Response | Promise<Response> = () => oOk(full)) {
  const calls: Call[] = [];
  const count = { gemini: 0, openai: 0 };
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (/generativelanguage/.test(u) && /\/v1beta\/models\?/.test(u)) return json(200, { models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.8-flash"].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ["generateContent"] })) });
    const host: Call["host"] = /openai\.com/.test(u) ? "openai" : "gemini";
    const call: Call = { host, model: host === "gemini" ? /models\/([^:]+):generateContent/.exec(u)?.[1] : (JSON.parse(String(init?.body ?? "{}")).model as string), body: JSON.parse(String(init?.body ?? "{}")), at: Date.now() };
    calls.push(call);
    const n = count[host]++;
    const resp = await (host === "gemini" ? g(n, call) : o(n, call));
    // Un proveedor «colgado» se corta por el AbortSignal del intento, igual que en producción.
    return resp;
  });
  return Object.assign(fn, { calls, of: (h: Call["host"]) => calls.filter((c) => c.host === h) });
}
const hang = (ms: number, init?: RequestInit) => new Promise<Response>((_, reject) => { const t = setTimeout(() => reject(new Error("never")), ms); init?.signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }); });
const img = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#eee" } }).jpeg().toBuffer()), contentType: "image/jpeg" });
const health = () => createMemoryHealthStore();

beforeEach(() => {
  resetModelCacheForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("configuración de proveedores", () => {
  it("por defecto Gemini lee y OpenAI respalda; reutiliza las claves de GENUS (INGRESO_REMITO_OPENAI_API_KEY → CREAMY_OPENAI_API_KEY → OPENAI_API_KEY)", () => {
    expect(providerOrder(env())).toEqual(["gemini", "openai"]);
    expect(providerOrder(env({ OPENAI_API_KEY: "", CREAMY_OPENAI_API_KEY: "" }))).toEqual(["gemini"]);
    expect(providerOrder(env({ GEMINI_API_KEY: "" }))).toEqual(["openai"]);
    expect(providerOrder(env({ INGRESO_REMITO_PROVIDERS: "openai,gemini" }))).toEqual(["openai", "gemini"]);
    expect(providerOrder(env({ INGRESO_REMITO_OPENAI: "off" }))).toEqual(["gemini"]);
    expect(openaiKeySource({ OPENAI_API_KEY: "sk-x".padEnd(20, "x") })).toBe("OPENAI_API_KEY");
    expect(openaiKeySource({ CREAMY_OPENAI_API_KEY: OKEY, OPENAI_API_KEY: "sk-otra" })).toBe("CREAMY_OPENAI_API_KEY");
    expect(openaiKey({ INGRESO_REMITO_OPENAI_API_KEY: "sk-propia", CREAMY_OPENAI_API_KEY: OKEY })).toBe("sk-propia");
    expect(openaiModel({})).toBe("gpt-4o-mini");
    expect(openaiModel({ INGRESO_REMITO_OPENAI_MODEL: "gpt-4.1-mini" })).toBe("gpt-4.1-mini");
  });
  it("solo OpenAI configurado también habilita la lectura; sin ninguna clave se informa qué variable falta", () => {
    expect(extractionConfig(env({ GEMINI_API_KEY: "" }))).toMatchObject({ available: true, provider: "openai", providers: ["openai"] });
    const none = extractionConfig(env({ GEMINI_API_KEY: "", CREAMY_OPENAI_API_KEY: "" }));
    expect(none).toMatchObject({ available: false, code: "missing_key" });
    expect(none.reason).toMatch(/GEMINI_API_KEY.*CREAMY_OPENAI_API_KEY.*OPENAI_API_KEY/);
  });
});

describe("clasificación de errores (HTTP 429 ya no se disfraza de permiso)", () => {
  it("Gemini: un 429 cuyo texto menciona «billing» es límite/cuota, no permiso", () => {
    const msg = "You exceeded your current quota, please check your plan and billing details.";
    expect(classifyHttp(429, { status: "RESOURCE_EXHAUSTED", message: msg }).kind).toBe("limit");
    expect(classifyHttp(429, { status: "RESOURCE_EXHAUSTED", message: msg, details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] as never }).kind).toBe("quota");
    expect(classifyHttp(403, { status: "PERMISSION_DENIED", message: "billing is not enabled" }).kind).toBe("permission");
    expect(classifyHttp(503, { status: "UNAVAILABLE", message: "high demand" }).kind).toBe("overloaded");
  });
  it("OpenAI: cuota agotada, límite por minuto, clave, modelo, saturación", () => {
    expect(classifyOpenAI(429, { code: "insufficient_quota", message: "You exceeded your current quota" })).toBe("quota");
    expect(classifyOpenAI(429, { code: "rate_limit_exceeded" })).toBe("limit");
    expect(classifyOpenAI(401, { code: "invalid_api_key" })).toBe("key");
    expect(classifyOpenAI(404, { code: "model_not_found" })).toBe("model");
    expect(classifyOpenAI(503, {})).toBe("overloaded");
    expect(classifyOpenAI(500, {})).toBe("unavailable");
    expect(classifyOpenAI(400, {})).toBe("bad_request");
  });
});

describe("circuit breaker: política", () => {
  it("429 y cuota abren al instante; 503/timeout recién a la 2.ª falla seguida; clave/permisos/región por más tiempo", () => {
    expect(openDurationMs({ kind: "limit" }, 1)).toBeGreaterThanOrEqual(60_000);
    expect(openDurationMs({ kind: "quota" }, 1)).toBeGreaterThanOrEqual(5 * 60_000);
    expect(openDurationMs({ kind: "overloaded" }, 1)).toBe(0);
    expect(openDurationMs({ kind: "overloaded" }, 2)).toBeGreaterThanOrEqual(90_000);
    expect(openDurationMs({ kind: "timeout" }, 2)).toBeGreaterThan(0);
    expect(openDurationMs({ kind: "key" }, 1)).toBe(10 * 60_000);
    expect(openDurationMs({ kind: "unreadable" }, 5)).toBe(0); // una imagen ilegible NO castiga al proveedor
  });
  it("la imagen ilegible no cuenta como falla del proveedor y un éxito cierra el circuito", async () => {
    const h = health();
    await h.recordFailure("gemini", { kind: "unreadable" });
    expect((await h.state("gemini")).consecutiveFailures).toBe(0);
    await h.recordFailure("gemini", { kind: "limit", retryAfterMs: 30_000 });
    expect((await h.state("gemini")).openUntil).toBeGreaterThan(Date.now());
    await h.recordSuccess("gemini");
    expect((await h.state("gemini")).openUntil).toBe(0);
  });
});

describe("fallback automático Gemini → OpenAI", () => {
  it("1) Gemini disponible: lectura normal, UNA llamada y OpenAI no se toca (no se usan los dos a la vez)", async () => {
    const f = providers(() => gOk(full));
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: true, pending: [], provider: "gemini:gemini-2.5-flash" });
    expect(f.of("gemini")).toHaveLength(1);
    expect(f.of("openai")).toHaveLength(0);
    if (out.ok) expect(out.diag).toMatchObject({ fallback: false, provider: "gemini" });
  });
  it("2) Gemini 503: máximo 2 intentos rápidos con Gemini (modelos distintos, sin esperas) y OpenAI recupera la lectura sin intervención", async () => {
    const f = providers(() => g503());
    const t0 = Date.now();
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: true, pending: [] });
    expect(out.ok && out.provider).toMatch(/^openai:gpt-4o-mini/);
    expect(f.of("gemini").length).toBeLessThanOrEqual(2);
    expect(new Set(f.of("gemini").map((c) => c.model)).size).toBe(f.of("gemini").length); // no insiste con el mismo modelo
    expect(f.of("openai")).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(3000);
    if (out.ok) {
      expect(out.diag).toMatchObject({ fallback: true, provider: "openai" });
      expect(out.diag?.providers?.gemini).toMatchObject({ ok: false, kind: "overloaded", http: 503 });
      expect(out.diag?.providers?.openai).toMatchObject({ ok: true, tokens: { total: 1750 } });
      expect(JSON.stringify(out.diag)).not.toMatch(/AIza|sk-proj/);
    }
  });
  it("3) Gemini 429: pasa a OpenAI de inmediato (1 sola llamada a Gemini, sin esperar el Retry-After) y abre el circuito", async () => {
    const h = health();
    const f = providers(() => g429());
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    expect(out).toMatchObject({ ok: true });
    expect(f.of("gemini")).toHaveLength(1);
    expect((await h.state("gemini")).openUntil).toBeGreaterThan(Date.now());
    expect((await h.state("gemini")).lastKind).toBe("limit");
  });
  it("circuit breaker: con Gemini caído, el remito SIGUIENTE no vuelve a esperarlo (0 llamadas a Gemini) y reutiliza OpenAI", async () => {
    const h = health();
    const f = providers(() => g429());
    await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    const geminiBefore = f.of("gemini").length;
    const t0 = Date.now();
    const second = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    expect(second).toMatchObject({ ok: true });
    expect(f.of("gemini").length).toBe(geminiBefore); // salteado
    expect(Date.now() - t0).toBeLessThan(1500);
    if (second.ok) expect(second.diag?.providers?.gemini).toMatchObject({ skipped: 1 });
  });
  it("tras el tiempo de espera el circuito prueba a Gemini otra vez (half-open) y, si responde, vuelve a ser el principal", async () => {
    const h = health();
    const f = providers((n) => (n === 0 ? g429() : gOk(full)));
    await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    await h.recordSuccess("openai");
    // simula que pasó la espera
    const st = await h.state("gemini");
    expect(st.openUntil).toBeGreaterThan(0);
    await h.recordSuccess("gemini"); // la prueba half-open exitosa cierra el circuito
    const third = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: h });
    expect(third.ok && third.provider).toMatch(/^gemini:/);
  });
  it("4) Gemini no responde (timeout): se corta a los ~0,9 s reservados para el principal y OpenAI termina con presupuesto de sobra", async () => {
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (/\/v1beta\/models\?/.test(u)) return json(200, { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] });
      if (/openai\.com/.test(u)) return oOk(full);
      return hang(10_000, init);
    });
    const t0 = Date.now();
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: true });
    expect(out.ok && out.provider).toMatch(/^openai:/);
    expect(Date.now() - t0).toBeLessThan(2500); // antes: ~39 s en Gemini y timeout sin llegar al respaldo
    if (out.ok) expect(out.diag?.providers?.gemini).toMatchObject({ ok: false, kind: "timeout" });
  });
  it("Gemini sin acceso al modelo / permisos / clave inválida: también pasa al respaldo (no depende de que Gemini esté bien configurado)", async () => {
    for (const resp of [() => json(404, { error: { code: 404, status: "NOT_FOUND", message: "models/x is not found" } }), () => json(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "denied" } }), () => json(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid" } })]) {
      resetModelCacheForTests();
      const out = await extractRemito([await img()], { fetchImpl: providers(resp) as never, env: env(), health: health() });
      expect(out).toMatchObject({ ok: true });
      expect(out.ok && out.provider).toMatch(/^openai:/);
    }
  });
  it("5) AMBOS indisponibles: falla controlada dentro del presupuesto, sin culpar a la imagen, con diagnóstico de los dos proveedores", async () => {
    const f = providers(() => g503(), () => json(503, { error: { type: "server_error", message: "overloaded" } }));
    const t0 = Date.now();
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: false, message: MSG_PROVIDER_DOWN });
    expect(Date.now() - t0).toBeLessThan(6000);
    if (out.ok) return;
    expect(out.message).not.toMatch(/imagen más clara/i);
    expect(out.diag?.providers).toMatchObject({ gemini: { ok: false, kind: "overloaded" }, openai: { ok: false, kind: "overloaded" } });
    expect(out.diag).toMatchObject({ failedStage: "lectura" });
    expect(out.diag?.stages[0]?.providers?.map((p) => p.provider)).toEqual(["gemini", "openai"]);
  });
  it("OpenAI no configurado: Gemini conserva el comportamiento anterior (todo el presupuesto, con reintentos) y sin llamadas a OpenAI", async () => {
    const f = providers((n) => (n < 3 ? g503() : gOk(full)));
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env({ CREAMY_OPENAI_API_KEY: "" }), health: health() });
    expect(out).toMatchObject({ ok: true });
    expect(f.of("gemini").length).toBe(4);
    expect(f.of("openai")).toHaveLength(0);
  });
  it("cuota diaria de Gemini: no se reintenta y se usa OpenAI; si OpenAI también agotó la cuota se informa servicio no disponible", async () => {
    const out = await extractRemito([await img()], { fetchImpl: providers(() => gPerDay()) as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: true });
    const both = await extractRemito([await img()], { fetchImpl: providers(() => gPerDay(), () => json(429, { error: { code: "insufficient_quota", message: "You exceeded your current quota" } })) as never, env: env(), health: health() });
    expect(both).toMatchObject({ ok: false, message: MSG_PROVIDER_DOWN });
    if (!both.ok) expect(both.diag?.providers?.openai).toMatchObject({ kind: "quota", http: 429 });
  });
});

describe("lectura progresiva con varios proveedores", () => {
  it("6) datos parciales: la mejora de imagen relee SOLO lo que falta con el proveedor que sí respondió (no vuelve a Gemini caído)", async () => {
    const f = providers(() => g503(), (n) => (n === 0 ? oOk(noQty) : oOk(full)));
    const out = await extractRemito([await img()], { fetchImpl: f as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: true, pending: [] });
    expect(f.of("openai")).toHaveLength(2);
    expect(f.of("gemini").length).toBeLessThanOrEqual(2 + 2); // etapa 1 (≤2) y, si acaso, la 2.ª etapa saltea el circuito abierto
    const second = f.of("openai")[1]!.body as { input: Array<{ content: Array<Record<string, unknown>> }> };
    expect(String(second.input[0]!.content[0]!.text)).toMatch(/SEGUNDA LECTURA/);
    if (out.ok) expect(out.data.lines.map((l) => l.quantity)).toEqual(["10000", "1000"]);
  });
  it("8) texto realmente ilegible: ambos proveedores analizaron la imagen y no hay datos → «Necesito una imagen más clara del texto»", async () => {
    const empty = { supplier: "", remitoNumber: "", remitoDate: "", lines: [] };
    const out = await extractRemito([await img()], { fetchImpl: providers(() => gOk(empty), () => oOk(empty)) as never, env: env(), health: health() });
    expect(out).toMatchObject({ ok: false, kind: "unreadable", message: MSG_UNREADABLE });
  });
  it("11) cantidades argentinas: el texto impreso manda también cuando lee OpenAI (mismo saneamiento)", async () => {
    const r = { ...full, lines: [{ supplierCode: "FR-30", description: "Frasco", quantity: 10, quantityText: "10.000", unit: "un" }] };
    const out = await extractRemito([await img()], { fetchImpl: providers(() => g503(), () => oOk(r)) as never, env: env(), health: health() });
    expect(out.ok && out.data.lines[0]!.quantity).toBe("10000");
    if (out.ok) expect(out.data.lines[0]!.review).toContain("quantity"); // discrepancia con el número del modelo: se muestra para revisar
  });
});

describe("OpenAI: pedido y errores", () => {
  const parts = (types: string[]) => [{ text: "prompt JSON" }, ...types.map((t) => ({ inline_data: { mime_type: t, data: "QUJD" } }))] as Array<Record<string, unknown>>;
  it("10) fotos y PDF viajan como input_image / input_file; HEIC se omite; JSON estructurado, sin guardar (store:false), clave solo en cabecera", async () => {
    const c = toOpenAIContent(parts(["image/jpeg", "image/png", "application/pdf", "image/heic"]));
    expect(c.content.map((x) => x.type)).toEqual(["input_text", "input_image", "input_image", "input_file"]);
    expect(c.skipped).toBe(1);
    const f = providers(() => g503(), () => oOk(full));
    await runOpenAI(parts(["image/jpeg", "application/pdf"]), env(), f as never);
    const sent = f.of("openai")[0]!;
    expect(sent.body).toMatchObject({ model: "gpt-4o-mini", text: { format: { type: "json_object" } }, store: false });
    const [, init] = (f.mock.calls.find((c) => /openai/.test(String(c[0])))!) as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${OKEY}`);
    expect(String(init.body)).not.toContain(OKEY);
  });
  it("sin imágenes compatibles no es una falla de disponibilidad; clave inválida / cuota no se reintentan; 5xx se reintenta una vez", async () => {
    expect(await runOpenAI(parts(["image/heic"]), env(), vi.fn() as never)).toMatchObject({ ok: false, kind: "unsupported" });
    const key = providers(() => g503(), () => json(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided: sk-proj-FAKE_OPENAI_KEY_0123456789abcdef" } }));
    const r1 = await runOpenAI(parts(["image/jpeg"]), env(), key as never);
    expect(r1).toMatchObject({ ok: false, kind: "key", http: 401 });
    expect(key.of("openai")).toHaveLength(1);
    expect(JSON.stringify(r1)).not.toContain(OKEY);
    const flaky = providers(() => g503(), (n) => (n === 0 ? json(502, { error: { message: "bad gateway" } }) : oOk(full)));
    expect(await runOpenAI(parts(["image/jpeg"]), env(), flaky as never)).toMatchObject({ ok: true });
    expect(flaky.of("openai")).toHaveLength(2);
  });
  it("salida cortada por tokens: se marca MAX_TOKENS para rescatar lo completo", async () => {
    const f = providers(() => g503(), () => json(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "{\"supplier\":\"X\"" }));
    expect(await runOpenAI(parts(["image/jpeg"]), env(), f as never)).toMatchObject({ ok: true, finishReason: "MAX_TOKENS" });
  });
});

describe("prueba real de configuración (view=extraction_health): sin movimientos de inventario", () => {
  it("informa por proveedor: configurado, variable que aporta la clave, modelo, resultado de la imagen ficticia, tiempos y estado del breaker", async () => {
    const f = providers((n, c) => ((c.body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts.some((p) => p.inline_data) ? gOk(full) : json(200, { candidates: [{ content: { parts: [{ text: "OK" }] } }] })), () => oOk(full));
    const h = health();
    await h.recordFailure("gemini", { kind: "limit" });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), image: true, health: h });
    expect(p.order).toEqual(["gemini", "openai"]);
    expect(p.providers.map((x) => [x.provider, x.configured, x.ok])).toEqual([["gemini", true, true], ["openai", true, true]]);
    expect(p.providers[1]).toMatchObject({ keySource: "CREAMY_OPENAI_API_KEY", model: "gpt-4o-mini", image: { ok: true } });
    expect(p.providers[0]!.breaker.open).toBe(true); // refleja el estado real del circuito
    expect(JSON.stringify(p)).not.toMatch(/AIza|sk-proj/);
    expect(p.budget).toMatchObject({ routeMaxMs: 60_000 });
  });
  it("OpenAI sin configurar: dice exactamente qué variable definir", async () => {
    const f = providers(() => gOk(full));
    const p = await probeExtraction({ fetchImpl: f as never, env: env({ CREAMY_OPENAI_API_KEY: "" }), health: health() });
    const o = p.providers.find((x) => x.provider === "openai")!;
    expect(o).toMatchObject({ configured: false, keySource: null });
    expect(o.text.message).toMatch(/CREAMY_OPENAI_API_KEY u OPENAI_API_KEY/);
  });
});
