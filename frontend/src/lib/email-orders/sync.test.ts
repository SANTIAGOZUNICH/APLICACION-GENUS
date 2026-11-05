import { describe, expect, it } from "vitest";
import { afterDateForWindow, decideOutcome, describeGmailError, parseWindowDays, summarizeRun } from "./sync";

const ex = (over: Record<string, unknown> = {}) => ({ kind: "pedido_nuevo" as const, confidence: "alta" as const, items: [{ producto: "X", codigo: "", cantidad: 1, unidad: "", presentacion: "", observaciones: "", unclear: [] }], cliente: "C", ...over });
const counts = (o: Partial<Parameters<typeof summarizeRun>[0]> = {}) => ({ found: 0, scanned: 0, analyzed: 0, drafts: 0, excluded: 0, withoutOrder: 0, alreadyProcessed: 0, errors: 0, ...o });

describe("ventana de búsqueda", () => {
  it("solo 2, 7, 15 y 30 días; el resto es «reciente»", () => {
    expect([7, "15", 30, 2].map(parseWindowDays)).toEqual([7, 15, 30, 2]);
    expect([0, 3, 90, "x", null, undefined].map(parseWindowDays)).toEqual([null, null, null, null, null, null]);
  });
  it("fecha AAAA-MM-DD de hace N días", () => {
    expect(afterDateForWindow(7, new Date("2026-11-10T12:00:00Z"))).toBe("2026-11-03");
    expect(afterDateForWindow(30, new Date("2026-11-10T12:00:00Z"))).toBe("2026-10-11");
  });
});

describe("estado REAL de una corrida", () => {
  it("sin correos: lo dice y no es éxito", () => {
    const r = summarizeRun(counts(), "de los últimos 7 días");
    expect(r.status).toBe("sin_correos");
    expect(r.reason).toMatch(/Gmail no devolvió ningún correo.*últimos 7 días/);
  });
  it("con borradores = ok; con borradores y errores = parcial", () => {
    expect(summarizeRun(counts({ found: 3, drafts: 2 }), "reciente").status).toBe("ok");
    expect(summarizeRun(counts({ found: 3, drafts: 2, errors: 1 }), "reciente").status).toBe("parcial");
  });
  it("encontró correos pero ningún borrador: NUNCA «ok» y explica por qué", () => {
    const r = summarizeRun(counts({ found: 12, alreadyProcessed: 5, excluded: 4, withoutOrder: 3 }), "reciente");
    expect(r.status).toBe("sin_borradores");
    expect(r.reason).toBe("No se creó ningún borrador: de 12 correo(s) encontrados, 5 ya estaban procesado(s), 4 excluido(s) por no poder verificar que iban a la casilla de pedidos, 3 sin pedido (consultas u otros asuntos).");
  });
  it("todo falló = error reintentable", () => {
    expect(summarizeRun(counts({ found: 2, errors: 2 }), "reciente")).toMatchObject({ status: "error" });
  });
});

describe("pedido, no pedido o a revisar", () => {
  it("un pedido normal es borrador", () => expect(decideOutcome(ex())).toMatchObject({ action: "borrador", uncertain: false }));
  it("solo se omite cuando la IA está SEGURA de que no es un pedido", () => {
    expect(decideOutcome(ex({ kind: "consulta", items: [] }))).toMatchObject({ action: "omitir" });
    expect(decideOutcome(ex({ kind: "no_relacionado", items: [] }))).toMatchObject({ action: "omitir" });
    expect(decideOutcome(ex({ kind: "consulta", items: [], confidence: "media" }))).toMatchObject({ action: "borrador", uncertain: true });
    expect(decideOutcome(ex({ kind: "no_relacionado", items: [], confidence: "baja" }))).toMatchObject({ action: "borrador", uncertain: true });
  });
  it("un «consulta» con productos listados no se descarta", () => {
    expect(decideOutcome(ex({ kind: "consulta" }))).toMatchObject({ action: "borrador", uncertain: true });
  });
  it("pedido con baja confianza o sin productos pero con cliente = a revisar, no se omite", () => {
    expect(decideOutcome(ex({ items: [], confidence: "baja" }))).toMatchObject({ action: "borrador", uncertain: true });
    expect(decideOutcome(ex({ items: [], confidence: "media" }))).toMatchObject({ action: "borrador" });
  });
});

describe("errores de Gmail legibles y sin datos sensibles", () => {
  it("acceso vencido/revocado → reconectar", () => {
    expect(describeGmailError(new Error("invalid_grant"))).toMatchObject({ reconnect: true });
    expect(describeGmailError({ message: "Token has been expired or revoked" }).message).toMatch(/reconectá/);
  });
  it("API no habilitada / sin permiso, credenciales, cuota y red", () => {
    expect(describeGmailError({ code: 403, message: "Gmail API has not been used in project" }).message).toMatch(/403/);
    expect(describeGmailError(new Error("invalid_client")).message).toMatch(/ID de cliente/);
    expect(describeGmailError({ code: 429, message: "rate limit" }).message).toMatch(/cuota/);
    expect(describeGmailError(new Error("getaddrinfo ENOTFOUND gmail.googleapis.com")).message).toMatch(/red/);
  });
  it("nunca devuelve el mensaje crudo (puede traer datos)", () => {
    expect(describeGmailError(new Error("refresh_token=1//SECRETO fallo raro")).message).not.toMatch(/SECRETO/);
  });
});
