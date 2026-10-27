import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

vi.mock("server-only", () => ({}));
import { classifyHttp, diagOf, generateJsonFromParts, permissionHelp, resetModelCacheForTests } from "./receipt-extraction";
import { extractOrderFromEmail } from "@/lib/email-orders/extraction";

const KEY = "AIzaSyFAKE_KEY_FOR_TESTS_0123456789abcd";
const env = (over: Record<string, string> = {}) => ({ INGRESO_REMITO_EXTRACTION: "gemini", GEMINI_API_KEY: KEY, INGRESO_REMITO_RETRY_BASE_MS: "1", ...over }) as Partial<NodeJS.ProcessEnv>;
const gErr = (status: number, gstatus: string, message: string, reason?: string, service = "generativelanguage.googleapis.com") =>
  new Response(JSON.stringify({ error: { code: status, status: gstatus, message, details: reason ? [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com", metadata: { service, consumer: "projects/123456789" } }] : [] } }), { status });
const okRes = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });
const list = (models: string[]) => new Response(JSON.stringify({ models: models.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ["generateContent"] })) }), { status: 200 });

beforeEach(() => { resetModelCacheForTests(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

function server(onGen: (model: string, body: { contents: Array<{ parts: Array<Record<string, unknown>> }> }) => Response, models = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash-x"]) {
  const gens: string[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (/\/v1beta\/models\?/.test(u)) return list(models);
    const model = /models\/([^:]+):generateContent/.exec(u)![1]!;
    gens.push(model);
    return onGen(model, JSON.parse(String(init?.body ?? "{}")));
  };
  return Object.assign(fn, { gens });
}

describe("403 de Gemini: se distingue la causa y se dice dónde corregirla (sin exponer la clave)", () => {
  it("API deshabilitada (SERVICE_DISABLED)", async () => {
    const f = server(() => gErr(403, "PERMISSION_DENIED", `Generative Language API has not been used in project 123456789 before or it is disabled. Key ${KEY}`, "SERVICE_DISABLED"));
    const r = await generateJsonFromParts([{ text: "x" }], { fetchImpl: f as never, env: env() });
    expect(r).toMatchObject({ ok: false, kind: "permission", diag: { http: 403, googleStatus: "PERMISSION_DENIED", reason: "SERVICE_DISABLED" } });
    if (!r.ok) {
      expect(r.message).toMatch(/Generative Language API.*Habilitar/);
      expect(r.message).toContain("SERVICE_DISABLED");
      expect(r.message).not.toContain(KEY);
    }
  });
  it("clave con restricción de API / de aplicación / proyecto suspendido / facturación", () => {
    expect(permissionHelp(diagOf(403, { status: "PERMISSION_DENIED", details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] }))).toMatch(/Restricciones de API/);
    expect(permissionHelp(diagOf(403, { details: [{ reason: "API_KEY_HTTP_REFERRER_BLOCKED" }] }))).toMatch(/Restricciones de aplicaciones.*Ninguna/);
    expect(permissionHelp(diagOf(403, { details: [{ reason: "API_KEY_IP_ADDRESS_BLOCKED" }] }))).toMatch(/Vercel/);
    expect(permissionHelp(diagOf(403, { details: [{ reason: "CONSUMER_SUSPENDED" }] }))).toMatch(/suspendido/);
    expect(permissionHelp(diagOf(403, {}), "Billing account not enabled")).toMatch(/facturación/);
    expect(permissionHelp(undefined)).toMatch(/sin indicar el motivo/);
  });
  it("cuota y clave inválida siguen siendo categorías distintas de permisos", () => {
    expect(classifyHttp(429, { status: "RESOURCE_EXHAUSTED" }).kind).toBe("limit");
    expect(classifyHttp(400, { message: "API key not valid" }).kind).toBe("key");
    expect(classifyHttp(403, { status: "PERMISSION_DENIED" }).kind).toBe("permission");
  });
  it("403 de UN modelo (no habilitado para el proyecto): se prueba el siguiente y la lectura se completa", async () => {
    const f = server((m) => (m === "gemini-3.5-flash" ? gErr(403, "PERMISSION_DENIED", "The caller does not have permission") : okRes({ ok: true })));
    const r = await generateJsonFromParts([{ text: "x" }], { fetchImpl: f as never, env: env() });
    expect(r).toMatchObject({ ok: true, model: "gemini-2.5-flash" });
    expect(f.gens).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
  });
  it("403 en todos los modelos: tope de 3 intentos y se informa el rechazo con su diagnóstico", async () => {
    const f = server(() => gErr(403, "PERMISSION_DENIED", "denied", "API_KEY_SERVICE_BLOCKED"), ["m1", "m2", "m3", "m4", "m5"].map((m) => `gemini-2.5-flash-${m}`));
    const r = await generateJsonFromParts([{ text: "x" }], { fetchImpl: f as never, env: env() });
    expect(f.gens.length).toBe(3);
    expect(r).toMatchObject({ ok: false, kind: "permission", diag: { reason: "API_KEY_SERVICE_BLOCKED" } });
  });
});

describe("pedidos por email: un rechazo con archivos adjuntos se reintenta con el texto y nunca se pierde el correo", () => {
  const msg = { id: "1", threadId: "t", from: "a@b.com", subject: "Pedido", date: null, bodyText: "Necesito 500 unidades", links: [], attachments: [] } as never;
  const docs = [
    { meta: { filename: "oc.pdf", mimeType: "application/pdf", size: 1, sha256: "x", used: true }, inline: { mimeType: "application/pdf", base64: "JVBERi0=" } },
    { meta: { filename: "pedido.xlsx", mimeType: "x", size: 1, sha256: "y", used: true }, text: "Producto,Cantidad\nShampoo,500" },
  ];
  const order = { kind: "pedido_nuevo", confidence: "media", summary: "", cliente: "FIRMEA", nroPedido: "", fechaSolicitud: "", fechaEntrega: "", observaciones: "", unclearFields: [], items: [{ producto: "Shampoo", cantidad: 500 }] };
  const hasInline = (parts: Array<Record<string, unknown>>) => parts.some((p) => p.inline_data);

  it("403 solo cuando hay archivos en línea → 2.º intento sin ellos, con los adjuntos no leídos informados", async () => {
    const seen: boolean[] = [];
    const ai = async (parts: Array<Record<string, unknown>>) => { seen.push(hasInline(parts)); return hasInline(parts) ? { ok: false as const, kind: "permission", message: "403" } : { ok: true as const, json: order, ms: 3 }; };
    const out = await extractOrderFromEmail(msg, docs as never, ai);
    expect(seen).toEqual([true, false]);
    expect(out).toMatchObject({ ok: true, skippedAttachments: ["oc.pdf"] });
    // el texto de Excel sigue viajando
  });
  it("403 también sin archivos → es de la clave/proyecto: falla con el motivo y NO se inventa nada", async () => {
    const ai = async () => ({ ok: false as const, kind: "permission", message: "La clave de Gemini no tiene permiso…", diag: { http: 403, googleStatus: "PERMISSION_DENIED", reason: "SERVICE_DISABLED", service: "" } });
    const out = await extractOrderFromEmail(msg, docs as never, ai);
    expect(out).toMatchObject({ ok: false, kind: "permission" });
    if (!out.ok) expect(out.message).toContain("SERVICE_DISABLED");
  });
  it("cuota / saturación NO se reintentan sin archivos (no es culpa del contenido)", async () => {
    let n = 0;
    const ai = async () => { n++; return { ok: false as const, kind: "limit", message: "cuota" }; };
    expect((await extractOrderFromEmail(msg, docs as never, ai)).ok).toBe(false);
    expect(n).toBe(1);
  });
  it("sin archivos en línea no hay segundo intento", async () => {
    let n = 0;
    const ai = async () => { n++; return { ok: false as const, kind: "permission", message: "403" }; };
    await extractOrderFromEmail(msg, [docs[1]] as never, ai);
    expect(n).toBe(1);
  });
});
