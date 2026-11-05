import "server-only";

/**
 * Importación de pedidos desde email (piloto). Flujo: «ANALIZAR CORREOS» (manual, ≤10 mensajes) → IA interpreta → BORRADORES pendientes →
 * Producción corrige y aprueba → recién ahí se crean pedidos con el servicio existente (`ProductionPedidosService.create`). Nada de acá
 * crea trabajos, OE/OA, movimientos de stock ni entregas, ni modifica pedidos existentes.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { emailIntegrations, emailOrderDrafts, emailOrderMessages, emailOrderSyncRuns, productionPedidos } from "@/lib/db/schema";
import { extractionConfig } from "@/lib/inventory/receipt-extraction";
import { OrdersForbiddenError, OrdersNotFoundError, OrdersUnavailableError, OrdersValidationError } from "@/lib/orders/types";
import { canAccessProductionPedidos, type ProductionPedidosActor } from "@/lib/production-pedidos/types";
import { getProductionPedidosService } from "@/lib/production-pedidos/service";
import { decryptToken, encryptToken } from "./crypto";
import { loadDocuments } from "./documents";
import { defaultEmailAi, extractOrderFromEmail, type EmailAi } from "./extraction";
import { createGmailGateway, MAX_MESSAGES_PER_RUN, MAX_SCAN_PER_RUN, type GmailGateway } from "./gateway";
import { connectAccount, oauthConfigStatus, ordersAddress, revokeToken } from "./gmail-oauth";
import { senderDomain, verifyOriginalRecipient } from "./recipient";
import { matchName } from "./matching";
import { afterDateForWindow, decideOutcome, describeGmailError, parseWindowDays, summarizeRun, type RunStatus, type SyncTrigger } from "./sync";
import { parseMl, sanitizeDraftPayload, validateForApproval, type DraftItem, type DraftKind, type DraftPayload, type DraftStatus, type RawExtraction } from "./types";

/** Conflicto de estado (409): el borrador ya cambió, la casilla no está conectada, etc. */
export class OrdersConflictError extends Error {
  readonly status = 409;
  readonly code = "EMAIL_ORDERS_CONFLICT";
}

const INTEGRATION_ID = "pedidos";
const CLAIM_STALE_MS = 5 * 60_000;

export type Catalog = { clients(): Promise<string[]>; products(client: string): Promise<string[]> };
export type CreatePedido = (actor: ProductionPedidosActor, input: Record<string, unknown>) => Promise<{ id: string }>;

export type DraftRow = {
  id: string; gmailMessageId: string; gmailThreadId: string | null; kind: DraftKind; status: DraftStatus; payload: DraftPayload; original: DraftPayload;
  source: { from: string; subject: string; receivedAt: string | null; attachments: Array<{ filename: string; used: boolean; note?: string }>; links: string[] };
  related: { draftIds: string[]; pedidoIds: string[]; reason: string };
  version: number; wasEdited: boolean; reviewedBy: string | null; reviewedAt: string | null; discardReason: string | null; createdAt: string; updatedAt: string;
};

export type AnalyzeOptions = {
  max?: number;
  scan?: number;
  afterDate?: string;
  beforeDate?: string;
  recheckExcluded?: boolean;
  /** Origen de la corrida (queda en el historial). */
  trigger?: SyncTrigger;
  /** Ventana de búsqueda: 2, 7, 15 o 30 días hacia atrás (recuperar correos que llegaron mientras no funcionaba). */
  windowDays?: number;
  /** Reintento de correos con error: 0 = siempre (manual); N ms = solo si el último intento tiene más de N ms (automático, para no insistir en cada corrida). */
  retryErrorsAfterMs?: number;
};

export type AnalyzeResult = {
  /** Identificador de la corrida en el historial y su estado REAL (nunca «éxito» sin borradores sin explicarlo). */
  runId: string | null;
  status: RunStatus;
  reason: string;
  windowDays: number | null;
  /** Correos que Gmail devolvió para la búsqueda (antes de cualquier filtro). */
  found: number;
  /** Excluidos + sin pedido: correos que se leyeron y se dejaron de lado (con su motivo). */
  omitted: number;
  /** Correos revisados (solo encabezados) para encontrar los dirigidos a la casilla de pedidos. */
  scanned: number;
  /** Correos descartados por no poder verificar que originalmente iban a pedidos@ (no se descargaron adjuntos ni se enviaron a la IA). */
  excluded: number;
  excludedItems: Array<{ messageId: string; date: string | null; senderDomain: string; reason: string }>;
  requested: number; analyzed: number; drafts: number; withoutOrder: number; alreadyProcessed: number; errors: Array<{ messageId: string; subject: string; message: string }>;
  items: Array<{ messageId: string; subject: string; outcome: "borrador" | "sin_pedido" | "ya_procesado" | "error" | "excluido"; classification?: string; draftId?: string }>;
};

const asActor = (a: ProductionPedidosActor) => {
  if (!canAccessProductionPedidos(a)) throw new OrdersForbiddenError("Solo Producción puede revisar pedidos recibidos por email.");
};
function requireDb() {
  if (!isDatabaseConfigured()) throw new OrdersUnavailableError("La importación de pedidos desde email requiere la base de datos.");
  return getDb();
}
const rowToDraft = (r: typeof emailOrderDrafts.$inferSelect): DraftRow => ({
  id: r.id, gmailMessageId: r.gmailMessageId, gmailThreadId: r.gmailThreadId, kind: r.kind as DraftKind, status: r.status as DraftStatus, payload: r.payload as DraftPayload,
  original: r.original as DraftPayload, source: r.source as DraftRow["source"], related: r.related as DraftRow["related"], version: r.version, wasEdited: r.wasEdited,
  reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null, discardReason: r.discardReason, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

/** Catálogo real: clientes/productos del banco de fórmulas (Drive) y los ya usados en pedidos. Si Drive no responde, se usa solo lo de pedidos. */
export function defaultCatalog(): Catalog {
  const db = () => getDb();
  return {
    async clients() {
      const names = new Set<string>();
      try {
        const { searchDriveClients } = await import("@/lib/formulas/drive-formulas-index");
        for (const c of await searchDriveClients("", 2000)) names.add(c.client);
      } catch { /* sin índice de Drive */ }
      const rows = await db().execute(sql`select distinct cliente from production_pedidos where deleted_at is null and cliente is not null`);
      for (const r of rows.rows as Array<{ cliente: string }>) names.add(r.cliente);
      return [...names];
    },
    async products(client) {
      const names = new Set<string>();
      try {
        const { searchDriveProducts } = await import("@/lib/formulas/drive-formulas-index");
        for (const p of await searchDriveProducts(client, "", 400)) names.add(p.productLabel);
      } catch { /* sin índice de Drive */ }
      const rows = await db().execute(sql`select distinct producto from production_pedidos where deleted_at is null and producto is not null and lower(cliente) = lower(${client})`);
      for (const r of rows.rows as Array<{ producto: string }>) names.add(r.producto);
      return [...names];
    },
  };
}

export class EmailOrdersService {
  constructor(
    private readonly deps: {
      gateway?: () => Promise<GmailGateway>;
      ai?: EmailAi;
      catalog?: Catalog;
      createPedido?: CreatePedido;
      aiAvailable?: () => { available: boolean; reason: string };
      revoke?: (token: string) => Promise<void>;
    } = {}
  ) {}

  // ── Conexión ──

  async status(actor: ProductionPedidosActor) {
    asActor(actor);
    const cfg = oauthConfigStatus();
    const ai = (this.deps.aiAvailable ?? (() => extractionConfig()))();
    const base = { account: connectAccount(), ordersAddress: ordersAddress(), oauth: cfg, aiAvailable: ai.available, aiReason: ai.available ? "" : ai.reason };
    if (!isDatabaseConfigured()) return { ...base, connected: false, dbReady: false, connectedAt: null, connectedBy: null, lastError: null, lastAnalyzedAt: null, metrics: null };
    const [row] = await getDb().select().from(emailIntegrations).where(eq(emailIntegrations.id, INTEGRATION_ID));
    return {
      ...base, account: row?.accountEmail || base.account, dbReady: true, connected: row?.status === "conectado", connectedAt: row?.connectedAt?.toISOString() ?? null, connectedBy: row?.connectedBy ?? null,
      lastError: row?.lastError ?? null, lastAnalyzedAt: row?.lastAnalyzedAt?.toISOString() ?? null, metrics: await this.metrics(),
      lastRun: await this.lastRun().catch(() => null), recent: await this.recentMessages(25).catch(() => []),
      /** El sistema revisa Gmail solo cada pocos minutos (cron) además del botón manual; la pantalla lo indica. */
      automatic: { everyMinutes: 15, windowDays: 3 },
    };
  }

  /** Última corrida del historial (manual, automática o de recuperación) con sus números reales. */
  async lastRun() {
    const [r] = await requireDb().select().from(emailOrderSyncRuns).orderBy(desc(emailOrderSyncRuns.startedAt)).limit(1);
    if (!r) return null;
    const stale = r.status === "en_curso" && Date.now() - r.startedAt.getTime() > CLAIM_STALE_MS;
    return {
      id: r.id, trigger: r.trigger, actor: r.actor, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, windowDays: r.windowDays,
      status: (stale ? "error" : r.status) as RunStatus | "en_curso", reason: stale ? "La corrida se interrumpió antes de terminar." : r.reason, account: r.accountEmail,
      found: r.found, scanned: r.scanned, analyzed: r.analyzed, drafts: r.drafts, omitted: r.omitted, excluded: r.excluded, withoutOrder: r.withoutOrder, alreadyProcessed: r.alreadyProcessed,
      errors: r.errors, errorItems: (r.errorItems ?? []) as Array<{ messageId: string; subject: string; message: string }>,
    };
  }

  /** Últimos correos revisados con su resultado y motivo. De los excluidos NO se guarda remitente ni asunto (puede ser personal). */
  async recentMessages(limit = 25) {
    const rows = await requireDb().select().from(emailOrderMessages).orderBy(desc(emailOrderMessages.analyzedAt)).limit(Math.min(Math.max(1, limit), 100));
    return rows.map((r) => ({
      id: r.gmailMessageId, outcome: r.outcome, reason: r.outcome === "error" ? r.error : r.classification, receivedAt: r.receivedAt?.toISOString() ?? null, analyzedAt: r.analyzedAt.toISOString(),
      from: r.outcome === "excluido" ? null : r.fromAddr, subject: r.outcome === "excluido" ? null : r.subject,
    }));
  }

  /**
   * Prueba REAL de la conexión: pide a Gmail el perfil de la cuenta y una muestra de la bandeja. No analiza ni escribe correos. El resultado
   * (acceso vencido, API deshabilitada, credenciales inválidas…) se informa con su motivo en lugar de mostrar «Conectado» por una marca en la base.
   */
  async checkConnection(actor: ProductionPedidosActor) {
    asActor(actor);
    const db = requireDb();
    let gw: GmailGateway;
    try {
      gw = await this.gateway();
    } catch (err) {
      return { ok: false as const, account: connectAccount(), inboxSample: null, message: err instanceof Error ? err.message : "La casilla no está conectada.", reconnect: true };
    }
    try {
      const account = (await gw.accountEmail()) || connectAccount();
      const sample = await gw.listCandidates({ scan: 5, label: process.env.GMAIL_ORDERS_LABEL?.trim() || undefined });
      await db.update(emailIntegrations).set({ lastError: null, updatedAt: new Date() }).where(eq(emailIntegrations.id, INTEGRATION_ID));
      return { ok: true as const, account, inboxSample: sample.length, message: sample.length ? `Gmail responde: se leyó la bandeja de ${account} (${sample.length}+ correos recientes).` : `Gmail responde, pero la bandeja de ${account} no tiene correos recientes.`, reconnect: false };
    } catch (err) {
      const d = describeGmailError(err);
      await db.update(emailIntegrations).set({ lastError: d.message.slice(0, 300), updatedAt: new Date() }).where(eq(emailIntegrations.id, INTEGRATION_ID));
      return { ok: false as const, account: connectAccount(), inboxSample: null, message: d.message, reconnect: d.reconnect };
    }
  }

  /** Guarda la conexión (token CIFRADO). Solo se acepta la casilla autorizada. */
  async saveConnection(actor: ProductionPedidosActor, input: { refreshToken: string; accountEmail: string; scope: string }) {
    asActor(actor);
    const db = requireDb();
    if (input.accountEmail.toLowerCase() !== connectAccount()) {
      throw new OrdersValidationError(`Solo se puede conectar la cuenta ${connectAccount()} (donde Webnode reenvía los pedidos). Se autorizó otra cuenta (${input.accountEmail}); no se guardó nada.`);
    }
    const enc = encryptToken(input.refreshToken);
    await db
      .insert(emailIntegrations)
      .values({ id: INTEGRATION_ID, accountEmail: input.accountEmail.toLowerCase(), refreshTokenEnc: enc, scope: input.scope, status: "conectado", connectedBy: actor.email, connectedAt: new Date(), lastError: null })
      .onConflictDoUpdate({ target: emailIntegrations.id, set: { accountEmail: input.accountEmail.toLowerCase(), refreshTokenEnc: enc, scope: input.scope, status: "conectado", connectedBy: actor.email, connectedAt: new Date(), disconnectedBy: null, disconnectedAt: null, lastError: null, updatedAt: new Date() } });
  }

  /** Desconecta: revoca el token en Google y lo borra de la base. */
  async disconnect(actor: ProductionPedidosActor) {
    asActor(actor);
    const db = requireDb();
    const [row] = await db.select().from(emailIntegrations).where(eq(emailIntegrations.id, INTEGRATION_ID));
    if (row?.refreshTokenEnc) {
      try { await (this.deps.revoke ?? revokeToken)(decryptToken(row.refreshTokenEnc)); } catch { /* aunque no se pueda descifrar, se borra */ }
    }
    await db.update(emailIntegrations).set({ refreshTokenEnc: null, status: "desconectado", disconnectedBy: actor.email, disconnectedAt: new Date(), updatedAt: new Date() }).where(eq(emailIntegrations.id, INTEGRATION_ID));
  }

  private async gateway(): Promise<GmailGateway> {
    if (this.deps.gateway) return this.deps.gateway();
    const db = requireDb();
    const [row] = await db.select().from(emailIntegrations).where(eq(emailIntegrations.id, INTEGRATION_ID));
    if (!row || row.status !== "conectado" || !row.refreshTokenEnc) throw new OrdersConflictError("La casilla de pedidos no está conectada. Conectala primero.");
    return createGmailGateway(decryptToken(row.refreshTokenEnc));
  }

  // ── Análisis manual ──

  async analyze(actor: ProductionPedidosActor, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
    asActor(actor);
    const db = requireDb();
    const trigger: SyncTrigger = opts.trigger ?? "manual";
    const windowDays = parseWindowDays(opts.windowDays);
    const windowLabel = windowDays ? `de los últimos ${windowDays} días` : "reciente";
    // El historial NUNCA puede impedir procesar correos: si la tabla no está disponible (migración pendiente) la corrida sigue sin registro.
    const runId: string | null = await db.insert(emailOrderSyncRuns).values({ trigger: windowDays && windowDays > 2 && trigger === "manual" ? "backfill" : trigger, actor: actor.email, windowDays, status: "en_curso" }).returning({ id: emailOrderSyncRuns.id }).then((r) => r[0]?.id ?? null, () => null);
    const finish = async (status: RunStatus, reason: string, counts: Partial<Record<"found" | "scanned" | "analyzed" | "drafts" | "omitted" | "excluded" | "withoutOrder" | "alreadyProcessed" | "errors", number>> = {}, errorItems: Array<{ messageId: string; subject: string; message: string }> = [], account?: string) => {
      if (!runId) return;
      await db.update(emailOrderSyncRuns).set({ status, reason: reason.slice(0, 500), finishedAt: new Date(), accountEmail: account ?? null, ...counts, errorItems: errorItems.slice(0, 20) }).where(eq(emailOrderSyncRuns.id, runId)).catch(() => undefined);
    };
    const ai = (this.deps.aiAvailable ?? (() => extractionConfig()))();
    if (!ai.available) {
      const reason = `La lectura con IA no está disponible: ${ai.reason}`;
      await finish("error_ia", reason);
      throw new OrdersConflictError(reason);
    }
    const max = Math.min(Math.max(1, Math.floor(opts.max ?? MAX_MESSAGES_PER_RUN)), MAX_MESSAGES_PER_RUN);
    const dateOk = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
    const afterDate = dateOk(opts.afterDate) ?? (windowDays ? afterDateForWindow(windowDays) : undefined);
    let gw: GmailGateway;
    try {
      gw = await this.gateway();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "La casilla de pedidos no está conectada.";
      await finish("no_conectada", reason);
      throw err;
    }
    const account = (await gw.accountEmail().catch(() => connectAccount())) || connectAccount();
    const target = ordersAddress();
    let refs: Array<{ id: string; threadId: string }>;
    try {
      refs = await gw.listCandidates({ scan: Math.min(Math.max(max, Math.floor(opts.scan ?? 60)), MAX_SCAN_PER_RUN), afterDate, beforeDate: dateOk(opts.beforeDate), label: process.env.GMAIL_ORDERS_LABEL?.trim() || undefined });
    } catch (err) {
      const d = describeGmailError(err);
      await db.update(emailIntegrations).set({ lastError: d.message.slice(0, 300), updatedAt: new Date() }).where(eq(emailIntegrations.id, INTEGRATION_ID));
      await finish("error_gmail", d.message, {}, [], account);
      throw new OrdersConflictError(d.message);
    }
    const catalog = this.deps.catalog ?? defaultCatalog();
    const result: AnalyzeResult = { runId, status: "sin_borradores", reason: "", windowDays, found: refs.length, omitted: 0, scanned: 0, excluded: 0, excludedItems: [], requested: 0, analyzed: 0, drafts: 0, withoutOrder: 0, alreadyProcessed: 0, errors: [], items: [] };
    let verifiedCount = 0;
    const retryMs = Math.max(0, Math.floor(opts.retryErrorsAfterMs ?? 0));
    for (const ref of refs) {
      if (verifiedCount >= max) break; // ya se encontraron los pedidos que se pidieron analizar
      result.scanned++;
      // Reclamar el correo: ID de Gmail único. Un error previo o un reclamo viejo se puede reintentar; un correo ya procesado (o excluido), no.
      const claimed = await db
        .insert(emailOrderMessages)
        .values({ gmailMessageId: ref.id, gmailThreadId: ref.threadId, outcome: "procesando", analyzedBy: actor.email })
        .onConflictDoUpdate({
          target: emailOrderMessages.gmailMessageId,
          set: { outcome: "procesando", error: null, analyzedBy: actor.email, analyzedAt: new Date() },
          setWhere: sql`(${emailOrderMessages.outcome} = 'error' and (${retryMs} = 0 or ${emailOrderMessages.analyzedAt} < now() - (${retryMs} * interval '1 millisecond'))) or (${emailOrderMessages.outcome} = 'procesando' and ${emailOrderMessages.analyzedAt} < now() - (${CLAIM_STALE_MS} * interval '1 millisecond')) or (${opts.recheckExcluded === true} and ${emailOrderMessages.outcome} = 'excluido')`,
        })
        .returning({ id: emailOrderMessages.id });
      if (!claimed[0]) {
        result.alreadyProcessed++;
        result.items.push({ messageId: ref.id, subject: "", outcome: "ya_procesado" });
        continue;
      }
      // Ya existe un borrador (aprobado o no) de ESTE correo de Gmail: no se vuelve a importar ni se duplica.
      const [prior] = await db.select({ id: emailOrderDrafts.id }).from(emailOrderDrafts).where(eq(emailOrderDrafts.gmailMessageId, ref.id)).limit(1);
      if (prior) {
        await db.update(emailOrderMessages).set({ outcome: "borrador", error: null }).where(eq(emailOrderMessages.gmailMessageId, ref.id));
        result.alreadyProcessed++;
        result.items.push({ messageId: ref.id, subject: "", outcome: "ya_procesado" });
        continue;
      }
      // FILTRO OBLIGATORIO (antes de descargar adjuntos o de enviar nada a la IA): ¿iba originalmente a la casilla de pedidos? Solo encabezados.
      try {
        const meta = await gw.getHeaders(ref.id);
        const verdict = verifyOriginalRecipient(meta.headers, target, account);
        if (!verdict.verified) {
          const dom = senderDomain(meta.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? "");
          // Del correo excluido NO se guarda remitente ni asunto (puede ser personal): solo ID, fecha, motivo y dominio del remitente.
          await db.update(emailOrderMessages).set({ outcome: "excluido", classification: verdict.reason, receivedAt: meta.date ? new Date(meta.date) : null }).where(eq(emailOrderMessages.gmailMessageId, ref.id));
          result.excluded++;
          result.excludedItems.push({ messageId: ref.id, date: meta.date, senderDomain: dom, reason: verdict.reason });
          result.items.push({ messageId: ref.id, subject: "", outcome: "excluido", classification: verdict.reason });
          continue;
        }
      } catch (err) {
        const message = (err instanceof Error ? err.message : "Error").slice(0, 300);
        await db.update(emailOrderMessages).set({ outcome: "error", error: message }).where(eq(emailOrderMessages.gmailMessageId, ref.id)).catch(() => undefined);
        result.errors.push({ messageId: ref.id, subject: "", message });
        result.items.push({ messageId: ref.id, subject: "", outcome: "error" });
        continue;
      }
      verifiedCount++;
      result.requested++;
      let subject = "";
      try {
        const msg = await gw.getMessage(ref.id);
        subject = msg.subject;
        if (msg.from.toLowerCase().includes(account)) {
          await db.update(emailOrderMessages).set({ outcome: "sin_pedido", classification: "propio", fromAddr: msg.from, subject: msg.subject }).where(eq(emailOrderMessages.gmailMessageId, ref.id));
          result.withoutOrder++;
          result.items.push({ messageId: ref.id, subject, outcome: "sin_pedido", classification: "propio" });
          continue;
        }
        const docs = await loadDocuments(msg.attachments, (a) => gw.getAttachment(ref.id, a.attachmentId));
        const out = await extractOrderFromEmail(msg, docs, this.deps.ai ?? defaultEmailAi);
        const attachmentsMeta = docs.map((d) => d.meta);
        if (!out.ok) throw new Error(out.message);
        result.analyzed++;
        const ex = out.data;
        const base = { fromAddr: msg.from, subject: msg.subject, receivedAt: msg.date ? new Date(msg.date) : null, classification: ex.kind, attachments: attachmentsMeta, aiMs: out.ms };
        const decision = decideOutcome(ex);
        if (decision.action === "omitir") {
          await db.update(emailOrderMessages).set({ ...base, classification: decision.reason, outcome: "sin_pedido" }).where(eq(emailOrderMessages.gmailMessageId, ref.id));
          result.withoutOrder++;
          result.items.push({ messageId: ref.id, subject, outcome: "sin_pedido", classification: decision.reason });
          continue;
        }
        const built = await this.buildDraft(ref.id, ref.threadId, msg, ex, catalog, out.skippedAttachments, decision.uncertain ? decision.reason : null);
        const inserted = await db
          .insert(emailOrderDrafts)
          .values({ gmailMessageId: ref.id, gmailThreadId: ref.threadId, kind: built.kind, payload: built.payload, original: built.payload, related: built.related, source: { from: msg.from, subject: msg.subject, receivedAt: msg.date, attachments: docs.map((d) => ({ filename: d.meta.filename, used: d.meta.used, note: d.meta.note })), links: msg.links } })
          .onConflictDoNothing()
          .returning({ id: emailOrderDrafts.id });
        await db.update(emailOrderMessages).set({ ...base, outcome: "borrador" }).where(eq(emailOrderMessages.gmailMessageId, ref.id));
        if (inserted[0]) {
          result.drafts++;
          result.items.push({ messageId: ref.id, subject, outcome: "borrador", classification: ex.kind, draftId: inserted[0].id });
        } else result.alreadyProcessed++;
      } catch (err) {
        const message = (err instanceof Error ? err.message : "Error").slice(0, 300);
        await db.update(emailOrderMessages).set({ outcome: "error", error: message, subject: subject || undefined }).where(eq(emailOrderMessages.gmailMessageId, ref.id)).catch(() => undefined);
        result.errors.push({ messageId: ref.id, subject, message });
        result.items.push({ messageId: ref.id, subject, outcome: "error" });
      }
    }
    result.omitted = result.excluded + result.withoutOrder;
    const summary = summarizeRun({ found: result.found, scanned: result.scanned, analyzed: result.analyzed, drafts: result.drafts, excluded: result.excluded, withoutOrder: result.withoutOrder, alreadyProcessed: result.alreadyProcessed, errors: result.errors.length }, windowLabel);
    result.status = summary.status;
    result.reason = summary.reason;
    await db.update(emailIntegrations).set({ lastAnalyzedAt: new Date(), lastError: result.errors.length ? `${result.errors.length} correo(s) con error en la última búsqueda.` : null, updatedAt: new Date() }).where(eq(emailIntegrations.id, INTEGRATION_ID));
    await finish(summary.status, summary.reason, { found: result.found, scanned: result.scanned, analyzed: result.analyzed, drafts: result.drafts, omitted: result.omitted, excluded: result.excluded, withoutOrder: result.withoutOrder, alreadyProcessed: result.alreadyProcessed, errors: result.errors.length }, result.errors, account);
    return result;
  }

  /**
   * Diagnóstico del filtro SIN analizar nada: para los correos recientes muestra, solo con metadatos (fecha, dominio del remitente y NOMBRES
   * de los encabezados que dieron evidencia), si se pudo verificar que iban a la casilla de pedidos. No lee asuntos ni cuerpos, no descarga
   * adjuntos, no usa IA y no escribe en la base. Sirve para comprobar con correos reales qué encabezados deja el reenvío de Webnode.
   */
  async diagnoseFilter(actor: ProductionPedidosActor, opts: { scan?: number; afterDate?: string } = {}) {
    asActor(actor);
    const gw = await this.gateway();
    const account = (await gw.accountEmail().catch(() => connectAccount())) || connectAccount();
    const target = ordersAddress();
    const refs = await gw.listCandidates({ scan: Math.min(Math.max(1, Math.floor(opts.scan ?? 20)), 30), afterDate: opts.afterDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.afterDate) ? opts.afterDate : undefined, label: process.env.GMAIL_ORDERS_LABEL?.trim() || undefined });
    const rows: Array<{ date: string | null; senderDomain: string; verified: boolean; strength: string | null; evidence: string[]; reason: string; recipientHeadersPresent: string[] }> = [];
    for (const ref of refs) {
      const meta = await gw.getHeaders(ref.id);
      const v = verifyOriginalRecipient(meta.headers, target, account);
      const present = [...new Set(meta.headers.map((h) => h.name).filter((n) => /^(to|cc|resent-to|delivered-to|x-original-to|x-envelope-to|envelope-to|original-recipient|x-original-recipient|x-forwarded-for|x-forwarded-to|x-rcpt-to)$/i.test(n)))];
      rows.push({ date: meta.date, senderDomain: senderDomain(meta.headers.find((h) => h.name.toLowerCase() === "from")?.value ?? ""), verified: v.verified, strength: v.verified ? v.strength : null, evidence: v.evidence, reason: v.verified ? "ok" : v.reason, recipientHeadersPresent: present });
    }
    return { target, account, scanned: rows.length, verified: rows.filter((r) => r.verified).length, rows };
  }

  /** Arma el borrador: coincidencias con el catálogo, detección de hilo/pedido existente. No inventa nada. */
  private async buildDraft(messageId: string, threadId: string, msg: { date: string | null }, ex: RawExtraction, catalog: Catalog, skippedAttachments: string[] = [], uncertainReason: string | null = null) {
    const db = getDb();
    const doubts: string[] = [];
    if (uncertainReason) doubts.push(`No se sabe con certeza si es un pedido (${uncertainReason}). Revisá el correo original: si lo es, completá cliente, productos y cantidades; si no, descartalo.`);
    if (skippedAttachments.length) doubts.push(`La IA no pudo leer estos archivos adjuntos (${skippedAttachments.join(", ")}): el borrador se armó solo con el texto del correo y de Excel/Word. Revisá cantidades y productos contra el original.`);
    if (ex.confidence === "baja") doubts.push("La IA indicó baja confianza en esta interpretación.");
    for (const u of ex.unclear) doubts.push(`Dato poco claro: ${u}.`);
    const clients = await catalog.clients().catch(() => [] as string[]);
    const cm = matchName(ex.cliente, clients);
    const cliente = cm.value ?? ex.cliente;
    if (!ex.cliente) doubts.push("No se pudo identificar el cliente.");
    else if (!cm.exact) doubts.push(cm.suggestions.length ? "El cliente no coincide exactamente con el catálogo: elegí una sugerencia o corregilo." : "El cliente no figura en el catálogo de GENUS OS.");
    const products = cm.exact ? await catalog.products(cm.value!).catch(() => [] as string[]) : [];
    const items: DraftItem[] = ex.items.map((it, n) => {
      const pm = it.producto ? matchName(it.producto, products) : { value: null, exact: false, suggestions: [] as string[] };
      const idoubts: string[] = [];
      if (!it.producto) idoubts.push("Falta el producto.");
      else if (!pm.exact) idoubts.push(cm.exact ? (pm.suggestions.length ? "Producto sin coincidencia exacta: revisá las sugerencias." : "Producto no encontrado en el catálogo del cliente.") : "Producto sin verificar contra el catálogo.");
      if (it.cantidad == null) idoubts.push("Falta una cantidad válida.");
      for (const u of it.unclear) idoubts.push(`Poco claro: ${u}.`);
      const ml = parseMl(it.presentacion);
      if (it.presentacion && ml == null) idoubts.push("La presentación no está en ml: completá el volumen por unidad si hace falta.");
      return { id: `i${n}`, include: true, producto: pm.value ?? it.producto, codigo: it.codigo, cantidad: it.cantidad, unidad: it.unidad, presentacion: it.presentacion, ml, observaciones: it.observaciones, productSuggestions: pm.suggestions, productMatched: pm.exact, doubts: idoubts };
    });
    if (ex.items.length === 0) doubts.push("No se detectaron productos: si el correo pide repetir un pedido anterior o trae el detalle en un archivo que no se pudo leer, cargalo a mano. No se inventó ninguna cantidad.");
    if (!ex.fechaSolicitud) doubts.push(`No hay fecha de solicitud: al aprobar se usa la fecha del correo (${(msg.date ?? "").slice(0, 10) || "sin fecha"}).`);

    // Hilo y pedidos existentes (referencia estable, nunca se sobrescribe nada).
    const sameThread = await db.select({ id: emailOrderDrafts.id, status: emailOrderDrafts.status }).from(emailOrderDrafts).where(and(eq(emailOrderDrafts.gmailThreadId, threadId), sql`${emailOrderDrafts.gmailMessageId} <> ${messageId}`));
    let pedidoIds: string[] = [];
    if (ex.nroPedido) {
      const found = await db.select({ id: productionPedidos.id, cliente: productionPedidos.cliente }).from(productionPedidos).where(and(eq(productionPedidos.nroOc, ex.nroPedido), sql`${productionPedidos.deletedAt} is null`));
      pedidoIds = found.filter((f) => !cliente || !f.cliente || f.cliente.toLowerCase() === cliente.toLowerCase()).map((f) => f.id);
    }
    const reasons: string[] = [];
    if (sameThread.length) reasons.push("Responde a un hilo que ya tiene un borrador/pedido de este correo.");
    if (pedidoIds.length) reasons.push(`Ya existe un pedido con N° OC ${ex.nroPedido}.`);
    if (ex.kind === "modificacion") reasons.push("La IA lo interpretó como una modificación.");
    const kind: DraftKind = reasons.length ? "MODIFICACION" : "NUEVO";
    if (kind === "MODIFICACION") doubts.push("Posible MODIFICACIÓN de un pedido anterior: no se modifica nada automáticamente; revisá y cargá los cambios a mano.");
    const payload: DraftPayload = {
      cliente, clienteMatched: cm.exact, clienteSuggestions: cm.suggestions, nroPedido: ex.nroPedido, fechaSolicitud: ex.fechaSolicitud, fechaEntrega: ex.fechaEntrega,
      observaciones: ex.observaciones, summary: ex.summary, items, doubts, confidence: ex.confidence, classification: ex.kind, uncertain: Boolean(uncertainReason) || ex.confidence === "baja",
    };
    return { kind, payload, related: { draftIds: sameThread.map((s) => s.id), pedidoIds, reason: reasons.join(" ") } };
  }

  // ── Borradores ──

  async list(actor: ProductionPedidosActor, filter: { status?: DraftStatus[] } = {}): Promise<DraftRow[]> {
    asActor(actor);
    const db = requireDb();
    const st = filter.status?.length ? filter.status : (["PENDIENTE", "APROBANDO"] as DraftStatus[]);
    const rows = await db.select().from(emailOrderDrafts).where(inArray(emailOrderDrafts.status, st)).orderBy(desc(emailOrderDrafts.createdAt)).limit(100);
    return rows.map(rowToDraft);
  }

  private async load(id: string) {
    const [r] = await requireDb().select().from(emailOrderDrafts).where(eq(emailOrderDrafts.id, id));
    if (!r) throw new OrdersNotFoundError("Borrador no encontrado.");
    return r;
  }

  async update(actor: ProductionPedidosActor, id: string, input: { expectedVersion: number; payload: unknown }): Promise<DraftRow> {
    asActor(actor);
    const r = await this.load(id);
    if (r.status !== "PENDIENTE") throw new OrdersConflictError("Este borrador ya no está pendiente.");
    const next = sanitizeDraftPayload(input.payload, r.payload as DraftPayload);
    const edited = JSON.stringify(strip(next)) !== JSON.stringify(strip(r.original as DraftPayload));
    const [u] = await requireDb()
      .update(emailOrderDrafts)
      .set({ payload: next, wasEdited: edited, version: sql`${emailOrderDrafts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(emailOrderDrafts.id, id), eq(emailOrderDrafts.status, "PENDIENTE"), eq(emailOrderDrafts.version, Number(input.expectedVersion))))
      .returning();
    if (!u) throw new OrdersConflictError("Otra persona modificó este borrador. Recargá y revisá.");
    return rowToDraft(u);
  }

  async discard(actor: ProductionPedidosActor, id: string, reason: string): Promise<void> {
    asActor(actor);
    const [u] = await requireDb()
      .update(emailOrderDrafts)
      .set({ status: "DESCARTADO", reviewedBy: actor.email, reviewedAt: new Date(), discardReason: reason.trim().slice(0, 300) || null, updatedAt: new Date() })
      .where(and(eq(emailOrderDrafts.id, id), eq(emailOrderDrafts.status, "PENDIENTE")))
      .returning({ id: emailOrderDrafts.id });
    if (!u) throw new OrdersConflictError("Solo se puede descartar un borrador pendiente.");
  }

  /** Una MODIFICACIÓN se marca como revisada (Producción ajusta el pedido a mano). Nunca sobrescribe pedidos. */
  async markReviewed(actor: ProductionPedidosActor, id: string): Promise<void> {
    asActor(actor);
    const [u] = await requireDb()
      .update(emailOrderDrafts)
      .set({ status: "REVISADO", reviewedBy: actor.email, reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(emailOrderDrafts.id, id), eq(emailOrderDrafts.status, "PENDIENTE"), eq(emailOrderDrafts.kind, "MODIFICACION")))
      .returning({ id: emailOrderDrafts.id });
    if (!u) throw new OrdersConflictError("Solo una modificación pendiente se puede marcar como revisada.");
  }

  /**
   * Aprobar y crear pedido(s): idempotente. Se reclama el borrador (PENDIENTE → APROBANDO), se crea un pedido por renglón incluido (guardando
   * el id creado de cada renglón apenas existe) y se cierra (APROBADO). Un reintento tras un corte solo crea lo que falta.
   */
  async approve(actor: ProductionPedidosActor, id: string, opts: { asNew?: boolean } = {}): Promise<{ draft: DraftRow; pedidoIds: string[] }> {
    asActor(actor);
    const db = requireDb();
    const cur = await this.load(id);
    if (cur.kind === "MODIFICACION" && !opts.asNew) throw new OrdersConflictError("Es una posible modificación: no se crea nada automáticamente. Marcala como revisada o elegí «crear como pedido nuevo».");
    const claimed = await db
      .update(emailOrderDrafts)
      .set({ status: "APROBANDO", updatedAt: new Date() })
      .where(and(eq(emailOrderDrafts.id, id), sql`(${emailOrderDrafts.status} = 'PENDIENTE' or (${emailOrderDrafts.status} = 'APROBANDO' and ${emailOrderDrafts.updatedAt} < now() - interval '2 minutes'))`))
      .returning();
    if (!claimed[0]) throw new OrdersConflictError("Este borrador ya se aprobó o se está aprobando.");
    const payload = claimed[0].payload as DraftPayload;
    const errs = validateForApproval(payload);
    if (errs.length) {
      await db.update(emailOrderDrafts).set({ status: "PENDIENTE", updatedAt: new Date() }).where(eq(emailOrderDrafts.id, id));
      throw new OrdersValidationError(errs.join(" "));
    }
    const source = claimed[0].source as DraftRow["source"];
    const fecha = payload.fechaSolicitud || (source.receivedAt ?? "").slice(0, 10) || null;
    const create: CreatePedido = this.deps.createPedido ?? ((a, input) => getProductionPedidosService().create(a, input));
    const items = payload.items.map((i) => ({ ...i }));
    try {
      for (const it of items) {
        if (!it.include || it.createdPedidoId) continue;
        const rec = await create(
          { email: actor.email, sector: actor.sector, roleId: actor.roleId, isSuperadmin: actor.isSuperadmin },
          { fecha, nroOc: payload.nroPedido || null, cliente: payload.cliente, producto: it.producto, s: it.presentacion || null, q: it.cantidad, ml: it.ml ?? parseMl(it.presentacion), estado: "INGRESO" }
        );
        it.createdPedidoId = rec.id;
        await db.update(emailOrderDrafts).set({ payload: { ...payload, items }, updatedAt: new Date() }).where(eq(emailOrderDrafts.id, id));
      }
    } catch (err) {
      await db.update(emailOrderDrafts).set({ status: "PENDIENTE", payload: { ...payload, items }, updatedAt: new Date() }).where(eq(emailOrderDrafts.id, id));
      throw err;
    }
    const [done] = await db
      .update(emailOrderDrafts)
      .set({ status: "APROBADO", payload: { ...payload, items }, reviewedBy: actor.email, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailOrderDrafts.id, id))
      .returning();
    return { draft: rowToDraft(done!), pedidoIds: items.flatMap((i) => (i.createdPedidoId ? [i.createdPedidoId] : [])) };
  }

  /** Medición del piloto: cuántos borradores se aprobaron SIN corrección (interpretados bien) y cuánta carga manual se evitó. */
  async metrics() {
    const db = requireDb();
    const [m] = (await db.execute(sql`
      select
        (select count(*)::int from email_order_messages) as mensajes,
        (select count(*)::int from email_order_messages where outcome = 'sin_pedido') as sin_pedido,
        (select count(*)::int from email_order_messages where outcome = 'error') as con_error,
        (select count(*)::int from email_order_messages where outcome = 'excluido') as excluidos,
        count(*)::int as borradores,
        count(*) filter (where status = 'PENDIENTE')::int as pendientes,
        count(*) filter (where status = 'APROBADO')::int as aprobados,
        count(*) filter (where status = 'APROBADO' and not was_edited)::int as aprobados_sin_cambios,
        count(*) filter (where status = 'APROBADO' and was_edited)::int as aprobados_corregidos,
        count(*) filter (where status = 'DESCARTADO')::int as descartados,
        coalesce(sum(jsonb_array_length(payload->'items')) filter (where status = 'APROBADO'), 0)::int as renglones_cargados
      from email_order_drafts`)).rows as Array<Record<string, number>>;
    const n = (k: string) => Number(m?.[k] ?? 0);
    return {
      mensajes: n("mensajes"), sinPedido: n("sin_pedido"), conError: n("con_error"), excluidos: n("excluidos"), borradores: n("borradores"), pendientes: n("pendientes"), aprobados: n("aprobados"),
      aprobadosSinCambios: n("aprobados_sin_cambios"), aprobadosCorregidos: n("aprobados_corregidos"), descartados: n("descartados"), renglonesCargados: n("renglones_cargados"),
    };
  }
}

/** Lo que cuenta como «corrección humana»: campos de negocio, no sugerencias ni dudas. */
function strip(p: DraftPayload) {
  return { c: p.cliente, n: p.nroPedido, f: p.fechaSolicitud, e: p.fechaEntrega, i: p.items.map((i) => [i.include, i.producto, i.cantidad, i.presentacion, i.ml]) };
}

let singleton: EmailOrdersService | null = null;
export function getEmailOrdersService(): EmailOrdersService {
  return (singleton ??= new EmailOrdersService());
}
