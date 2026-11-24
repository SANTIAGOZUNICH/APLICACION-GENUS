/**
 * Lectura progresiva de remitos: etapas, mejora de imagen, tolerancia a fallos del proveedor y precisión de cantidades.
 * Proveedor SIMULADO (no hay clave real en CI): se verifican las decisiones del sistema (cuándo reintenta, cuándo mejora la imagen, qué
 * conserva), no la capacidad de lectura del modelo. Imágenes sintéticas generadas con `sharp` (sin datos reales).
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_PROVIDER_DOWN, MSG_UNREADABLE, extractRemito, resetModelCacheForTests } from "./receipt-extraction";
import { enhanceReceiptImages } from "./receipt-image-enhance";
import { fillEmptyFields, readMessage } from "./receipt-service";
import { importantMissing, mergeExtractions, parseNumber, sanitizeExtraction, type ExtractedRemito } from "./receipt-rules";

const KEY = "AIzaSyFAKE_KEY_FOR_TESTS_0123456789abcd";
const env = (over: Record<string, string> = {}) => ({ INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, INGRESO_REMITO_RETRY_BASE_MS: "1", INGRESO_REMITO_GEMINI_MODEL: "gemini-2.5-flash", ...over }) as Partial<NodeJS.ProcessEnv>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const ok = (obj: unknown) => json(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, totalTokenCount: 1500 } });
const gerr = (status: number, gstatus: string, message: string, details: unknown[] = [], headers: Record<string, string> = {}) => json(status, { error: { code: status, status: gstatus, message, details } }, headers);

const full = {
  supplier: "Envases del Sur SA", remitoNumber: "0001-00004567", remitoDate: "2026-11-10", notes: "",
  lines: [
    { supplierCode: "FR-30", description: "Frasco PET 30 ml", quantity: 10000, quantityText: "10.000", unit: "un", lot: "L-889", confidence: 0.95 },
    { supplierCode: "TP-24", description: "Tapa rosca 24/410", quantity: 1000, quantityText: "1.000", unit: "un", confidence: 0.95 },
  ],
};
const missingQty = { ...full, lines: [{ ...full.lines[0] }, { supplierCode: "TP-24", description: "Tapa rosca 24/410", quantity: null, unit: "un", unclearFields: ["quantity"], confidence: 0.4 }] };

type Call = { model?: string; parts: Array<Record<string, unknown>> };
/** Servidor simulado: `plan(callIndex, call)` decide cada llamada de generateContent. */
function provider(plan: (n: number, c: Call) => Response, models = ["gemini-2.5-flash", "gemini-3.5-flash"]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (/\/v1beta\/models\?/.test(u)) return json(200, { models: models.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ["generateContent"] })) });
    const body = JSON.parse(String(init?.body ?? "{}")) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    const call: Call = { model: /models\/([^:]+):generateContent/.exec(u)?.[1], parts: body.contents[0]!.parts };
    calls.push(call);
    return plan(calls.length - 1, call);
  });
  return Object.assign(fn, { calls });
}

/** Remito sintético: tabla, logo/imágenes decorativas, texto chico, sombra y/o inclinación. */
async function syntheticRemito(opts: { tilt?: number; shadow?: boolean; tiny?: boolean; width?: number } = {}) {
  const w = opts.width ?? 1400;
  const h = Math.round(w * 1.3);
  const fs = opts.tiny ? 11 : 26;
  const rows = [["FR-30", "Frasco PET 30 ml", "10.000", "un"], ["TP-24", "Tapa rosca 24/410", "1.000", "un"], ["ET-88", "Etiqueta frente 50x80", "5.000", "un"]];
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f4f1e8"/>
    <circle cx="${w - 160}" cy="120" r="70" fill="#c33"/><rect x="40" y="40" width="260" height="110" fill="#38a"/>
    <text x="60" y="230" font-size="${fs + 10}" font-family="sans-serif">REMITO N° 0001-00004567   Fecha 10/11/2026</text>
    <text x="60" y="280" font-size="${fs}" font-family="sans-serif">Envases del Sur SA  - CUIT 30-00000000-0</text>
    ${rows.map((r, i) => `<text x="60" y="${380 + i * 70}" font-size="${fs}" font-family="sans-serif">${r[0]}   ${r[1]}   ${r[2]} ${r[3]}</text>`).join("")}
    <text x="60" y="${h - 120}" font-size="${fs - 4}" font-family="sans-serif" fill="#777">Condiciones de venta: texto legal irrelevante para el ingreso.</text></svg>`;
  let img = sharp(Buffer.from(svg)).png();
  if (opts.shadow) {
    const shade = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    img = sharp(await img.toBuffer()).composite([{ input: Buffer.from(shade), blend: "over" }]).png();
  }
  let out = await img.jpeg({ quality: 82 }).toBuffer();
  if (opts.tilt) out = await sharp(out).rotate(opts.tilt, { background: "#555" }).jpeg({ quality: 82 }).toBuffer();
  return { bytes: new Uint8Array(out), contentType: "image/jpeg" };
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

beforeEach(() => {
  resetModelCacheForTests();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("mejora automática de la imagen (conserva el original)", () => {
  it("remito inclinado, con sombra, texto chico e imágenes decorativas: genera copias válidas sin tocar el original y sin reducir la resolución", async () => {
    for (const variant of [{ tilt: 7 }, { shadow: true }, { tiny: true }, { tilt: -5, shadow: true, tiny: true }]) {
      const src = await syntheticRemito(variant);
      const before = sha(src.bytes);
      const meta0 = await sharp(Buffer.from(src.bytes)).metadata();
      const res = await enhanceReceiptImages([src], { regions: ["encabezado", "tabla"] });
      expect(res.applied).toBe(true);
      expect(sha(src.bytes)).toBe(before); // el original NO se modifica
      expect(res.images.map((i) => i.region)).toEqual(["completa", "encabezado", "tabla"]);
      for (const img of res.images) {
        const m = await sharp(Buffer.from(img.bytes)).metadata();
        expect(m.format).toBe("jpeg");
        expect(img.bytes.length).toBeLessThanOrEqual(3_500_000);
        expect(Math.max(m.width!, m.height!)).toBeGreaterThanOrEqual(Math.min(Math.max(meta0.width!, meta0.height!), 1600) * 0.5);
      }
      const whole = await sharp(Buffer.from(res.images[0]!.bytes)).metadata();
      expect(Math.max(whole.width!, whole.height!)).toBeGreaterThanOrEqual(Math.max(meta0.width!, meta0.height!) * 0.55); // el recorte de márgenes nunca se «come» el documento
    }
  }, 60_000);
  it("aplana la sombra: el brillo del fondo queda más parejo que en la foto original", async () => {
    const src = await syntheticRemito({ shadow: true });
    const mean = async (b: Uint8Array, left: number, top: number) => {
      const raw = await sharp(Buffer.from(b)).extract({ left, top, width: 100, height: 100 }).grayscale().raw().toBuffer();
      return raw.reduce((a, v) => a + v, 0) / raw.length;
    };
    const gapBefore = Math.abs((await mean(src.bytes, 20, 700)) - (await mean(src.bytes, 1200, 700)));
    expect(gapBefore).toBeGreaterThan(60); // la foto tiene una sombra marcada
    const enh = (await enhanceReceiptImages([src])).images[0]!;
    const m = await sharp(Buffer.from(enh.bytes)).metadata();
    const k = m.width! / 1400;
    const gapAfter = Math.abs((await mean(enh.bytes, Math.round(20 * k), Math.round(700 * k))) - (await mean(enh.bytes, Math.round(1200 * k), Math.round(700 * k))));
    expect(gapAfter).toBeLessThan(gapBefore / 3);
  }, 30_000);
  it("PDF y formatos no mejorables se dejan tal cual (no hay copia mejorada); archivo roto → sin copia, sin lanzar", async () => {
    const pdf = { bytes: new Uint8Array(Buffer.from("%PDF-1.4 digital")), contentType: "application/pdf" };
    expect(await enhanceReceiptImages([pdf])).toMatchObject({ applied: false });
    expect(await enhanceReceiptImages([{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" }])).toMatchObject({ applied: false });
  });
});

describe("lectura progresiva: no gasta llamadas de más", () => {
  it("remito legible: UNA sola llamada, sin mejora de imagen, y el diagnóstico no contiene la clave", async () => {
    const f = provider(() => ok(full));
    const src = await syntheticRemito();
    const out = await extractRemito([src], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, pending: [] });
    expect(f.calls).toHaveLength(1);
    if (!out.ok) return;
    expect(out.diag?.stages.map((s) => s.stage)).toEqual(["lectura"]);
    expect(out.diag?.tokens?.total).toBe(1500);
    expect(JSON.stringify(out.diag)).not.toContain(KEY);
    expect(out.diag).toMatchObject({ provider: "gemini", model: "gemini-2.5-flash", enhanced: false });
  });
  it("el pedido es compacto: pide solo campos del ingreso, ignora logos/legales y fija la regla de separadores argentinos", async () => {
    const f = provider(() => ok(full));
    await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env(), module: "ME" });
    const prompt = String(f.calls[0]!.parts[0]!.text);
    expect(prompt.length).toBeLessThan(4200);
    expect(prompt).toMatch(/ignorá logos/i);
    expect(prompt).toMatch(/1\.000 = mil/);
    expect(prompt).not.toMatch(/transcrib/i);
  });
  it("varias hojas van en UNA llamada y un PDF digital viaja tal cual (sin pasar por la mejora)", async () => {
    const f = provider(() => ok(full));
    const pdf = { bytes: new Uint8Array(Buffer.from("%PDF-1.4 con texto digital")), contentType: "application/pdf" };
    await extractRemito([await syntheticRemito(), await syntheticRemito({ tilt: 3 }), pdf], { fetchImpl: f as never, env: env() });
    expect(f.calls).toHaveLength(1);
    const files = f.calls[0]!.parts.filter((p) => p.inline_data) as Array<{ inline_data: { mime_type: string } }>;
    expect(files.map((p) => p.inline_data.mime_type)).toEqual(["image/jpeg", "image/jpeg", "application/pdf"]);
  });
});

describe("segunda etapa: recuperar SOLO lo que falta con la imagen mejorada", () => {
  it("falta una cantidad → relee con la copia mejorada, completa ese dato y NO pisa lo ya identificado", async () => {
    const src = await syntheticRemito({ shadow: true, tilt: 4 });
    const f = provider((n) => (n === 0 ? ok(missingQty) : ok({ supplier: "OTRO NOMBRE", remitoNumber: "9999", lines: [{ supplierCode: "TP-24", description: "Tapa rosca 24/410", quantity: 1000, quantityText: "1.000", unit: "un" }] })));
    const out = await extractRemito([src], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, pending: [] });
    expect(f.calls).toHaveLength(2);
    if (!out.ok) return;
    expect(out.data.supplier).toBe("Envases del Sur SA"); // identificado en la 1.ª etapa: no se pisa
    expect(out.data.remitoNumber).toBe("0001-00004567");
    expect(out.data.lines.map((l) => l.quantity)).toEqual(["10000", "1000"]);
    const second = f.calls[1]!;
    expect(String(second.parts[0]!.text)).toMatch(/SEGUNDA LECTURA/);
    expect(String(second.parts[0]!.text)).toMatch(/renglón 2: cantidad/);
    const sent = (second.parts.filter((p) => p.inline_data) as Array<{ inline_data: { data: string } }>).map((p) => p.inline_data.data);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.includes(Buffer.from(src.bytes).toString("base64"))).toBe(false); // se envió la versión MEJORADA, no el original
    expect(out.diag?.enhanced).toBe(true);
    expect(out.diag?.stages.find((s) => s.stage === "mejora")?.recovered).toContain("quantity");
  });
  it("sigue faltando → etapa de respaldo con OTRO modelo; si recupera, lo conserva", async () => {
    const f = provider((n, c) => (c.model === "gemini-3.5-flash" ? ok(full) : ok(missingQty)));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, pending: [] });
    expect(new Set(f.calls.map((c) => c.model))).toEqual(new Set(["gemini-2.5-flash", "gemini-3.5-flash"]));
    if (out.ok) expect(out.diag?.stages.map((s) => s.stage)).toEqual(["lectura", "mejora", "respaldo"]);
  });
  it("sin recuperar nada: devuelve lo identificado y marca SOLO lo pendiente (no rechaza el remito entero)", async () => {
    const f = provider(() => ok(missingQty), ["gemini-2.5-flash"]);
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, pending: ["quantity"] });
    if (!out.ok) return;
    expect(out.data.supplier).toBe("Envases del Sur SA");
    expect(out.data.lines[0]!.quantity).toBe("10000");
    expect(out.data.lines[1]!.quantity).toBe(""); // nunca 0 ni inventado
    expect(out.data.lines[1]!.review).toContain("quantity");
    expect(out.data.lines[0]!.review).not.toContain("quantity");
  });
  it("texto realmente ilegible tras mejorar la imagen → recién ahí «Necesito una imagen más clara del texto»", async () => {
    const f = provider(() => ok({ supplier: "", remitoNumber: "", remitoDate: "", lines: [] }));
    const out = await extractRemito([await syntheticRemito({ tiny: true })], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: false, kind: "unreadable", message: MSG_UNREADABLE });
    expect(f.calls.length).toBeGreaterThanOrEqual(2); // se intentó mejorar la imagen antes de pedir otra foto
  });
  it("una falla del SERVICIO nunca pide otra foto ni gasta la etapa de mejora", async () => {
    const f = provider(() => gerr(503, "UNAVAILABLE", "The model is overloaded"));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: false, kind: "overloaded", message: MSG_PROVIDER_DOWN });
    expect((out as { message: string }).message).not.toMatch(/imagen más clara|otra foto/i);
    expect(out.ok === false && out.diag).toMatchObject({ errorKind: "overloaded", failedStage: "lectura", http: 503 });
  });
});

describe("fallas del proveedor: tolerancia sin ocultar el diagnóstico", () => {
  it("429 con Retry-After: espera lo que pide el proveedor y lee bien", async () => {
    const f = provider((n) => (n === 0 ? gerr(429, "RESOURCE_EXHAUSTED", "Quota exceeded for requests per minute", [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0s" }], { "retry-after": "0" }) : ok(full)), ["gemini-2.5-flash"]);
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true });
    expect(f.calls.length).toBe(2);
  });
  it("429 por minuto en un modelo: rota al otro modelo (cada modelo tiene su cupo)", async () => {
    const f = provider((n, c) => (c.model === "gemini-2.5-flash" ? gerr(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota", [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }]) : ok(full)));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, model: "gemini-3.5-flash" });
  });
  it("cuota DIARIA agotada: NO se reintenta (una llamada), mensaje de servicio y diagnóstico para Sistemas", async () => {
    const f = provider(() => gerr(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota", [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }]));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: false, kind: "quota", message: MSG_PROVIDER_DOWN });
    expect(f.calls).toHaveLength(1);
  });
  it("clave inválida / permisos: no se reintenta y el operario no ve texto técnico", async () => {
    for (const [status, st, msg] of [[400, "INVALID_ARGUMENT", "API key not valid"], [403, "PERMISSION_DENIED", "denied"]] as const) {
      resetModelCacheForTests();
      const f = provider(() => gerr(status, st, msg), ["gemini-2.5-flash"]);
      const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.message).toBe(MSG_PROVIDER_DOWN);
        expect(out.technical).toBeTruthy();
      }
    }
  });
  it("503 en el primer modelo (dos intentos) y el segundo responde: lectura completa", async () => {
    const f = provider((n, c) => (c.model === "gemini-2.5-flash" ? gerr(503, "UNAVAILABLE", "This model is currently experiencing high demand") : ok(full)));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true, model: "gemini-3.5-flash" });
    expect(f.calls.filter((c) => c.model === "gemini-2.5-flash").length).toBeLessThanOrEqual(2);
  });
  it("saturación que dura varias llamadas: aprovecha el presupuesto (hasta 9 intentos con espera creciente) en vez de rendirse a los ~3 s", async () => {
    const f = provider((n) => (n < 5 ? gerr(503, "UNAVAILABLE", "overloaded") : ok(full)));
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out).toMatchObject({ ok: true });
    expect(f.calls.length).toBe(6);
  });
  it("respuesta incompleta (JSON cortado) → se rescata lo completo y se marca parcial", async () => {
    const truncated = JSON.stringify(full).slice(0, JSON.stringify(full).indexOf('"TP-24"') - 12);
    const f = provider((n) => (n === 0 ? ok(truncated) : ok(missingQty)), ["gemini-2.5-flash"]);
    const out = await extractRemito([await syntheticRemito()], { fetchImpl: f as never, env: env() });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.data.lines[0]!.description).toBe("Frasco PET 30 ml");
  });
});

describe("precisión de cantidades (afectan el stock)", () => {
  const line = (o: Record<string, unknown>) => sanitizeExtraction({ supplier: "X SA", remitoNumber: "1", remitoDate: "2026-11-10", lines: [{ supplierCode: "A-1", description: "Material", unit: "un", ...o }] })!.lines[0]!;
  it("separadores argentinos: el texto IMPRESO manda sobre el número del modelo (1.000 ≠ 1 ni 10.000)", () => {
    expect(line({ quantity: 1, quantityText: "1.000" })).toMatchObject({ quantity: "1000" });
    expect(line({ quantity: 10, quantityText: "10.000" })).toMatchObject({ quantity: "10000" });
    expect(line({ quantity: 1000, quantityText: "10.000" })).toMatchObject({ quantity: "10000" });
    expect(line({ quantity: 500, quantityText: "5.000", unit: "un" }).quantity).toBe("5000");
    expect(line({ quantity: 25.5, quantityText: "25,5", unit: "kg" })).toMatchObject({ quantity: "25.5" });
    expect(line({ quantity: 1200.5, quantityText: "1.200,5", unit: "kg" }).quantity).toBe("1200.5");
  });
  it("una discrepancia entre el número del modelo y lo impreso se marca para revisar y se muestra la referencia", () => {
    const l = line({ quantity: 1, quantityText: "1.000" });
    expect(l.review).toContain("quantity");
    expect(l.notes).toMatch(/impresa «1\.000»/);
  });
  it("«1.500 kg» es ambiguo para pesos/volúmenes: se toma la regla argentina (1.500) y se marca; «0.500» nunca es miles", () => {
    const l = line({ quantity: 1500, quantityText: "1.500", unit: "kg" });
    expect(l.quantity).toBe("1500");
    expect(l.review).toContain("quantity");
    expect(parseNumber("0.500")).toBe(0.5);
    expect(parseNumber("1.500")).toBe(1500);
    expect(parseNumber("1,5")).toBe(1.5);
  });
  it("anotación manuscrita sobre una cantidad impresa: se conserva lo impreso, se muestran ambas y se pide revisar", () => {
    const l = line({ quantity: 1000, quantityText: "1.000", handwrittenQuantity: "1.200" });
    expect(l.quantity).toBe("1000");
    expect(l.review).toContain("quantity");
    expect(l.notes).toMatch(/manuscrita «1\.200»/);
    expect(l.notes).toMatch(/impresa 1000/);
  });
  it("cantidad desconocida o ilegible: queda vacía (nunca 0) y marcada; el n.º de remito no se toma como cantidad", () => {
    expect(line({ quantity: null })).toMatchObject({ quantity: "" });
    expect(line({ quantity: 0 })).toMatchObject({ quantity: "" });
    expect(line({ quantity: "ilegible" }).review).toContain("quantity");
    expect(line({ quantity: null, quantityText: "0001-00004567" }).quantity).toBe("");
  });
});

describe("datos incompletos: se completa todo lo identificado y se marca solo lo dudoso", () => {
  const base: ExtractedRemito = sanitizeExtraction({ supplier: "Envases del Sur SA", remitoNumber: "0001-1", remitoDate: "2026-11-10", lines: [{ supplierCode: "FR-30", description: "Frasco", quantity: 100, unit: "un", unclearFields: ["lot"] }] })!;
  it("lote ilegible: remito, cliente, material y cantidad se completan; solo el lote queda para revisar", () => {
    expect(base.lines[0]).toMatchObject({ quantity: "100", description: "Frasco" });
    expect(base.lines[0]!.review).toContain("lote");
    expect(base.lines[0]!.review).not.toContain("quantity");
    expect(importantMissing(base).any).toBe(false); // el lote no dispara relecturas
  });
  it("mergeExtractions completa solo lo vacío y mantiene lo ya leído", () => {
    const partial = sanitizeExtraction({ supplier: "Envases del Sur SA", remitoNumber: "", remitoDate: "", lines: [{ supplierCode: "FR-30", description: "Frasco", quantity: null, unit: "un" }] })!;
    const extra = sanitizeExtraction({ supplier: "Otro", remitoNumber: "0001-77", remitoDate: "2026-11-11", lines: [{ supplierCode: "FR-30", description: "Frasco PET", quantity: 250, unit: "un" }] })!;
    const m = mergeExtractions(partial, extra);
    expect(m).toMatchObject({ supplier: "Envases del Sur SA", remitoNumber: "0001-77", remitoDate: "2026-11-11" });
    expect(m.lines[0]).toMatchObject({ description: "Frasco", quantity: "250" });
    expect(m.headerReview).toEqual([]);
  });
});

describe("conservación de datos al releer o sumar una foto complementaria", () => {
  const draftLine = (o: Record<string, unknown>) => ({ id: "a", supplierCode: "", description: "", materialCode: "", quantity: "", remitoQuantity: "", unit: "", packages: "", lote: "", vencimiento: "", noExpiry: false, notes: "", review: ["quantity", "lote"], matchSource: "", ...o }) as never;
  it("completa solo campos VACÍOS y no pisa lo escrito a mano", () => {
    const manual = draftLine({ supplierCode: "FR-30", description: "Frasco (escrito a mano)", quantity: "", unit: "" });
    const extracted = sanitizeExtraction({ supplier: "X", remitoNumber: "1", lines: [{ supplierCode: "FR-30", description: "Frasco PET 30 ml", quantity: 10000, quantityText: "10.000", unit: "un", lot: "L-9" }] })!.lines;
    const [out] = fillEmptyFields([manual], extracted) as Array<{ description: string; quantity: string; unit: string; lote: string; review: string[] }>;
    expect(out!.description).toBe("Frasco (escrito a mano)"); // lo escrito por la persona no se toca
    expect(out).toMatchObject({ quantity: "10000", unit: "un", lote: "L-9" });
    expect(out!.review).not.toContain("quantity");
  });
});

describe("mensajes al operario", () => {
  it("cada situación tiene su texto, sin tecnicismos", () => {
    expect(readMessage({ keepLines: false, hasLines: true, partial: false, pending: [], enhanced: false })).toBe("Remito analizado. Revisá los datos antes de confirmar.");
    expect(readMessage({ keepLines: false, hasLines: true, partial: false, pending: [], enhanced: true })).toMatch(/Mejoramos la imagen/);
    expect(readMessage({ keepLines: false, hasLines: true, partial: false, pending: ["quantity"], enhanced: true })).toMatch(/Identificamos los datos principales\. Revisá los campos marcados\..*No pude identificar la cantidad.*fotografiar únicamente esa parte/);
    expect(readMessage({ keepLines: false, hasLines: true, partial: false, pending: ["remitoDate"], enhanced: false })).toMatch(/Falta la fecha/);
    expect(MSG_PROVIDER_DOWN).toBe("La lectura automática no está disponible en este momento. Tu imagen está guardada y podés completar los datos manualmente o reintentar.");
  });
});
