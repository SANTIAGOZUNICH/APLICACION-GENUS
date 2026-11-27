/**
 * Notificaciones Web Push del Portal de Clientes: configuración, piloto por cliente, suscripciones, cola (outbox), historial y
 * worker. Postgres es la única fuente de verdad.
 *
 * Desacople: NADA de esto corre dentro de una operación de Producción. El detector y el envío viven en el worker (cron) y un fallo
 * (VAPID ausente, servicio de push caído, error de base de un cliente) nunca se propaga a Producción: se registra y se reintenta.
 * Envío REAL apagado (valor por defecto): el worker registra los eventos como «simulados» y NO llama a web-push.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { clientKey } from "@/lib/entregas/rules";
import { loadPortalOverview } from "../data-service";
import type { PortalSession } from "../auth-service";
import { audit, isoOrNull, rateLimitHit, requireDb, PortalError, type Row, type SqlExec } from "../store";
import {
  DEFAULT_ELABORACION_DAYS,
  DEFAULT_ENVASADO_DAYS,
  OWNER_KEY_EMAIL,
  OWNER_KEY_USER,
  PUSH_CLAIM_TIMEOUT_MS,
  PUSH_EVENT_MAX_AGE_MS,
  PUSH_MAX_ATTEMPTS,
  PUSH_MAX_SUBSCRIPTION_FAILURES,
  buildPushMessage,
  computeBaseline,
  detectTransitions,
  parseSubscriptionInput,
  pushBackoffMs,
  pushUrlForOrder,
  type OrderSnapshot,
  type PushDays,
  type PushEventType,
  type StateUpsert,
} from "./push-rules";
import { planPushSend, type PushSender, type PushSubscriptionRow } from "./push-send";
import { createWebPushSender, vapidConfig, vapidPublicKey, type VapidConfig } from "./vapid";

// ───────────────────────── Permisos (solo Dirección) ─────────────────────────

export type PushStaff = { email: string; sector: string };
export const canManagePush = (sector: string) => sector === "DIRECCION";
const need = (s: PushStaff) => {
  if (!canManagePush(s.sector)) throw new PortalError("Solo Dirección administra las notificaciones del portal.", 403, "FORBIDDEN");
};

// ───────────────────────── Configuración ─────────────────────────

export type PushSettings = { globalSendEnabled: boolean; elaboracionDays: number; envasadoDays: number; updatedBy: string | null; updatedAt: string | null };

export async function getPushSettings(db: SqlExec = requireDb()): Promise<PushSettings> {
  await db.execute(sql`insert into portal_push_settings (id) values (1) on conflict (id) do nothing`);
  const r = ((await db.execute(sql`select global_send_enabled, elaboracion_days, envasado_days, updated_by, updated_at from portal_push_settings where id = 1`)).rows as Row[])[0];
  return {
    globalSendEnabled: r?.global_send_enabled === true,
    elaboracionDays: Number(r?.elaboracion_days ?? DEFAULT_ELABORACION_DAYS),
    envasadoDays: Number(r?.envasado_days ?? DEFAULT_ENVASADO_DAYS),
    updatedBy: r?.updated_by ? String(r.updated_by) : null,
    updatedAt: isoOrNull(r?.updated_at),
  };
}

const validDays = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 60) throw new PortalError("Los días hábiles deben ser un número entero entre 1 y 60.", 400, "VALIDATION");
  return n;
};

export async function updatePushSettings(staff: PushStaff, patch: { globalSendEnabled?: unknown; elaboracionDays?: unknown; envasadoDays?: unknown }, db: SqlExec = requireDb()): Promise<PushSettings> {
  need(staff);
  const before = await getPushSettings(db);
  const next = {
    globalSendEnabled: patch.globalSendEnabled === undefined ? before.globalSendEnabled : patch.globalSendEnabled === true,
    elaboracionDays: patch.elaboracionDays === undefined ? before.elaboracionDays : validDays(patch.elaboracionDays),
    envasadoDays: patch.envasadoDays === undefined ? before.envasadoDays : validDays(patch.envasadoDays),
  };
  await db.execute(sql`
    update portal_push_settings set global_send_enabled = ${next.globalSendEnabled}, elaboracion_days = ${next.elaboracionDays}, envasado_days = ${next.envasadoDays},
           updated_by = ${staff.email}, updated_at = now() where id = 1`);
  await audit(db, { type: "PUSH_CONFIG", kind: "STAFF", actor: staff.email, detail: { before, after: next } });
  return getPushSettings(db);
}

// ───────────────────────── Estado de pedidos y baseline ─────────────────────────

export const orderKeyOf = (orderRef: string | null, opaqueId: string): string => (orderRef?.trim() ? `op:${clientKey(orderRef)}` : `id:${opaqueId}`);

export async function loadOrderSnapshots(clientId: string, now: Date, db: SqlExec): Promise<OrderSnapshot[]> {
  const { overview } = await loadPortalOverview(clientId, now, db);
  return overview.orders.map((o) => ({
    orderKey: orderKeyOf(o.orderRef, o.id),
    orderRef: o.orderRef,
    opaqueId: o.id,
    statusId: o.status.id,
    cancelled: o.cancelled,
    todoListo: o.todoListo,
  }));
}

/** Guarda el estado: `overwrite` (baseline) fija el estado actual aunque sea menor; si no, solo sube (GREATEST). */
async function writeState(db: SqlExec, clientId: string, rows: StateUpsert[], overwrite: boolean) {
  for (const u of rows) {
    if (overwrite) {
      await db.execute(sql`
        insert into portal_push_order_state (client_id, order_key, order_ref, last_rank, baseline, last_notified_at)
        values (${clientId}::uuid, ${u.orderKey}, ${u.orderRef}, ${u.rank}, ${u.baseline}, null)
        on conflict (client_id, order_key) do update set last_rank = excluded.last_rank, order_ref = excluded.order_ref, baseline = true, updated_at = now()`);
    } else {
      await db.execute(sql`
        insert into portal_push_order_state (client_id, order_key, order_ref, last_rank, baseline, last_notified_at)
        values (${clientId}::uuid, ${u.orderKey}, ${u.orderRef}, ${u.rank}, ${u.baseline}, ${u.notified ? new Date().toISOString() : null}::timestamptz)
        on conflict (client_id, order_key) do update set last_rank = greatest(portal_push_order_state.last_rank, excluded.last_rank),
               order_ref = coalesce(excluded.order_ref, portal_push_order_state.order_ref),
               last_notified_at = coalesce(excluded.last_notified_at, portal_push_order_state.last_notified_at), updated_at = now()`);
    }
  }
}

// ───────────────────────── Piloto por cliente ─────────────────────────

export type PushClientRow = {
  id: string;
  name: string;
  code: string;
  users: number;
  devices: number;
  /** Diagnóstico por cliente (Dirección). */
  lastSubscriptionAt: string | null;
  lastSentAt: string | null;
  events: { pendientes: number; simulados: number; enviados: number; fallidos: number; sinDispositivos: number };
  lastFailure: { reason: string; at: string } | null;
  deviceErrors: number;
  pilotEnabled: boolean;
  enabledAt: string | null;
  baselineAt: string | null;
  baselineOrders: number;
};

export async function isPilotEnabled(db: SqlExec, clientId: string): Promise<boolean> {
  const r = ((await db.execute(sql`select enabled from portal_push_client_pilot where client_id = ${clientId}::uuid`)).rows as Row[])[0];
  return r?.enabled === true;
}

/** Habilita/deshabilita el piloto de un cliente. Al habilitar registra el baseline (sin enviar nada). */
export async function setClientPilot(staff: PushStaff, clientId: string, enabled: boolean, now: Date = new Date(), db: SqlExec = requireDb()): Promise<{ enabled: boolean; baselineOrders: number }> {
  need(staff);
  const c = ((await db.execute(sql`select id from portal_clients where id = ${clientId}::uuid`)).rows as Row[])[0];
  if (!c) throw new PortalError("Cliente inexistente.", 404, "NOT_FOUND");
  let baselineOrders = 0;
  if (enabled) {
    const snaps = await loadOrderSnapshots(clientId, now, db);
    const base = computeBaseline(snaps);
    await writeState(db, clientId, base, true);
    baselineOrders = base.length;
    await db.execute(sql`
      insert into portal_push_client_pilot (client_id, enabled, enabled_at, enabled_by, baseline_at, baseline_orders)
      values (${clientId}::uuid, true, now(), ${staff.email}, now(), ${baselineOrders})
      on conflict (client_id) do update set enabled = true, enabled_at = now(), enabled_by = excluded.enabled_by, baseline_at = now(), baseline_orders = excluded.baseline_orders, updated_at = now()`);
  } else {
    await db.execute(sql`update portal_push_client_pilot set enabled = false, updated_at = now() where client_id = ${clientId}::uuid`);
  }
  await audit(db, { clientId, type: enabled ? "PUSH_PILOTO_HABILITADO" : "PUSH_PILOTO_DESHABILITADO", kind: "STAFF", actor: staff.email, detail: { baselineOrders } });
  return { enabled, baselineOrders };
}

/** Tipo de aviso de la notificación de prueba manual: nunca lo genera ni lo reclama el worker de pedidos. */
export const PUSH_TEST_EVENT_TYPE = "prueba";
export const PUSH_TEST_TITLE = "¡Bienvenido a Laboratorio Genus! 🎉";
export const PUSH_TEST_BODY = "Las notificaciones de tu portal funcionan correctamente. A partir de ahora podrás recibir novedades sobre tus pedidos.";
export const PUSH_TEST_URL = "/entregas";
export const PUSH_TEST_WINDOW_SECONDS = 30;

export type PushQueueIndicators = { pendientes: number; enviadas: number; fallidas: number; simuladas: number; sinDispositivos: number; expiradas: number };

export async function queueIndicators(db: SqlExec = requireDb()): Promise<PushQueueIndicators> {
  const rows = (await db.execute(sql`select status, count(*)::int as n from portal_push_outbox where event_type <> ${PUSH_TEST_EVENT_TYPE} group by status`)).rows as Row[];
  const n = (...s: string[]) => rows.filter((r) => s.includes(String(r.status))).reduce((a, r) => a + Number(r.n), 0);
  return { pendientes: n("PENDIENTE", "PROCESANDO"), enviadas: n("ENVIADA"), fallidas: n("FALLIDA"), simuladas: n("SIMULADA"), sinDispositivos: n("SIN_DISPOSITIVOS"), expiradas: n("EXPIRADA") };
}

export type PushWorkerHeartbeat = { lastStartedAt: string | null; lastFinishedAt: string | null; lastCronAt: string | null; lastOk: boolean | null; lastError: string | null; lastTrigger: string | null; runsTotal: number; lastSummary: Record<string, unknown> | null };

export async function workerHeartbeat(db: SqlExec): Promise<PushWorkerHeartbeat> {
  const r = ((await db.execute(sql`select last_started_at, last_finished_at, last_cron_at, last_ok, last_error, last_trigger, runs_total, last_summary from portal_push_worker_runs where id = 1`)).rows as Row[])[0];
  return {
    lastStartedAt: isoOrNull(r?.last_started_at), lastFinishedAt: isoOrNull(r?.last_finished_at), lastCronAt: isoOrNull(r?.last_cron_at),
    lastOk: r ? r.last_ok === true : null, lastError: r?.last_error ? String(r.last_error) : null, lastTrigger: r?.last_trigger ? String(r.last_trigger) : null,
    runsTotal: Number(r?.runs_total ?? 0), lastSummary: (r?.last_summary as Record<string, unknown> | null) ?? null,
  };
}

export type PushAdminOverview = {
  worker: PushWorkerHeartbeat;
  settings: PushSettings;
  vapidConfigured: boolean;
  cronConfigured: boolean;
  queue: PushQueueIndicators;
  clients: PushClientRow[];
};

export async function pushAdminOverview(staff: PushStaff, db: SqlExec = requireDb()): Promise<PushAdminOverview> {
  need(staff);
  const clients = (await db.execute(sql`
    select c.id::text as id, c.display_name, c.public_code,
           (select count(*)::int from portal_users u where u.client_id = c.id and u.removed_at is null and u.status = 'ACTIVO') as users,
           (select count(*)::int from portal_push_subscriptions s where s.client_id = c.id) as devices,
           (select max(s.created_at) from portal_push_subscriptions s where s.client_id = c.id) as last_sub_at,
           (select count(*)::int from portal_push_subscriptions s where s.client_id = c.id and s.last_error is not null) as device_errors,
           (select max(o.processed_at) from portal_push_outbox o where o.client_id = c.id and o.status = 'ENVIADA' and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as last_sent_at,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status in ('PENDIENTE', 'PROCESANDO') and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as ev_pend,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'SIMULADA') as ev_sim,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'ENVIADA' and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as ev_env,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'FALLIDA') as ev_fail,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'SIN_DISPOSITIVOS') as ev_nodev,
           (select coalesce(o.last_error, 'sin detalle') || '|' || coalesce(o.processed_at, o.created_at)::text from portal_push_outbox o
             where o.client_id = c.id and (o.status = 'FALLIDA' or o.last_error is not null) order by coalesce(o.processed_at, o.created_at) desc limit 1) as last_failure,
           coalesce(p.enabled, false) as enabled, p.enabled_at, p.baseline_at, coalesce(p.baseline_orders, 0) as baseline_orders
      from portal_clients c left join portal_push_client_pilot p on p.client_id = c.id
     where c.access_enabled and c.status = 'ACTIVO'
       and (exists (select 1 from portal_users u where u.client_id = c.id and u.removed_at is null) or exists (select 1 from portal_authorized_emails e where e.client_id = c.id and e.removed_at is null))
     order by c.display_name`)).rows as Row[];
  return {
    worker: await workerHeartbeat(db),
    settings: await getPushSettings(db),
    vapidConfigured: vapidConfig() != null,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    queue: await queueIndicators(db),
    clients: clients.map((r) => ({
      id: String(r.id), name: String(r.display_name), code: String(r.public_code), users: Number(r.users), devices: Number(r.devices),
      lastSubscriptionAt: isoOrNull(r.last_sub_at), lastSentAt: isoOrNull(r.last_sent_at), deviceErrors: Number(r.device_errors),
      events: { pendientes: Number(r.ev_pend), simulados: Number(r.ev_sim), enviados: Number(r.ev_env), fallidos: Number(r.ev_fail), sinDispositivos: Number(r.ev_nodev) },
      lastFailure: r.last_failure ? (([reason, at]) => ({ reason: reason ?? "", at: isoOrNull(at) ?? "" }))(String(r.last_failure).split(/\|([\s\S]*)/)) : null,
      pilotEnabled: r.enabled === true, enabledAt: isoOrNull(r.enabled_at), baselineAt: isoOrNull(r.baseline_at), baselineOrders: Number(r.baseline_orders),
    })),
  };
}

// ───────────────────────── Suscripciones (cliente del portal) ─────────────────────────

export const ownerKeyOf = (s: Pick<PortalSession, "userId" | "email">): string => (s.userId ? OWNER_KEY_USER(s.userId) : OWNER_KEY_EMAIL(s.email ?? "desconocido"));

/**
 * `available`: el servidor puede registrar dispositivos (hay claves VAPID). Registrar un dispositivo NO depende del piloto: el piloto
 * (y el interruptor global) solo deciden si se ENVÍA. Así el cliente puede activar las notificaciones antes de que Dirección
 * habilite el envío, y no queda sin dispositivo registrado cuando se habilite. `pilotEnabled` es informativo.
 */
export type PushClientConfig = { available: boolean; reason: "ok" | "vapid"; publicKey: string | null; devices: number; thisDevice: boolean; pilotEnabled: boolean };

export async function pushClientConfig(session: PortalSession, endpoint: string | null, db: SqlExec = requireDb()): Promise<PushClientConfig> {
  const key = vapidPublicKey();
  const owner = ownerKeyOf(session);
  const devices = Number((((await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where client_id = ${session.clientId}::uuid and owner_key = ${owner}`)).rows as Row[])[0]?.n) ?? 0);
  let thisDevice = false;
  if (endpoint) {
    thisDevice = (((await db.execute(sql`select 1 as x from portal_push_subscriptions where endpoint = ${endpoint} and owner_key = ${owner} and client_id = ${session.clientId}::uuid`)).rows) as Row[]).length > 0;
  }
  const pilotEnabled = await isPilotEnabled(db, session.clientId);
  if (!key) return { available: false, reason: "vapid", publicKey: null, devices, thisDevice, pilotEnabled };
  return { available: true, reason: "ok", publicKey: key, devices, thisDevice, pilotEnabled };
}

/** Alta/actualización de un dispositivo. El endpoint es único: si lo tenía otro usuario (equipo compartido), pasa al actual. */
export async function savePushSubscription(session: PortalSession, input: unknown, userAgent: string | null, db: SqlExec = requireDb()): Promise<{ registered: true; devices: number }> {
  if (!vapidPublicKey()) throw new PortalError("Las notificaciones no están disponibles por ahora.", 503, "PUSH_UNAVAILABLE");
  const sub = parseSubscriptionInput(input);
  if (!sub) throw new PortalError("Suscripción inválida.", 400, "VALIDATION");
  await db.execute(sql`
    insert into portal_push_subscriptions (id, client_id, owner_key, user_id, endpoint, p256dh, auth, user_agent)
    values (${randomUUID()}::uuid, ${session.clientId}::uuid, ${ownerKeyOf(session)}, ${session.userId}::uuid, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${userAgent?.slice(0, 300) ?? null})
    on conflict (endpoint) do update set client_id = excluded.client_id, owner_key = excluded.owner_key, user_id = excluded.user_id, p256dh = excluded.p256dh,
           auth = excluded.auth, user_agent = excluded.user_agent, failures = 0, last_error = null`);
  // Confirmación REAL: se vuelve a leer de PostgreSQL. Solo si la fila existe se responde que quedó registrado.
  const check = (await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where endpoint = ${sub.endpoint} and client_id = ${session.clientId}::uuid and owner_key = ${ownerKeyOf(session)}`)).rows as Row[];
  if (Number(check[0]?.n ?? 0) !== 1) throw new PortalError("No pudimos registrar este dispositivo. Reintentá.", 500, "PUSH_NOT_SAVED");
  await audit(db, { clientId: session.clientId, type: "PUSH_DISPOSITIVO_ALTA", kind: "CLIENTE", actor: session.actor });
  const devices = Number((((await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where client_id = ${session.clientId}::uuid and owner_key = ${ownerKeyOf(session)}`)).rows as Row[])[0]?.n) ?? 0);
  return { registered: true, devices };
}

export async function removePushSubscription(session: PortalSession, endpoint: unknown, db: SqlExec = requireDb()): Promise<number> {
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw new PortalError("Solicitud inválida.", 400, "VALIDATION");
  const rows = (await db.execute(sql`
    delete from portal_push_subscriptions where endpoint = ${endpoint} and client_id = ${session.clientId}::uuid and owner_key = ${ownerKeyOf(session)} returning id`)).rows;
  if (rows.length) await audit(db, { clientId: session.clientId, type: "PUSH_DISPOSITIVO_BAJA", kind: "CLIENTE", actor: session.actor });
  return rows.length;
}

// ───────────────────────── Historial del cliente ─────────────────────────

export type PushHistoryItem = { id: string; type: PushEventType | typeof PUSH_TEST_EVENT_TYPE; title: string; body: string; url: string; createdAt: string; read: boolean };

/** Historial visible: solo avisos REALES (los simulados del modo piloto nunca se muestran al cliente). */
export async function listPushHistory(session: PortalSession, limit = 30, db: SqlExec = requireDb()): Promise<{ items: PushHistoryItem[]; unread: number }> {
  const owner = ownerKeyOf(session);
  const rows = (await db.execute(sql`
    select o.id::text as id, o.event_type, o.title, o.body, o.url, coalesce(o.processed_at, o.created_at) as at, (r.owner_key is not null) as read
      from portal_push_outbox o left join portal_push_reads r on r.outbox_id = o.id and r.owner_key = ${owner}
     where o.client_id = ${session.clientId}::uuid and o.mode = 'REAL' and o.status in ('ENVIADA', 'SIN_DISPOSITIVOS', 'FALLIDA')
     order by coalesce(o.processed_at, o.created_at) desc limit ${limit}`)).rows as Row[];
  const items = rows.map((r): PushHistoryItem => ({ id: String(r.id), type: String(r.event_type) as PushEventType | typeof PUSH_TEST_EVENT_TYPE, title: String(r.title), body: String(r.body), url: String(r.url), createdAt: isoOrNull(r.at)!, read: r.read === true }));
  return { items, unread: items.filter((i) => !i.read).length };
}

/** Marca como leídos (solo del cliente de la sesión). Sin ids = todos. */
export async function markPushRead(session: PortalSession, ids: string[] | null, db: SqlExec = requireDb()): Promise<number> {
  const owner = ownerKeyOf(session);
  const valid = (ids ?? []).filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 100);
  if (ids && !valid.length) return 0;
  const filter = ids ? sql`and o.id in (${sql.join(valid.map((i) => sql`${i}::uuid`), sql`, `)})` : sql``;
  const rows = (await db.execute(sql`
    insert into portal_push_reads (owner_key, outbox_id)
    select ${owner}::text, o.id from portal_push_outbox o
     where o.client_id = ${session.clientId}::uuid and o.mode = 'REAL' and o.status in ('ENVIADA', 'SIN_DISPOSITIVOS', 'FALLIDA') ${filter}
    on conflict do nothing returning outbox_id`)).rows;
  return rows.length;
}

// ───────────────────────── Worker ─────────────────────────

export type PushWorkerSummary = {
  vapid: boolean;
  globalSendEnabled: boolean;
  clients: number;
  clientErrors: number;
  detected: number;
  enqueued: number;
  claimed: number;
  enviadas: number;
  simuladas: number;
  sinDispositivos: number;
  fallidas: number;
  expiradas: number;
  esperandoVapid: number;
  reintentos: number;
  dispositivosBaja: number;
};

export type WorkerDeps = { db?: SqlExec; now?: Date; sender?: PushSender | null; vapid?: VapidConfig | null };

/** Detecta transiciones de los clientes en piloto y las encola (idempotente: se puede ejecutar tantas veces como se quiera). */
export async function detectAndEnqueue(db: SqlExec, now: Date, summary: PushWorkerSummary, days: PushDays, onlyClientId: string | null = null): Promise<void> {
  const clients = (await db.execute(sql`
    select c.id::text as id from portal_push_client_pilot p join portal_clients c on c.id = p.client_id
     where p.enabled and c.status = 'ACTIVO' and c.access_enabled
       and (${onlyClientId}::uuid is null or c.id = ${onlyClientId}::uuid)`)).rows as Row[];
  for (const c of clients) {
    const clientId = String(c.id);
    summary.clients++;
    try {
      const snaps = await loadOrderSnapshots(clientId, now, db);
      const st = (await db.execute(sql`select order_key, last_rank from portal_push_order_state where client_id = ${clientId}::uuid`)).rows as Row[];
      const state = new Map(st.map((r) => [String(r.order_key), { lastRank: Number(r.last_rank) }]));
      const { events, upserts } = detectTransitions(snaps, state);
      summary.detected += events.length;
      for (const e of events) {
        const msg = buildPushMessage(e.type, e.orderRef, days);
        const ins = (await db.execute(sql`
          insert into portal_push_outbox (id, client_id, order_key, order_ref, order_opaque_id, product_key, event_type, title, body, url)
          values (${randomUUID()}::uuid, ${clientId}::uuid, ${e.orderKey}, ${e.orderRef}, ${e.opaqueId}, '', ${e.type}, ${msg.title}, ${msg.body}, ${pushUrlForOrder(e.opaqueId)})
          on conflict (client_id, order_key, event_type, product_key) do nothing returning id`)).rows;
        if (ins.length) summary.enqueued++;
      }
      await writeState(db, clientId, upserts, false);
    } catch (err) {
      summary.clientErrors++;
      console.error("[portal-push] error detectando transiciones de un cliente (no afecta a Producción)", err);
    }
  }
}

type Claimed = { id: string; clientId: string; eventType: string; title: string; body: string; url: string; attempts: number; createdAt: string };

/** El reclamo usa el reloj de la BASE (no el del proceso): los eventos recién encolados quedan disponibles en la misma corrida. */
async function claimBatch(db: SqlExec, limit = 50): Promise<Claimed[]> {
  const staleSeconds = PUSH_CLAIM_TIMEOUT_MS / 1000;
  const rows = (await db.execute(sql`
    update portal_push_outbox set status = 'PROCESANDO', claimed_at = now(), attempts = attempts + 1
     where id in (
       select id from portal_push_outbox
        where (status = 'PENDIENTE' and next_attempt_at <= now()) or (status = 'PROCESANDO' and claimed_at < now() - (${staleSeconds} * interval '1 second'))
        order by created_at limit ${limit} for update skip locked)
    returning id::text as id, client_id::text as client_id, event_type, title, body, url, attempts, created_at`)).rows as Row[];
  return rows.map((r) => ({ id: String(r.id), clientId: String(r.client_id), eventType: String(r.event_type), title: String(r.title), body: String(r.body), url: String(r.url), attempts: Number(r.attempts), createdAt: isoOrNull(r.created_at)! }));
}

async function finish(db: SqlExec, id: string, status: string, mode: string | null, extra: { sent?: number; failed?: number; error?: string | null } = {}) {
  await db.execute(sql`
    update portal_push_outbox set status = ${status}, mode = ${mode}, sent_count = ${extra.sent ?? 0}, failed_count = ${extra.failed ?? 0}, last_error = ${extra.error ?? null},
           processed_at = now(), claimed_at = null where id = ${id}::uuid`);
}
async function release(db: SqlExec, id: string, delayMs: number, error: string | null, refundAttempt = false) {
  await db.execute(sql`
    update portal_push_outbox set status = 'PENDIENTE', claimed_at = null, last_error = ${error}, attempts = attempts - ${refundAttempt ? 1 : 0},
           next_attempt_at = ${new Date(Date.now() + delayMs).toISOString()}::timestamptz where id = ${id}::uuid`);
}

/** Entrega los eventos pendientes. Con el envío REAL apagado solo registra «simulados»: jamás toca web-push. */
export async function dispatchPending(db: SqlExec, now: Date, summary: PushWorkerSummary, deps: { sender: PushSender | null }, globalSendEnabled: boolean): Promise<void> {
  const batch = await claimBatch(db);
  summary.claimed += batch.length;
  for (const ev of batch) {
    try {
      const age = now.getTime() - new Date(ev.createdAt).getTime();
      if (!(await isPilotEnabled(db, ev.clientId))) {
        await finish(db, ev.id, "EXPIRADA", null, { error: "piloto deshabilitado" });
        summary.expiradas++;
        continue;
      }
      if (!globalSendEnabled) {
        await finish(db, ev.id, "SIMULADA", "SIMULADO");
        summary.simuladas++;
        continue;
      }
      if (age > PUSH_EVENT_MAX_AGE_MS) {
        await finish(db, ev.id, "EXPIRADA", null, { error: "aviso vencido" });
        summary.expiradas++;
        continue;
      }
      if (!deps.sender) {
        // Envío real encendido pero sin VAPID: se espera (sin consumir el intento) hasta que se configure o venza.
        await release(db, ev.id, 5 * 60_000, "VAPID no configurado", true);
        summary.esperandoVapid++;
        continue;
      }
      const subs = ((await db.execute(sql`select id::text as id, endpoint, p256dh, auth from portal_push_subscriptions where client_id = ${ev.clientId}::uuid order by created_at`)).rows as Row[]).map(
        (r): PushSubscriptionRow => ({ id: String(r.id), endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }),
      );
      if (!subs.length) {
        await finish(db, ev.id, "SIN_DISPOSITIVOS", "REAL");
        summary.sinDispositivos++;
        continue;
      }
      const plan = await planPushSend(subs, { title: ev.title, body: ev.body, url: ev.url, tag: `pedido-${ev.id}`, eventId: ev.id }, deps.sender);
      for (const id of plan.sent) await db.execute(sql`update portal_push_subscriptions set last_ok_at = now(), failures = 0, last_error = null where id = ${id}::uuid`);
      for (const id of plan.gone) {
        await db.execute(sql`delete from portal_push_subscriptions where id = ${id}::uuid`);
        summary.dispositivosBaja++;
      }
      for (const f of plan.failed) {
        await db.execute(sql`update portal_push_subscriptions set failures = failures + 1, last_error = ${f.error} where id = ${f.id}::uuid`);
        await db.execute(sql`delete from portal_push_subscriptions where id = ${f.id}::uuid and failures >= ${PUSH_MAX_SUBSCRIPTION_FAILURES}`);
      }
      if (plan.sent.length > 0) {
        await finish(db, ev.id, "ENVIADA", "REAL", { sent: plan.sent.length, failed: plan.failed.length, error: plan.failed[0]?.error ?? null });
        summary.enviadas++;
      } else if (plan.failed.length === 0) {
        await finish(db, ev.id, "SIN_DISPOSITIVOS", "REAL"); // todos los dispositivos habían caducado (404/410)
        summary.sinDispositivos++;
      } else if (ev.attempts >= PUSH_MAX_ATTEMPTS) {
        await finish(db, ev.id, "FALLIDA", "REAL", { failed: plan.failed.length, error: plan.failed[0]?.error ?? null });
        summary.fallidas++;
      } else {
        await release(db, ev.id, pushBackoffMs(ev.attempts), plan.failed[0]?.error ?? "error de envío");
        summary.reintentos++;
      }
    } catch (err) {
      // Nada de lo que pase acá sale del worker. Se reintenta con backoff o se da por fallido.
      const msg = String((err as Error)?.message ?? err).slice(0, 300);
      try {
        if (ev.attempts >= PUSH_MAX_ATTEMPTS) {
          await finish(db, ev.id, "FALLIDA", "REAL", { error: msg });
          summary.fallidas++;
        } else {
          await release(db, ev.id, pushBackoffMs(ev.attempts), msg);
          summary.reintentos++;
        }
      } catch (e2) {
        console.error("[portal-push] no se pudo registrar el fallo de un evento", e2);
      }
    }
  }
}

const emptySummary = (vapid: boolean, globalSendEnabled: boolean): PushWorkerSummary => ({
  vapid, globalSendEnabled, clients: 0, clientErrors: 0, detected: 0, enqueued: 0, claimed: 0,
  enviadas: 0, simuladas: 0, sinDispositivos: 0, fallidas: 0, expiradas: 0, esperandoVapid: 0, reintentos: 0, dispositivosBaja: 0,
});

export type WorkerTrigger = "cron" | "inmediato";

/** Latido del worker (diagnóstico de Dirección). Best-effort: jamás propaga un error. */
export async function recordWorkerRun(db: SqlExec, trigger: WorkerTrigger, startedAt: Date, outcome: { summary?: PushWorkerSummary; error?: string | null }): Promise<void> {
  try {
    const ok = !outcome.error;
    await db.execute(sql`
      insert into portal_push_worker_runs (id, last_started_at, last_finished_at, last_ok, last_error, last_trigger, last_summary, last_cron_at, runs_total, updated_at)
      values (1, ${startedAt.toISOString()}::timestamptz, now(), ${ok}, ${outcome.error ?? null}, ${trigger}, ${outcome.summary ? JSON.stringify(outcome.summary) : null}::jsonb,
              ${trigger === "cron" ? sql`now()` : sql`null`}, 1, now())
      on conflict (id) do update set last_started_at = excluded.last_started_at, last_finished_at = now(), last_ok = excluded.last_ok, last_error = excluded.last_error,
             last_trigger = excluded.last_trigger, last_summary = excluded.last_summary,
             last_cron_at = coalesce(excluded.last_cron_at, portal_push_worker_runs.last_cron_at),
             runs_total = portal_push_worker_runs.runs_total + 1, updated_at = now()`);
  } catch (err) {
    console.error("[portal-push] no se pudo registrar el latido del worker", err);
  }
}

/**
 * Una corrida del worker: detectar + enviar. Idempotente y segura ante ejecuciones repetidas o simultáneas. NO depende de que haya
 * un portal abierto ni de una sesión: recorre TODOS los clientes del piloto. `onlyClientId` la acota a un cliente (disparo inmediato).
 */
export async function runPushWorker(deps: WorkerDeps & { trigger?: WorkerTrigger; onlyClientId?: string | null } = {}): Promise<PushWorkerSummary> {
  const db = deps.db ?? requireDb();
  const now = deps.now ?? new Date();
  const startedAt = new Date();
  const trigger = deps.trigger ?? "cron";
  const vapid = deps.vapid === undefined ? vapidConfig() : deps.vapid;
  const sender = deps.sender === undefined ? (vapid ? createWebPushSender(vapid) : null) : deps.sender;
  let summary: PushWorkerSummary = emptySummary(vapid != null || deps.sender != null, false);
  try {
    const settings = await getPushSettings(db);
    summary = emptySummary(vapid != null || deps.sender != null, settings.globalSendEnabled);
    await detectAndEnqueue(db, now, summary, { elaboracionDays: settings.elaboracionDays, envasadoDays: settings.envasadoDays }, deps.onlyClientId ?? null);
    await dispatchPending(db, now, summary, { sender }, settings.globalSendEnabled);
  } catch (err) {
    await recordWorkerRun(db, trigger, startedAt, { summary, error: String((err as Error)?.message ?? err).slice(0, 300) });
    throw err;
  }
  await recordWorkerRun(db, trigger, startedAt, { summary });
  return summary;
}

/** Cliente del portal dueño de un pedido (por su ID guardado; los históricos sin ID los recoge el cron por nombre). */
export async function portalClientOfPedido(db: SqlExec, pedidoId: string): Promise<string | null> {
  const r = ((await db.execute(sql`select portal_client_id::text as id from production_pedidos where id = ${pedidoId}::uuid`)).rows as Row[])[0];
  return r?.id ? String(r.id) : null;
}
export async function portalClientOfWork(db: SqlExec, workItemId: string): Promise<string | null> {
  const r = ((await db.execute(sql`
    select coalesce(p.portal_client_id, w.portal_client_id)::text as id from work_items w left join production_pedidos p on p.id = w.production_pedido_id where w.id = ${workItemId}::uuid`)).rows as Row[])[0];
  return r?.id ? String(r.id) : null;
}

// ───────────────────────── Notificación de prueba (manual, solo Dirección) ─────────────────────────

export type PushTestResult = { sent: number; failed: number; removed: number; devices: number };

/**
 * Envío PUNTUAL de una notificación REAL de bienvenida a los dispositivos de UN cliente habilitado en el piloto. Es independiente del
 * interruptor global (no lo lee ni lo cambia) y NO toca work_items, portal_push_order_state ni eventos de pedidos del outbox:
 * solo deja una fila de historial `prueba` (ya enviada; el worker solo reclama PENDIENTE/PROCESANDO) y la auditoría.
 */
export async function sendTestPush(staff: PushStaff, clientId: string, deps: { db?: SqlExec; sender?: PushSender | null } = {}): Promise<PushTestResult> {
  need(staff);
  const db = deps.db ?? requireDb();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new PortalError("Cliente inválido.", 400, "VALIDATION");
  const c = ((await db.execute(sql`select id from portal_clients where id = ${clientId}::uuid`)).rows as Row[])[0];
  if (!c) throw new PortalError("Cliente inexistente.", 404, "NOT_FOUND");
  if (!(await isPilotEnabled(db, clientId))) throw new PortalError("El cliente no está habilitado en el piloto de notificaciones.", 409, "PUSH_NOT_ENABLED");
  const sender = deps.sender === undefined ? ((cfg) => (cfg ? createWebPushSender(cfg) : null))(vapidConfig()) : deps.sender;
  if (!sender) throw new PortalError("Faltan las claves VAPID: no se puede enviar la notificación de prueba.", 503, "PUSH_UNAVAILABLE");
  const subs = ((await db.execute(sql`select id::text as id, endpoint, p256dh, auth from portal_push_subscriptions where client_id = ${clientId}::uuid order by created_at`)).rows as Row[]).map(
    (r): PushSubscriptionRow => ({ id: String(r.id), endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }),
  );
  if (!subs.length) throw new PortalError("El cliente no tiene dispositivos suscriptos: nadie activó las notificaciones todavía.", 409, "PUSH_NO_DEVICES");
  // Antirrebote (doble clic / reintentos): una sola prueba por cliente cada 30 s, contada en la base.
  const rl = await rateLimitHit(db, `push-test:${clientId}`, PUSH_TEST_WINDOW_SECONDS, 1);
  if (!rl.allowed) throw new PortalError("Ya se envió una notificación de prueba a este cliente hace instantes. Esperá unos segundos.", 429, "RATE_LIMITED");

  const testId = randomUUID();
  const plan = await planPushSend(subs, { title: PUSH_TEST_TITLE, body: PUSH_TEST_BODY, url: PUSH_TEST_URL, tag: `prueba-${testId}`, eventId: testId }, sender);
  for (const id of plan.sent) await db.execute(sql`update portal_push_subscriptions set last_ok_at = now(), failures = 0, last_error = null where id = ${id}::uuid`);
  for (const id of plan.gone) await db.execute(sql`delete from portal_push_subscriptions where id = ${id}::uuid`);
  for (const f of plan.failed) {
    await db.execute(sql`update portal_push_subscriptions set failures = failures + 1, last_error = ${f.error} where id = ${f.id}::uuid`);
    await db.execute(sql`delete from portal_push_subscriptions where id = ${f.id}::uuid and failures >= ${PUSH_MAX_SUBSCRIPTION_FAILURES}`);
  }
  if (plan.sent.length > 0) {
    await db.execute(sql`
      insert into portal_push_outbox (id, client_id, order_key, order_ref, order_opaque_id, product_key, event_type, title, body, url, status, mode, attempts, sent_count, failed_count, processed_at)
      values (${testId}::uuid, ${clientId}::uuid, ${`prueba:${testId}`}, null, null, '', ${PUSH_TEST_EVENT_TYPE}, ${PUSH_TEST_TITLE}, ${PUSH_TEST_BODY}, ${PUSH_TEST_URL}, 'ENVIADA', 'REAL', 1, ${plan.sent.length}, ${plan.failed.length}, now())`);
  }
  await audit(db, { clientId, type: "PUSH_PRUEBA_ENVIADA", kind: "STAFF", actor: staff.email, detail: { devices: subs.length, sent: plan.sent.length, failed: plan.failed.length, removed: plan.gone.length } });
  return { sent: plan.sent.length, failed: plan.failed.length, removed: plan.gone.length, devices: subs.length };
}
