import { afterEach, describe, expect, it, vi } from "vitest";
import { MSG_UNREADABLE, extractRemito, extractionConfig, probeExtraction, redactSecrets } from "./receipt-extraction";

const KEY = "AIzaSyFAKE_KEY_FOR_TESTS_0123456789abcd";
const env = (over: Record<string, string> = {}) => ({ INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, ...over }) as Partial<NodeJS.ProcessEnv>;
const jpg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: "image/jpeg" };
const pdf = { bytes: new Uint8Array(Buffer.from("%PDF-1.4 x")), contentType: "application/pdf" };
const gemini = (obj: unknown, init: { status?: number; raw?: string } = {}) =>
  vi.fn(async () => new Response(init.raw ?? JSON.stringify(init.status && init.status >= 400 ? obj : { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: init.status ?? 200, headers: { "content-type": "application/json" } }));
const remito = {
  supplier: "Droguería Sur SA", remitoNumber: "0001-00012345", remitoDate: "2026-10-15", notes: "Entrega parcial", unclearFields: [],
  lines: [
    { supplierCode: "AB-77", description: "Glicerina vegetal USP", quantity: 100, unit: "kg", packages: 4, lot: "L-77", expiryDate: "2029-06-30", notes: "", confidence: 0.95, unclearFields: [] },
    { supplierCode: "ZZ-1", description: "Alcohol cetílico", quantity: "25,5", unit: "KG", packages: null, lot: "", expiryDate: "", notes: "", confidence: 0.4, unclearFields: ["lot"] },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("configuración de la lectura automática", () => {
  it("apagada por defecto, aunque exista la clave de Gemini (no se envían remitos sin autorización)", () => {
    const c = extractionConfig({ GEMINI_API_KEY: KEY } as never);
    expect(c).toMatchObject({ available: false, code: "disabled" });
    expect(c.reason).toMatch(/no está activada/);
  });
  it("habilitada pero sin clave → missing_key; habilitada con clave → ok", () => {
    expect(extractionConfig({ INGRESO_REMITO_EXTRACTION: "gemini" } as never)).toMatchObject({ available: false, code: "missing_key" });
    expect(extractionConfig(env())).toMatchObject({ available: true, code: "ok", provider: "gemini", model: "gemini-2.5-flash" });
    expect(extractionConfig(env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.0-flash" })).model).toBe("gemini-2.0-flash");
  });
});

describe("extractRemito", () => {
  it("manda el/los archivos a Gemini (una sola llamada, clave en cabecera) y devuelve la sugerencia saneada", async () => {
    const f = gemini(remito);
    const out = await extractRemito([jpg, pdf], { fetchImpl: f as never, env: env() });
    expect(out.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain(KEY); // la clave nunca viaja en la URL
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(init.body));
    const parts = body.contents[0].parts;
    expect(parts).toHaveLength(3); // prompt + 2 hojas
    expect(parts[1].inline_data.mime_type).toBe("image/jpeg");
    expect(parts[2].inline_data.mime_type).toBe("application/pdf");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    if (!out.ok) return;
    expect(out.data.supplier).toBe("Droguería Sur SA");
    expect(out.data.remitoNumber).toBe("0001-00012345");
    expect(out.data.remitoDate).toBe("2026-10-15");
    expect(out.data.lines).toHaveLength(2);
    expect(out.data.lines[0]).toMatchObject({ supplierCode: "AB-77", quantity: "100", unit: "kg", packages: "4", lote: "L-77", vencimiento: "2029-06-30" });
    expect(out.data.lines[1]).toMatchObject({ quantity: "25.5", unit: "KG", lote: "", vencimiento: "" });
    expect(out.data.lines[1]!.review).toEqual(expect.arrayContaining(["lote", "vencimiento"])); // lo ilegible queda vacío y marcado
  });
  it("no manda thinkingConfig a modelos que no lo soportan", async () => {
    const f = gemini(remito);
    await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_GEMINI_MODEL: "gemini-2.0-flash" }) });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).generationConfig.thinkingConfig).toBeUndefined();
  });
  it("apagada o sin clave: no llama a nadie y explica el motivo", async () => {
    const f = vi.fn();
    const off = await extractRemito([jpg], { fetchImpl: f as never, env: { GEMINI_API_KEY: KEY } as never });
    expect(off).toMatchObject({ ok: false, kind: "disabled" });
    const nokey = await extractRemito([jpg], { fetchImpl: f as never, env: { INGRESO_REMITO_EXTRACTION: "gemini" } as never });
    expect(nokey).toMatchObject({ ok: false, kind: "config" });
    expect(f).not.toHaveBeenCalled();
  });
  it("errores de Gemini → mensajes claros, sin filtrar la clave, y quedan registrados", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cases: Array<[number, string, string]> = [
      [400, `API key not valid. Please pass a valid API key. ${KEY}`, "config"],
      [403, "PERMISSION_DENIED", "config"],
      [404, "model not found", "config"],
      [429, "quota", "limit"],
      [503, "overloaded", "unavailable"],
    ];
    for (const [status, message, kind] of cases) {
      const out = await extractRemito([jpg], { fetchImpl: gemini({ error: { code: status, message } }, { status }) as never, env: env() });
      expect(out).toMatchObject({ ok: false, kind });
      if (!out.ok) expect(out.message).not.toContain(KEY);
    }
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toMatch(/lectura automática falló/);
    expect(logged).not.toContain(KEY);
  });
  it("respuesta vacía, bloqueada, JSON roto o sin datos → «No pudimos interpretar…» (sin fallo silencioso)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = (f: unknown) => extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(await run(gemini({}, { raw: JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "" }] } }] }) }))).toEqual({ ok: false, kind: "unreadable", message: MSG_UNREADABLE });
    expect(await run(gemini({}, { raw: JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }) }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(await run(gemini({}, { raw: JSON.stringify({ candidates: [{ content: { parts: [{ text: "no es json" }] } }] }) }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(await run(gemini({ supplier: "", remitoNumber: "", lines: [] }))).toMatchObject({ ok: false, kind: "unreadable" });
    expect(MSG_UNREADABLE).toMatch(/reintentar o completar los datos manualmente/);
  });
  it("tolera ```json … ``` y una lista de líneas como raíz", async () => {
    const fenced = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(remito) + "\n```" }] } }] }), { status: 200 }));
    expect((await extractRemito([jpg], { fetchImpl: fenced as never, env: env() })).ok).toBe(true);
    const arr = await extractRemito([jpg], { fetchImpl: gemini(remito.lines) as never, env: env() });
    expect(arr.ok && arr.data.lines.length).toBe(2);
  });
  it("red caída y timeout → mensajes distintos, sin lanzar", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down = await extractRemito([jpg], { fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as never, env: env() });
    expect(down).toMatchObject({ ok: false, kind: "unavailable" });
    const aborted = await extractRemito([jpg], { fetchImpl: (async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) as never, env: env() });
    expect(aborted).toMatchObject({ ok: false, kind: "timeout" });
  });
  it("limita hojas y peso enviados", async () => {
    const big = { bytes: new Uint8Array(6 * 1024 * 1024).fill(0xff), contentType: "image/jpeg" };
    const f = gemini(remito);
    await extractRemito([big, big, big, big], { fetchImpl: f as never, env: env() });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).contents[0].parts.length).toBe(1 + 2); // prompt + 2 (≤ 14 MB)
  });
  it("la URL base solo se puede cambiar a localhost (pruebas) y nunca en Vercel", async () => {
    const f = gemini(remito);
    await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_GEMINI_BASE_URL: "http://127.0.0.1:4599" }) });
    expect((f.mock.calls[0] as unknown as [string])[0]).toMatch(/^http:\/\/127\.0\.0\.1:4599\/v1beta\//);
    const g = gemini(remito);
    await extractRemito([jpg], { fetchImpl: g as never, env: env({ INGRESO_REMITO_GEMINI_BASE_URL: "https://evil.example.com" }) });
    expect((g.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    const h = gemini(remito);
    await extractRemito([jpg], { fetchImpl: h as never, env: env({ INGRESO_REMITO_GEMINI_BASE_URL: "http://127.0.0.1:4599", VERCEL: "1" }) });
    expect((h.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/generativelanguage/);
  });
});

describe("prueba de configuración (sin enviar remitos)", () => {
  it("ok / clave rechazada / apagada", async () => {
    const ok = await probeExtraction({ fetchImpl: gemini({ ok: true }) as never, env: env() });
    expect(ok).toMatchObject({ ok: true, code: "ok" });
    const f = gemini({ error: { message: `API key not valid ${KEY}` } }, { status: 400 });
    const bad = await probeExtraction({ fetchImpl: f as never, env: env() });
    expect(bad).toMatchObject({ ok: false, code: "http_error", status: 400 });
    expect(bad.message).not.toContain(KEY);
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).contents[0].parts).toHaveLength(1); // solo texto: ningún documento
    expect(await probeExtraction({ env: { GEMINI_API_KEY: KEY } as never })).toMatchObject({ ok: false, code: "disabled" });
  });
  it("redactSecrets", () => {
    expect(redactSecrets(`falló con ${KEY} y api_key=abcdef123456`)).not.toMatch(/AIza|abcdef123456/);
  });
});
