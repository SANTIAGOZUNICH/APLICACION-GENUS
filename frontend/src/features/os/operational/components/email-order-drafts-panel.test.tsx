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

let analyzeResult: object = { runId: "r1", status: "ok", reason: "1 borrador(es) creado(s) para revisar.", windowDays: null, found: 3, omitted: 1, requested: 2, analyzed: 2, drafts: 1, withoutOrder: 1, excluded: 0, alreadyProcessed: 0, errors: [], items: [] };
function mockApi(s: object, drafts: object[], calls: Array<{ url: string; body?: unknown }> = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const u = String(url);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (u.includes("extraction_health")) return json({ health: { ok: false, message: "m", effectiveModel: null, listing: { ok: true, status: 200, count: 12 }, text: { ok: false, kind: "permission", message: "La clave de Gemini no tiene permiso. Habilitá «Generative Language API»." }, image: null, attempts: [{ model: "gemini-3.5-flash", status: 403, kind: "permission", reason: "SERVICE_DISABLED" }] } });
    if (u.includes("/status")) return json(s);
    if (u.includes("/drafts/")) return json({ ok: true, item: draft({ version: 2 }) });
    if (u.includes("/drafts")) return json({ items: drafts });
    if (u.includes("/probe")) return json({ ok: false, account: "agzunich@gmail.com", inboxSample: null, message: "El acceso a Gmail venció o fue revocado: reconectá la cuenta de pedidos.", reconnect: true });
    return json({ result: analyzeResult });
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
  it("«Probar Gemini» muestra qué paso falla, el motivo exacto y dónde corregirlo (sin claves)", async () => {
    mockApi(status(), []);
    await open();
    fireEvent.click(screen.getByTestId("email-pedidos-probar-gemini"));
    await waitFor(() => screen.getByTestId("email-pedidos-gemini"));
    const t = screen.getByTestId("email-pedidos-gemini").textContent ?? "";
    expect(t).toMatch(/Gemini falló/);
    expect(t).toMatch(/Habilitá «Generative Language API»/);
    expect(t).toMatch(/gemini-3\.5-flash → permission \(HTTP 403 · SERVICE_DISABLED\)/);
  });

  it("estado REAL: cuenta, última sincronización con sus números y motivo; sin borradores no dice «correcto»", async () => {
    const lastRun = { id: "r0", trigger: "cron", actor: "cron@genus-os", startedAt: "2026-11-05T18:30:00Z", finishedAt: "2026-11-05T18:30:05Z", windowDays: null, status: "sin_borradores", reason: "No se creó ningún borrador: de 12 correo(s) encontrados, 9 ya estaban procesado(s), 3 excluido(s) por no poder verificar que iban a la casilla de pedidos.", account: "agzunich@gmail.com", found: 12, scanned: 12, analyzed: 8, drafts: 0, omitted: 3, excluded: 3, withoutOrder: 0, alreadyProcessed: 9, errors: 1, errorItems: [] };
    mockApi(status({ account: "agzunich@gmail.com", connectedAt: "2026-11-01T12:00:00Z", lastRun, automatic: { everyMinutes: 15, windowDays: 3 }, recent: [{ id: "m9", outcome: "error", reason: "Gemini 403", receivedAt: "2026-11-05T18:00:00Z", analyzedAt: "2026-11-05T18:30:00Z", from: "a@b.com", subject: "Hola" }, { id: "m8", outcome: "excluido", reason: "sin_destinatario_original", receivedAt: null, analyzedAt: "2026-11-05T18:30:00Z", from: null, subject: null }] }), []);
    await open();
    expect(screen.getByTestId("email-pedidos-estado").textContent).toMatch(/Cuenta conectada: agzunich@gmail.com/);
    expect(screen.getByTestId("email-pedidos-estado").textContent).toMatch(/automática/);
    expect(screen.getByTestId("email-pedidos-contadores").textContent).toBe("Correos encontrados: 12 · Analizados: 8 · Borradores creados: 0 · Omitidos: 3 · Ya procesados: 9 · Con error: 1");
    expect(screen.getByTestId("email-pedidos-motivo").textContent).toMatch(/No se creó ningún borrador/);
    expect(screen.getByTestId("email-pedidos-ultima-sync").textContent).toMatch(/Sin borradores nuevos/);
    expect(screen.getByTestId("email-pedidos-ultima-sync").textContent).not.toMatch(/correctamente|exitosa/i);
    fireEvent.click(screen.getByText(/Últimos correos revisados/));
    expect(screen.getByTestId("email-pedidos-recientes").textContent).toMatch(/Con error.*a@b\.com.*Hola.*Gemini 403/);
    expect(screen.getByTestId("email-pedidos-recientes").textContent).toMatch(/Omitido \(no iba a pedidos@\)/); // del excluido no se muestra remitente ni asunto
  });
  it("sin sincronizaciones previas lo dice; «Buscar pedidos nuevos» envía la ventana y muestra el resultado real; «Verificar conexión» muestra el error de Gmail", async () => {
    analyzeResult = { runId: "r2", status: "sin_borradores", reason: "No se creó ningún borrador: de 4 correo(s) encontrados, 4 ya estaban procesado(s).", windowDays: 15, found: 4, omitted: 0, requested: 0, analyzed: 0, drafts: 0, withoutOrder: 0, excluded: 0, alreadyProcessed: 4, errors: [], items: [] };
    const calls = mockApi(status({ lastRun: null }), []);
    await open();
    expect(screen.getByTestId("email-pedidos-sin-sync").textContent).toMatch(/Todavía no se hizo ninguna sincronización/);
    fireEvent.change(screen.getByTestId("email-pedidos-ventana"), { target: { value: "15" } });
    fireEvent.click(screen.getByTestId("email-pedidos-analizar"));
    await waitFor(() => screen.getByTestId("email-pedidos-resultado"));
    expect(calls.find((c) => c.url.includes("/analyze"))!.body).toMatchObject({ windowDays: 15 });
    const res = screen.getByTestId("email-pedidos-resultado");
    expect(res.getAttribute("data-status")).toBe("sin_borradores");
    expect(res.textContent).toMatch(/Encontrados 4 · Analizados 0 · Borradores creados 0/);
    expect(res.textContent).not.toMatch(/correctamente/i);
    fireEvent.click(screen.getByTestId("email-pedidos-verificar-conexion"));
    await waitFor(() => screen.getByTestId("email-pedidos-conexion"));
    expect(screen.getByTestId("email-pedidos-conexion").textContent).toMatch(/✖.*reconectá la cuenta/);
  });
  it("el borrador muestra fecha del correo y el estado de la interpretación (a revisar si no es seguro que sea pedido)", async () => {
    mockApi(status(), [draft({ source: { from: "x@y.com", subject: "Hola", receivedAt: "2026-11-04T15:30:00Z", attachments: [], links: [] }, payload: payload({ confidence: "baja", classification: "consulta", uncertain: true, items: [] }) })]);
    await open();
    expect(screen.getByTestId("email-borrador-confianza").textContent).toMatch(/confianza baja.*A REVISAR/);
    expect(screen.getByTestId("email-borrador-origen").textContent).toMatch(/4\/11/);
  });
});
