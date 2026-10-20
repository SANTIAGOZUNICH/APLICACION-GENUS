import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_UNREADABLE, classifyHttp, extractRemito, extractionConfig, probeExtraction, rankVisionModels, redactSecrets, resetModelCacheForTests } from "./receipt-extraction";

type Part = Record<string, unknown> & { inline_data?: { mime_type: string } };
const KEY = "AIzaSyFAKE_KEY_FOR_TESTS_0123456789abcd";
const env = (over: Record<string, string> = {}) => ({ INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, ...over }) as Partial<NodeJS.ProcessEnv>;
const jpg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: "image/jpeg" };
const pdf = { bytes: new Uint8Array(Buffer.from("%PDF-1.4 x")), contentType: "application/pdf" };
const remito = {
  supplier: "Droguería Sur SA", remitoNumber: "0001-00012345", remitoDate: "2026-10-15", notes: "Entrega parcial", unclearFields: [],
  lines: [
    { supplierCode: "AB-77", description: "Glicerina vegetal USP", quantity: 100, unit: "kg", packages: 4, lot: "L-77", expiryDate: "2029-06-30", notes: "", confidence: 0.95, unclearFields: [] },
    { supplierCode: "ZZ-1", description: "Alcohol cetílico", quantity: "25,5", unit: "KG", packages: null, lot: "", expiryDate: "", notes: "", confidence: 0.4, unclearFields: ["lot"] },
  ],
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = (obj: unknown) => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] });
const err = (status: number, gstatus: string, message: string) => json(status, { error: { code: status, status: gstatus, message } });

/** Servidor Gemini simulado: ListModels + generateContent por modelo. `onModel` decide la respuesta para cada modelo. */
function gemini(opts: { models?: string[]; listStatus?: number; onModel: (model: string, body: Record<string, unknown>) => Response }) {
  const calls: Array<{ method: string; url: string; model?: string; body?: Record<string, unknown>; key?: string | null }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const key = (init?.headers as Record<string, string> | undefined)?.["x-goog-api-key"] ?? null;
    if (method === "GET" && /\/v1beta\/models\?/.test(u)) {
      calls.push({ method, url: u, key });
      if (opts.listStatus && opts.listStatus >= 400) return err(opts.listStatus, "PERMISSION_DENIED", "denied");
      return json(200, { models: (opts.models ?? []).map((m) => ({ name: `models/${m}`, supportedGenerationMethods: /embedding/.test(m) ? ["embedContent"] : ["generateContent"] })) });
    }
    const model = /models\/([^:]+):generateContent/.exec(u)?.[1];
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ method, url: u, model, body, key });
    return opts.onModel(String(model), body);
  });
  return Object.assign(fn, { calls, generate: () => calls.filter((c) => c.model) });
}

beforeEach(() => resetModelCacheForTests());
afterEach(() => vi.restoreAllMocks());

describe("configuración de la lectura automática", () => {
  it("se activa sola cuando existe la clave de Gemini y solo se apaga con una orden explícita", () => {
    expect(extractionConfig({ GEMINI_API_KEY: KEY } as never)).toMatchObject({ available: true, code: "ok" });
    expect(extractionConfig({ GEMINI_API_KEY: KEY, INGRESO_REMITO_EXTRACTION: "off" } as never)).toMatchObject({ available: false, code: "disabled" });
    expect(extractionConfig({} as never)).toMatchObject({ available: false, code: "missing_key" });
  });
  it("habilitada pero sin clave → missing_key; con clave → ok", () => {
    expect(extractionConfig({ INGRESO_REMITO_EXTRACTION: "gemini" } as never)).toMatchObject({ available: false, code: "missing_key" });
    expect(extractionConfig(env())).toMatchObject({ available: true, code: "ok", model: "", modelSource: "automático" });
  });
  it("el modelo solo sale de INGRESO_REMITO_GEMINI_MODEL: NO hereda el de Creamy a ciegas", () => {
    expect(extractionConfig(env({ CREAMY_GEMINI_MODEL: "gemini-2.0-flash" })).model).toBe("");
    expect(extractionConfig(env({ INGRESO_REMITO_GEMINI_MODEL: "models/gemini-3.5-flash" }))).toMatchObject({ model: "gemini-3.5-flash", modelSource: "INGRESO_REMITO_GEMINI_MODEL" });
  });
});

describe("fallos transitorios: reintentos controlados, sin bucles infinitos", () => {
  const fast = (over: Record<string, string> = {}) => env({ INGRESO_REMITO_RETRY_BASE_MS: "1", INGRESO_REMITO_GEMINI_MODEL: "gemini-3.5-flash", ...over });
  it("503 «saturado» una vez: reintenta el mismo modelo y lee bien", async () => {
    let n = 0;
    const f = gemini({ onModel: () => (++n === 1 ? err(503, "UNAVAILABLE", "The model is overloaded. Please try again later.") : ok(remito)) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast() });
    expect(out).toMatchObject({ ok: true, model: "gemini-3.5-flash" });
    expect(f.generate()).toHaveLength(2);
  });
  it("503 permanente: reintenta con tope (3 intentos por modelo), prueba otro modelo y recién entonces informa «saturado» (no «no disponible»)", async () => {
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash"], onModel: () => err(503, "UNAVAILABLE", "overloaded") });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast() });
    expect(out).toMatchObject({ ok: false, kind: "overloaded" });
    expect((out as { message: string }).message).toMatch(/saturado/);
    expect(f.generate().length).toBe(6);
    expect(new Set(f.generate().map((c) => c.model))).toEqual(new Set(["gemini-3.5-flash", "gemini-2.5-flash"]));
  });
  it("el otro modelo responde cuando el primero sigue saturado", async () => {
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash"], onModel: (m) => (m === "gemini-3.5-flash" ? err(503, "UNAVAILABLE", "overloaded") : ok(remito)) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await extractRemito([jpg], { fetchImpl: f as never, env: fast() })).toMatchObject({ ok: true, model: "gemini-2.5-flash" });
  });
  it("corte de red: reintenta y, si no se recupera, informa servicio no disponible con tope", async () => {
    let n = 0;
    const down = vi.fn(async () => {
      n++;
      throw new TypeError("fetch failed");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await extractRemito([jpg], { fetchImpl: down as never, env: fast() });
    expect(out).toMatchObject({ ok: false, kind: "unavailable" });
    expect(n).toBe(3);
  });
  it("la clave inválida NO se reintenta ni se disfraza de «no disponible»", async () => {
    const f = gemini({ onModel: () => err(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key.") });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast() });
    expect(out).toMatchObject({ ok: false, kind: "key" });
    expect(f.generate()).toHaveLength(1);
  });
  it("respuesta vacía cortada por tokens (modelo que piensa de más): un reintento con más margen y lee", async () => {
    let n = 0;
    const f = gemini({ onModel: () => (++n === 1 ? json(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }) : ok(remito)) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast() });
    expect(out).toMatchObject({ ok: true });
    expect(f.generate()).toHaveLength(2);
    expect((f.generate()[1]!.body!.generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBeGreaterThan((f.generate()[0]!.body!.generationConfig as { maxOutputTokens: number }).maxOutputTokens);
  });
  it("modelos 3.x: se pide razonamiento mínimo (si el modelo lo rechaza, se reintenta sin esa opción)", async () => {
    let n = 0;
    const f = gemini({ onModel: (_m, body) => (++n === 1 ? (JSON.stringify(body).includes("thinkingLevel") ? err(400, "INVALID_ARGUMENT", "thinking level is not supported") : ok(remito)) : ok(remito)) });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast() });
    expect(out).toMatchObject({ ok: true });
    expect(JSON.stringify(f.generate()[0]!.body)).toContain("thinkingLevel");
    expect(JSON.stringify(f.generate()[1]!.body)).not.toContain("thinkingLevel");
  });
});

describe("lectura de etiquetas y adaptación por sector", () => {
  const fast = env({ INGRESO_REMITO_RETRY_BASE_MS: "1", INGRESO_REMITO_GEMINI_MODEL: "gemini-3.5-flash" });
  const promptOf = (f: ReturnType<typeof gemini>) => String(((f.generate()[0]!.body as { contents: Array<{ parts: Array<{ text?: string }> }> }).contents[0]!.parts[0] as { text: string }).text);
  it("Materias Primas: el pedido describe etiquetas de MP (lote, vencimiento) y admite UNA línea", async () => {
    const f = gemini({ onModel: () => ok(remito) });
    await extractRemito([jpg], { fetchImpl: f as never, env: fast, module: "MP" });
    expect(promptOf(f)).toMatch(/MATERIAS PRIMAS/);
    expect(promptOf(f)).toMatch(/ETIQUETA/);
    expect(promptOf(f)).toMatch(/NUNCA inventes/);
  });
  it("Depósito: el pedido describe materiales de envase y pide cliente/ubicación en notas", async () => {
    const f = gemini({ onModel: () => ok(remito) });
    await extractRemito([jpg], { fetchImpl: f as never, env: fast, module: "ME" });
    expect(promptOf(f)).toMatch(/MATERIALES DE ENVASE/);
    expect(promptOf(f)).toMatch(/Cliente: …/);
  });
  it("lo deducido o normalizado (inferredFields) y lo ilegible quedan marcados para confirmar; nada se inventa", async () => {
    const f = gemini({ onModel: () => ok({ supplier: "ACME", remitoNumber: "", remitoDate: "", notes: "", unclearFields: [], lines: [{ supplierCode: "E-1", description: "Etiqueta frasco 30 ml", quantity: 500, unit: "un", packages: null, lot: "", expiryDate: "2028-06-30", notes: "", confidence: 0.9, unclearFields: ["lot"], inferredFields: ["expiryDate"] }] }) });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: fast, module: "ME" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      const l = out.data.lines[0]!;
      expect(l.lote).toBe("");
      expect(l.review).toEqual(expect.arrayContaining(["lote", "vencimiento"]));
    }
  });
});

describe("elección de modelo", () => {
  it("ranking: estable más nuevo primero; luego alias; lite; preview; pro", () => {
    const r = rankVisionModels(["gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-3.5-flash-preview-09-2026", "gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-flash-001"]);
    expect(r.slice(0, 3)).toEqual(["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-001"]);
    expect(r.indexOf("gemini-flash-latest")).toBeGreaterThan(2);
    expect(r.indexOf("gemini-2.5-flash-lite")).toBeLessThan(r.indexOf("gemini-3.5-flash-preview-09-2026"));
    expect(r.at(-1)).toBe("gemini-2.5-pro");
  });
  it("sin modelo definido: pregunta a Google qué hay (ignora embeddings/tts/imagen) y usa el mejor", async () => {
    const f = gemini({ models: ["embedding-gecko", "gemini-2.5-flash-preview-tts", "gemini-2.5-flash-image", "gemini-2.5-flash", "gemini-3.5-flash"], onModel: () => ok(remito) });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, model: "gemini-3.5-flash", provider: "gemini:gemini-3.5-flash" });
    expect(f.generate().map((c) => c.model)).toEqual(["gemini-3.5-flash"]);
  });
  it("modelo definido que YA NO EXISTE (404): descubre otro, reintenta y lo recuerda (no vuelve a listar)", async () => {
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash-lite"], onModel: (m) => (m === "gemini-2.0-flash" ? err(404, "NOT_FOUND", "models/gemini-2.0-flash is not found for API version v1beta, or is not supported for generateContent.") : ok(remito)) });
    const e = env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.0-flash" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const a = await extractRemito([jpg], { fetchImpl: f as never, env: e });
    expect(a).toMatchObject({ ok: true, model: "gemini-3.5-flash" });
    expect(f.generate().map((c) => c.model)).toEqual(["gemini-2.0-flash", "gemini-3.5-flash"]);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/modelo gemini-2\.0-flash/);
    const listsBefore = f.calls.filter((c) => c.method === "GET").length;
    const b = await extractRemito([jpg], { fetchImpl: f as never, env: e });
    expect(b.ok).toBe(true);
    expect(f.calls.filter((c) => c.method === "GET").length).toBe(listsBefore); // sin nuevas consultas de modelos
    // El modelo que funciona se prueba primero en la segunda lectura (tras el definido, que sigue dando 404 → solo 1 intento extra).
    expect(f.generate().slice(-1)[0]!.model).toBe("gemini-3.5-flash");
  });
  it("ningún modelo existe: mensaje claro con los modelos probados y sin la clave", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash"], onModel: () => err(404, "NOT_FOUND", "models/x is not found") });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-1.5-flash" }) });
    expect(out).toMatchObject({ ok: false, kind: "model" });
    if (out.ok) return;
    expect(out.message).toMatch(/gemini-1\.5-flash.*gemini-3\.5-flash/);
    expect(out.message).not.toContain(KEY);
  });
  it("si ni siquiera se puede listar modelos: prueba el alias y los nombres conocidos", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = gemini({ listStatus: 403, onModel: (m) => (m === "gemini-flash-latest" ? ok(remito) : err(404, "NOT_FOUND", "nope")) });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, model: "gemini-flash-latest" });
  });
  it("un 400 por «thinkingConfig» no soportado se reintenta sin esa opción", async () => {
    const f = gemini({ models: ["gemini-2.5-flash"], onModel: (_m, body) => ((body.generationConfig as Record<string, unknown>).thinkingConfig ? err(400, "INVALID_ARGUMENT", "Thinking config is not supported for this model") : ok(remito)) });
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(out.ok).toBe(true);
    expect(f.generate()).toHaveLength(2);
    expect((f.generate()[1]!.body!.generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined();
  });
});

describe("clasificación de errores (cada causa, un mensaje distinto)", () => {
  const cases: Array<[number, string, string, string]> = [
    [404, "NOT_FOUND", "models/x is not found for API version v1beta", "model"],
    [400, "INVALID_ARGUMENT", `API key not valid. Please pass a valid API key. ${KEY}`, "key"],
    [401, "UNAUTHENTICATED", "Request had invalid authentication credentials", "key"],
    [403, "PERMISSION_DENIED", "Generative Language API has not been used in project 123 before or it is disabled", "permission"],
    [403, "PERMISSION_DENIED", "The caller does not have permission", "permission"],
    [400, "FAILED_PRECONDITION", "User location is not supported for the API use.", "region"],
    [429, "RESOURCE_EXHAUSTED", "You exceeded your current quota", "limit"],
    [503, "UNAVAILABLE", "The model is overloaded", "overloaded"],
    [500, "INTERNAL", "Internal error", "unavailable"],
  ];
  it("classifyHttp", () => {
    for (const [status, st, message, kind] of cases) expect(classifyHttp(status, { code: status, status: st, message }).kind, message).toBe(kind);
    expect(classifyHttp(400, { message: KEY }).detail).not.toContain(KEY);
  });
  it("extractRemito devuelve el tipo y un mensaje propio por causa (sin clave); los fallos quedan registrados", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const msgs = new Set<string>();
    for (const [status, st, message, kind] of cases.filter((c) => c[3] !== "model")) {
      resetModelCacheForTests();
      const out = await extractRemito([jpg], { fetchImpl: gemini({ models: ["gemini-2.5-flash"], onModel: () => err(status, st, message) }) as never, env: env({ INGRESO_REMITO_RETRY_BASE_MS: "1" }) });
      expect(out).toMatchObject({ ok: false, kind });
      if (!out.ok) {
        expect(out.message).not.toContain(KEY);
        msgs.add(`${kind}:${out.message}`);
      }
    }
    expect(new Set([...msgs].map((m) => m.split(":")[0])).size).toBe(6); // key, permission, region, limit, overloaded, unavailable
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/lectura automática falló/);
    expect(logged).not.toContain(KEY);
  });
  it("la clave inválida NO prueba otros modelos (no es un problema de modelo)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash"], onModel: () => err(400, "INVALID_ARGUMENT", "API key not valid") });
    await extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(f.generate()).toHaveLength(1);
  });
});

describe("extractRemito", () => {
  it("manda las hojas a Gemini en UNA llamada (clave en cabecera, no en la URL) y devuelve la sugerencia saneada", async () => {
    const f = gemini({ models: ["gemini-2.5-flash"], onModel: () => ok(remito) });
    const out = await extractRemito([jpg, pdf], { fetchImpl: f as never, env: env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.5-flash" }) });
    expect(out.ok).toBe(true);
    const g = f.generate()[0]!;
    expect(g.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(g.url).not.toContain(KEY);
    expect(g.key).toBe(KEY);
    const parts = (g.body!.contents as Array<{ parts: Array<Part> }>)[0]!.parts;
    expect(parts).toHaveLength(3);
    expect(parts[1]!.inline_data?.mime_type).toBe("image/jpeg");
    expect(parts[2]!.inline_data?.mime_type).toBe("application/pdf");
    expect(g.body!.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    if (!out.ok) return;
    expect(out.data.lines).toHaveLength(2);
    expect(out.data.lines[0]).toMatchObject({ supplierCode: "AB-77", quantity: "100", unit: "kg", packages: "4", lote: "L-77", vencimiento: "2029-06-30" });
    expect(out.data.lines[1]!.review).toEqual(expect.arrayContaining(["lote", "vencimiento"]));
  });
  it("apagada o sin clave: no llama a nadie y explica el motivo", async () => {
    const f = vi.fn();
    expect(await extractRemito([jpg], { fetchImpl: f as never, env: { GEMINI_API_KEY: KEY, INGRESO_REMITO_EXTRACTION: "off" } as never })).toMatchObject({ ok: false, kind: "disabled" });
    expect(await extractRemito([jpg], { fetchImpl: f as never, env: { INGRESO_REMITO_EXTRACTION: "gemini" } as never })).toMatchObject({ ok: false, kind: "config" });
    expect(f).not.toHaveBeenCalled();
  });
  it("respuesta vacía, bloqueada, JSON roto o sin datos → «No pudimos interpretar…»", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = (resp: () => Response) => extractRemito([jpg], { fetchImpl: gemini({ models: ["gemini-2.5-flash"], onModel: resp }) as never, env: env() });
    resetModelCacheForTests();
    expect(await run(() => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }] }))).toEqual({ ok: false, kind: "unreadable", message: MSG_UNREADABLE });
    expect(await run(() => json(200, { promptFeedback: { blockReason: "SAFETY" } }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(await run(() => ok("no es json"))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(await run(() => ok({ supplier: "", remitoNumber: "", lines: [] }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(MSG_UNREADABLE).toMatch(/reintentar o completar los datos manualmente/);
  });
  it("tolera ```json … ``` y una lista de líneas como raíz", async () => {
    expect((await extractRemito([jpg], { fetchImpl: gemini({ models: ["gemini-2.5-flash"], onModel: () => ok("```json\n" + JSON.stringify(remito) + "\n```") }) as never, env: env() })).ok).toBe(true);
    const arr = await extractRemito([jpg], { fetchImpl: gemini({ models: ["gemini-2.5-flash"], onModel: () => ok(remito.lines) }) as never, env: env() });
    expect(arr.ok && arr.data.lines.length).toBe(2);
  });
  it("red caída y timeout → mensajes distintos, sin lanzar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const e = env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.5-flash" });
    expect(await extractRemito([jpg], { fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as never, env: e })).toMatchObject({ ok: false, kind: "unavailable" });
    expect(await extractRemito([jpg], { fetchImpl: (async () => { const x = new Error("aborted"); x.name = "AbortError"; throw x; }) as never, env: e })).toMatchObject({ ok: false, kind: "timeout" });
  });
  it("limita hojas y peso enviados", async () => {
    const big = { bytes: new Uint8Array(6 * 1024 * 1024).fill(0xff), contentType: "image/jpeg" };
    const f = gemini({ models: ["gemini-2.5-flash"], onModel: () => ok(remito) });
    await extractRemito([big, big, big, big], { fetchImpl: f as never, env: env() });
    expect((f.generate()[0]!.body!.contents as Array<{ parts: unknown[] }>)[0]!.parts.length).toBe(1 + 2);
  });
  it("la URL base solo se puede cambiar a localhost (pruebas) y nunca en Vercel", async () => {
    const run = async (extra: Record<string, string>) => {
      resetModelCacheForTests();
      const f = gemini({ models: ["gemini-2.5-flash"], onModel: () => ok(remito) });
      await extractRemito([jpg], { fetchImpl: f as never, env: env(extra) });
      return f.calls[0]!.url;
    };
    expect(await run({ INGRESO_REMITO_GEMINI_BASE_URL: "http://127.0.0.1:4599" })).toMatch(/^http:\/\/127\.0\.0\.1:4599\/v1beta\//);
    expect(await run({ INGRESO_REMITO_GEMINI_BASE_URL: "https://evil.example.com" })).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(await run({ INGRESO_REMITO_GEMINI_BASE_URL: "http://127.0.0.1:4599", VERCEL: "1" })).toMatch(/^https:\/\/generativelanguage/);
  });
});

describe("prueba de configuración (view=extraction_health)", () => {
  it("texto: informa modelo efectivo, modelos que ve la clave e intentos; la clave jamás aparece", async () => {
    const f = gemini({ models: ["gemini-3.5-flash", "gemini-2.5-flash"], onModel: (m) => (m === "gemini-2.0-flash" ? err(404, "NOT_FOUND", "gone") : ok("OK")) });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const p = await probeExtraction({ fetchImpl: f as never, env: env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.0-flash", CREAMY_GEMINI_MODEL: "gemini-2.5-flash" }) });
    expect(p).toMatchObject({ ok: true, configuredModel: "gemini-2.0-flash", modelSource: "INGRESO_REMITO_GEMINI_MODEL", creamyModel: "gemini-2.5-flash", effectiveModel: "gemini-3.5-flash" });
    expect(p.listing).toMatchObject({ ok: true, count: 2, candidates: ["gemini-3.5-flash", "gemini-2.5-flash"] });
    expect(p.attempts).toEqual([{ model: "gemini-2.0-flash", status: 404, kind: "model" }, { model: "gemini-3.5-flash", status: 200, kind: "ok" }]);
    expect(p.image).toBeNull();
    expect(JSON.stringify(p)).not.toContain(KEY);
    expect(f.generate().every((c) => (c.body!.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts.every((x) => "text" in x))).toBe(true); // ningún documento
  });
  it("con imagen: lee el remito de PRUEBA incorporado y confirma que el modelo analiza imágenes", async () => {
    const f = gemini({ models: ["gemini-2.5-flash"], onModel: (_m, body) => {
      const hasImage = (body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts.some((x) => "inline_data" in x);
      return hasImage ? ok(remito) : ok("OK");
    } });
    const p = await probeExtraction({ fetchImpl: f as never, env: env(), image: true });
    expect(p).toMatchObject({ ok: true, message: expect.stringContaining("imagen de prueba") });
    expect(p.image).toMatchObject({ ok: true, read: { lines: 2 } });
    const imageCall = f.generate().find((c) => (c.body!.contents as Array<{ parts: Array<Part> }>)[0]!.parts.some((x) => x.inline_data))!;
    expect((imageCall.body!.contents as Array<{ parts: Array<Part> }>)[0]!.parts[1]!.inline_data?.mime_type).toBe("image/png");
  });
  it("fallas: clave inválida y modelo inexistente se distinguen; apagada también", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bad = await probeExtraction({ fetchImpl: gemini({ models: [], listStatus: 400, onModel: () => err(400, "INVALID_ARGUMENT", `API key not valid ${KEY}`) }) as never, env: env() });
    expect(bad).toMatchObject({ ok: false, text: { ok: false, kind: "key" }, listing: { ok: false } });
    expect(JSON.stringify(bad)).not.toContain(KEY);
    resetModelCacheForTests();
    const gone = await probeExtraction({ fetchImpl: gemini({ models: ["gemini-3.5-flash"], onModel: () => err(404, "NOT_FOUND", "x") }) as never, env: env() });
    expect(gone).toMatchObject({ ok: false, text: { ok: false, kind: "model" } });
    expect(await probeExtraction({ env: { GEMINI_API_KEY: KEY, INGRESO_REMITO_EXTRACTION: "off" } as never })).toMatchObject({ ok: false, code: "disabled" });
  });
  it("redactSecrets", () => {
    expect(redactSecrets(`falló con ${KEY} y api_key=abcdef123456`)).not.toMatch(/AIza|abcdef123456/);
  });
});
