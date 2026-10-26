/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailOrderDraftsPanel } from "./email-order-drafts-panel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const item = (over = {}) => ({ id: "i0", include: true, producto: "SHAMPOO X", codigo: "", cantidad: 500, unidad: "un", presentacion: "250 ml", ml: 250, observaciones: "", productSuggestions: [], productMatched: true, doubts: [], ...over });
const payload = (over = {}) => ({ cliente: "FIRMEA", clienteMatched: true, clienteSuggestions: [], nroPedido: "OC-1", fechaSolicitud: "2026-10-20", fechaEntrega: "", observaciones: "", summary: "", doubts: ["Dato poco claro: fechaEntrega."], items: [item(), item({ id: "i1", producto: "Raro", productMatched: false, productSuggestions: ["Raro 2"], doubts: ["Producto sin coincidencia exacta: revisá las sugerencias."] })], ...over });
const draft = (over = {}) => ({ id: "d1", gmailMessageId: "m1", gmailThreadId: "t1", kind: "NUEVO", status: "PENDIENTE", payload: payload(), original: payload(), source: { from: "compras@firmea.com", subject: "Pedido octubre", receivedAt: null, attachments: [{ filename: "oc.pdf", used: true }], links: ["https://x.y"] }, related: { draftIds: [], pedidoIds: [], reason: "" }, version: 1, wasEdited: false, reviewedBy: null, reviewedAt: null, discardReason: null, createdAt: "", updatedAt: "", ...over });
const status = (over = {}) => ({ account: "pedidos@laboratoriogenus.com.ar", oauth: { ready: true, missing: [], invalid: [], keyFormat: "base64" }, aiAvailable: true, aiReason: "", dbReady: true, connected: true, connectedAt: null, connectedBy: "prod@x", lastError: null, lastAnalyzedAt: null, metrics: { mensajes: 3, sinPedido: 1, conError: 0, borradores: 2, pendientes: 1, aprobados: 1, aprobadosSinCambios: 1, aprobadosCorregidos: 0, descartados: 0, renglonesCargados: 2 }, ...over });

function mockApi(s: object, drafts: object[], calls: Array<{ url: string; body?: unknown }> = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const u = String(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("/status")) return json(s);
    if (u.includes("/drafts/")) return json({ ok: true, item: draft({ version: 2 }) });
    if (u.includes("/drafts")) return json({ items: drafts });
    return json({ result: { requested: 2, analyzed: 2, drafts: 1, withoutOrder: 1, alreadyProcessed: 0, errors: [], items: [] } });
  }));
  return calls;
}
const open = async () => { render(<EmailOrderDraftsPanel email="prod@x" sector="PRODUCCION" onPedidosCreated={() => undefined} />); await waitFor(() => screen.getByTestId("email-pedidos-resumen")); fireEvent.click(screen.getByTestId("email-pedidos-toggle")); };

describe("panel de pedidos por email", () => {
  it("sin conexión: ofrece conectar (solo lectura) y no muestra ANALIZAR", async () => {
    mockApi(status({ connected: false }), []);
    await open();
    expect(screen.getByTestId("email-pedidos-conectar").getAttribute("href")).toBe("/api/v1/email-orders/oauth/start");
    expect(screen.queryByTestId("email-pedidos-analizar")).toBeNull();
    expect(screen.getByText(/solo permiso de LECTURA/i)).toBeTruthy();
  });
  it("falta configuración del servidor: lo dice y nombra las variables", async () => {
    mockApi(status({ connected: false, oauth: { ready: false, missing: ["GMAIL_OAUTH_CLIENT_ID"], invalid: [{ name: "EMAIL_TOKEN_ENCRYPTION_KEY", problem: "demasiado_corta" }], keyFormat: null } }), []);
    await open();
    expect(screen.getByTestId("email-pedidos-config").textContent).toMatch(/GMAIL_OAUTH_CLIENT_ID/);
    expect(screen.getByTestId("email-pedidos-config").textContent).toMatch(/EMAIL_TOKEN_ENCRYPTION_KEY \(demasiado corta/);
    expect(screen.queryByTestId("email-pedidos-conectar")).toBeNull();
  });
  it("muestra el borrador con origen, dudas y acciones; analizar y aprobar llaman a la API", async () => {
    const calls = mockApi(status(), [draft()]);
    await open();
    expect(screen.getByTestId("email-pedidos-resumen").textContent).toMatch(/1 pendiente/);
    expect(screen.getByTestId("email-borrador-origen").textContent).toMatch(/compras@firmea.com.*Pedido octubre.*oc\.pdf.*1 enlace/);
    expect(screen.getByTestId("email-borrador-dudas").textContent).toMatch(/Dato poco claro/);
    expect(screen.getByTestId("email-borrador-dudas").textContent).toMatch(/Producto 2: Producto sin coincidencia/);
    expect(screen.getAllByTestId("email-borrador-item")).toHaveLength(2);
    expect(screen.getByTestId("email-pedidos-metricas").textContent).toMatch(/1 aprobados sin correcciones/);
    fireEvent.click(screen.getByTestId("email-pedidos-analizar"));
    await waitFor(() => screen.getByTestId("email-pedidos-resultado"));
    expect(calls.find((c) => c.url.includes("/analyze"))!.body).toMatchObject({ max: 10 });
    fireEvent.click(screen.getByTestId("email-borrador-aprobar"));
    await waitFor(() => expect(calls.some((c) => (c.body as { action?: string } | undefined)?.action === "approve")).toBe(true));
  });
  it("editar y aprobar guarda primero los cambios (con la versión) y luego aprueba", async () => {
    const calls = mockApi(status(), [draft()]);
    await open();
    fireEvent.change(screen.getByTestId("email-borrador-cliente"), { target: { value: "FIRMEA SA" } });
    fireEvent.click(screen.getByTestId("email-borrador-aprobar"));
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/drafts/d1")).length).toBe(2));
    const acts = calls.filter((c) => c.url.includes("/drafts/d1")).map((c) => c.body as { action: string; expectedVersion?: number; payload?: { cliente: string } });
    expect(acts[0]).toMatchObject({ action: "update", expectedVersion: 1 });
    expect(acts[0]!.payload!.cliente).toBe("FIRMEA SA");
    expect(acts[1]).toMatchObject({ action: "approve" });
  });
  it("una MODIFICACIÓN no ofrece aprobar directo: revisada / crear como nuevo, con aviso de que no se toca nada", async () => {
    mockApi(status(), [draft({ kind: "MODIFICACION", related: { draftIds: ["d0"], pedidoIds: [], reason: "Responde a un hilo que ya tiene un borrador." } })]);
    await open();
    expect(screen.queryByTestId("email-borrador-aprobar")).toBeNull();
    expect(screen.getByTestId("email-borrador-revisada")).toBeTruthy();
    expect(screen.getByTestId("email-borrador-como-nuevo")).toBeTruthy();
    expect(screen.getByTestId("email-borrador-modificacion").textContent).toMatch(/No se modifica nada automáticamente/);
  });
});
