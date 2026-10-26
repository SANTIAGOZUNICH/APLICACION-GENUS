import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askGeminiJson, extractRemito, resetModelCacheForTests, salvagePartialJson } from "./receipt-extraction";
import { lineConfidence, sanitizeExtraction } from "./receipt-rules";

const KEY = "AIzaSyFAKE_KEY_FOR_TESTS_0123456789abcd";
const jpg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), contentType: "image/jpeg" };
const line = (i: number, extra: Record<string, unknown> = {}) => ({ supplierCode: `C-${i}`, description: `Material ${i}`, quantity: 10 + i, unit: "kg", lot: `L${i}`, expiryDate: "2029-01-31", confidence: 0.9, ...extra });
const remito = (n: number) => ({ supplier: "Droguería Sur SA", remitoNumber: "0001-00012345", remitoDate: "2026-10-15", notes: "", lines: Array.from({ length: n }, (_, i) => line(i + 1)) });
const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });
const sleepAbortable = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });

beforeEach(() => {
  resetModelCacheForTests();
  vi.spyOn(console, "warn").mockImplementation((...a) => { if (process.env.DBG) console.log(...a); });
});
afterEach(() => vi.restoreAllMocks());

/** Proveedor simulado: `plan[i]` decide la i-ésima llamada de generateContent. */
function provider(plan: Array<{ delay?: number; text?: string; status?: number }>) {
  let n = 0;
  const calls: number[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    if (/\/v1beta\/models\?/.test(String(url))) return new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-2.0-flash-b", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
    const step = plan[Math.min(n, plan.length - 1)]!;
    n++;
    calls.push(Date.now());
    await sleepAbortable(step.delay ?? 0, init?.signal ?? undefined);
    if (step.status && step.status >= 400) return new Response(JSON.stringify({ error: { code: step.status, status: "UNAVAILABLE", message: "overloaded" } }), { status: step.status });
    return ok(step.text ?? JSON.stringify(remito(2)));
  };
  return Object.assign(fn, { count: () => n, times: calls });
}
const env = (over: Record<string, string> = {}) => ({ INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, INGRESO_REMITO_RETRY_BASE_MS: "1", ...over }) as Partial<NodeJS.ProcessEnv>;

describe("intento colgado: ya no consume toda la lectura", () => {
  it("el primer intento no responde → se corta a tiempo y el siguiente modelo lee el remito dentro del presupuesto", async () => {
    const f = provider([{ delay: 5_000 }, { delay: 20, text: JSON.stringify(remito(3)) }]);
    const t0 = Date.now();
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_BUDGET_MS: "900", INGRESO_REMITO_ATTEMPT_MS: "250" }) });
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.data.lines).toHaveLength(3);
    expect(Date.now() - t0).toBeLessThan(900);
    expect(f.count()).toBe(2);
  });
  it("si NADA responde se informa timeout dentro del presupuesto (sin colgarse ni reintentar sin fin)", async () => {
    const f = provider([{ delay: 10_000 }]);
    const t0 = Date.now();
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_BUDGET_MS: "700", INGRESO_REMITO_ATTEMPT_MS: "200" }) });
    expect(out.ok).toBe(false);
    if (process.env.DBG) console.log("TIMES", f.times.map((x) => x - t0), Date.now() - t0);
    expect(Date.now() - t0).toBeLessThan(900);
    expect(f.count()).toBeLessThanOrEqual(3);
    if (!out.ok) expect(out.kind).toMatch(/timeout|unavailable/);
  });
});

describe("respuesta cortada: resultado parcial aprovechable", () => {
  it("JSON truncado en el 3.er renglón → se rescatan encabezado y renglones completos, marcados como parcial", async () => {
    const full = JSON.stringify(remito(5));
    const cut = full.slice(0, full.indexOf('"description":"Material 4"')); // corta a mitad del 4.º renglón
    const f = provider([{ text: cut }]);
    const out = await extractRemito([jpg], { fetchImpl: f as never, env: env() });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.partial).toBe(true);
      expect(out.data.supplier).toBe("Droguería Sur SA");
      expect(out.data.lines.map((l) => l.description)).toEqual(["Material 1", "Material 2", "Material 3"]);
    }
  });
  it("salvagePartialJson no inventa nada: sin renglones ni encabezado → null", () => {
    expect(salvagePartialJson('{"lines":[{"supplierCode":"A')).toBeNull();
    expect(salvagePartialJson("basura")).toBeNull();
  });
  it("las llaves dentro de un texto no rompen el rescate", () => {
    const r = salvagePartialJson('{"supplier":"X","lines":[{"description":"Glicerina {USP}","quantity":1},{"description":"cor');
    expect((r?.lines as unknown[]).length).toBe(1);
  });
});

describe("una línea ilegible no tira el remito", () => {
  it("devuelve el resto y marca SOLO la línea dudosa (confianza BAJA); nunca inventa valores", () => {
    const raw = { ...remito(3), lines: [line(1), line(2, { description: "", quantity: null, unclearFields: ["description", "quantity"], confidence: 0.2 }), line(3, { unclearFields: ["lot"] })] };
    const d = sanitizeExtraction(raw)!;
    expect(d.lines).toHaveLength(3);
    expect(d.lines.map((l) => l.confidence)).toEqual(["ALTA", "BAJA", "MEDIA"]);
    expect(d.lines[1]!.quantity).toBe("");
    expect(d.lines[0]!.review).not.toContain("quantity");
    expect(d.lines[1]!.review).toEqual(expect.arrayContaining(["description", "quantity"]));
  });
  it("lineConfidence: falta de lote/vencimiento no es duda", () => {
    expect(lineConfidence({ description: "x", quantity: "5", doubtful: [] })).toBe("ALTA");
    expect(lineConfidence({ description: "x", quantity: "5", doubtful: ["unit"] })).toBe("MEDIA");
    expect(lineConfidence({ description: "x", quantity: "", doubtful: [] })).toBe("BAJA");
    expect(lineConfidence({ description: "x", quantity: "5", doubtful: [], modelConfidence: 0.3 })).toBe("BAJA");
  });
});

describe("askGeminiJson (texto, presupuesto corto)", () => {
  it("devuelve el JSON y respeta el tope", async () => {
    const f = provider([{ text: '{"results":[]}' }]);
    const r = await askGeminiJson("hola", { fetchImpl: f as never, env: env() });
    expect(r).toMatchObject({ ok: true, json: { results: [] } });
  });
  it("sin respuesta a tiempo → ok:false (la lectura sigue sin la ayuda de la IA)", async () => {
    const f = provider([{ delay: 5_000 }]);
    const t0 = Date.now();
    const r = await askGeminiJson("hola", { fetchImpl: f as never, env: env(), budgetMs: 600 });
    expect(r.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1_500);
  });
});

/**
 * COMPARACIÓN SIMULADA antes/después con el MISMO escenario (no son mediciones reales de Gemini): «antes» = un único cronómetro para toda
 * la lectura (intento = presupuesto), «ahora» = tope por intento. Escala 1/100 del tiempo real (50 s → 500 ms).
 */
describe("comparación simulada antes/después (mismos escenarios)", () => {
  const scenarios: Array<{ name: string; plan: Array<{ delay?: number; text?: string; status?: number }> }> = [
    { name: "primer intento colgado, el segundo responde en 150 ms", plan: [{ delay: 5_000 }, { delay: 150 }] },
    { name: "respuesta normal de 120 ms", plan: [{ delay: 120 }] },
    { name: "saturado una vez y luego responde", plan: [{ status: 503 }, { delay: 120 }] },
  ];
  it("ahora no tarda más que antes y recupera el escenario del intento colgado", async () => {
    const rows: string[] = [];
    for (const sc of scenarios) {
      const run = async (over: Record<string, string>) => {
        resetModelCacheForTests();
        const f = provider(sc.plan);
        const t0 = Date.now();
        const out = await extractRemito([jpg], { fetchImpl: f as never, env: env({ INGRESO_REMITO_BUDGET_MS: "500", ...over }) });
        return { ok: out.ok, ms: Date.now() - t0 };
      };
      const before = await run({ INGRESO_REMITO_ATTEMPT_MS: "500" });
      const after = await run({ INGRESO_REMITO_ATTEMPT_MS: "170" });
      rows.push(`${sc.name}: antes ${before.ok ? "OK" : "FALLA"} ${before.ms} ms · ahora ${after.ok ? "OK" : "FALLA"} ${after.ms} ms`);
      if (sc.name.startsWith("primer intento colgado")) {
        expect(before.ok).toBe(false); // antes: el cronómetro único se agotaba esperando al intento colgado
        expect(after.ok).toBe(true);
      } else {
        expect(after.ok).toBe(true);
        expect(after.ms).toBeLessThanOrEqual(before.ms + 150);
      }
    }
    console.info(`\n[simulado] ${rows.join("\n[simulado] ")}`);
  });
});
