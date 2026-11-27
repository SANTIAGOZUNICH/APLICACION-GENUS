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
import { constantTimeEqual, hmac } from "../security";
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
import { planPushSend, type DeviceOutcome, type PushPayload, type PushSender, type PushSubscriptionRow } from "./push-send";
import { createWebPushSender, vapidConfig, vapidFingerprint, vapidPublicKey, type VapidConfig } from "./vapid";

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

export type PushDeviceRow = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  /** Última vez que el dispositivo se verificó solo (abrió el portal, aceptó un envío o acusó recepción). */
  lastVerifiedAt: string | null;
  lastOkAt: string | null;
  /** Suscripción válida: el servicio push no la rechazó y se creó con la clave VAPID actual. */
  valid: boolean;
  invalidReason: string | null;
  lastError: string | null;
  lastStatus: number | null;
};

export type PushRecentEvent = {
  id: string;
  type: string;
  orderRef: string | null;
  status: string;
  mode: string | null;
  createdAt: string;
  processedAt: string | null;
  /** Dispositivos que el servicio push ACEPTÓ (HTTP 2xx). NO prueba que el celular lo haya mostrado. */
  accepted: number;
  /** Dispositivos que ACUSARON la recepción (el service worker mostró la notificación). */
  received: number;
  error: string | null;
};

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
  /** Resultado de los envíos por dispositivo: aceptados por el servicio push vs. recepción comprobada en el dispositivo vs. errores. */
  deliveries: { aceptadas: number; recibidas: number; errores: number };
  lastFailure: { reason: string; at: string } | null;
  deviceErrors: number;
  devicesList: PushDeviceRow[];
  recentEvents: PushRecentEvent[];
  pilotEnabled: boolean;
  /** «Envío REAL a este cliente (prueba)»: envía de verdad a ESTE cliente aunque el interruptor global siga apagado. */
  realSendEnabled: boolean;
  realSendEnabledAt: string | null;
  enabledAt: string | null;
  baselineAt: string | null;
  baselineOrders: number;
};

export async function isPilotEnabled(db: SqlExec, clientId: string): Promise<boolean> {
  const r = ((await db.execute(sql`select enabled from portal_push_client_pilot where client_id = ${clientId}::uuid`)).rows as Row[])[0];
  return r?.enabled === true;
}

/** Piloto + «Envío REAL a este cliente (prueba)». El envío real por cliente NO depende del interruptor global. */
export async function clientSendMode(db: SqlExec, clientId: string): Promise<{ pilot: boolean; realSend: boolean }> {
  const r = ((await db.execute(sql`select enabled, real_send_enabled from portal_push_client_pilot where client_id = ${clientId}::uuid`)).rows as Row[])[0];
  return { pilot: r?.enabled === true, realSend: r?.enabled === true && r?.real_send_enabled === true };
}

/**
 * Habilita/deshabilita el ENVÍO REAL a UN cliente piloto (solo Dirección, con confirmación explícita). Funciona aunque el interruptor
 * global siga apagado y no cambia nada de los demás clientes. Exige que el cliente ya esté en el piloto (baseline hecho).
 */
export async function setClientRealSend(staff: PushStaff, clientId: string, enabled: boolean, opts: { confirm?: unknown } = {}, db: SqlExec = requireDb()): Promise<{ realSend: boolean }> {
  need(staff);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new PortalError("Cliente inválido.", 400, "VALIDATION");
  if (enabled && opts.confirm !== true) throw new PortalError("Confirmá explícitamente el envío REAL a este cliente.", 400, "CONFIRM_REQUIRED");
  const r = ((await db.execute(sql`select enabled from portal_push_client_pilot where client_id = ${clientId}::uuid`)).rows as Row[])[0];
  if (!r || r.enabled !== true) throw new PortalError("Primero habilitá al cliente en el piloto de notificaciones.", 409, "PUSH_NOT_ENABLED");
  await db.execute(sql`
    update portal_push_client_pilot set real_send_enabled = ${enabled}, real_send_enabled_at = ${enabled ? sql`now()` : sql`null`}, real_send_enabled_by = ${enabled ? staff.email : null}, updated_at = now()
     where client_id = ${clientId}::uuid`);
  await audit(db, { clientId, type: enabled ? "PUSH_ENVIO_REAL_CLIENTE_HABILITADO" : "PUSH_ENVIO_REAL_CLIENTE_DESHABILITADO", kind: "STAFF", actor: staff.email, detail: { enabled } });
  return { realSend: enabled };
}

// ───────────────────────── Acuse de recepción (service worker) ─────────────────────────

/** Credencial que viaja en el payload cifrado de CADA dispositivo: solo quien recibió el push puede acusarlo. No contiene datos del cliente. */
export const pushAckToken = (eventId: string, subscriptionId: string): string => hmac("push-ack", `${eventId}|${subscriptionId}`).slice(0, 40);

/**
 * El service worker avisa que MOSTRÓ la notificación («recepción comprobada en el dispositivo»; mejor esfuerzo). Autenticado por la firma
 * del evento + dispositivo (no por cookie: el SW puede actuar con la app cerrada). No devuelve ningún dato.
 */
export async function recordPushAck(input: { eventId: unknown; sid: unknown; token: unknown; endpoint?: unknown; userAgent?: string | null }, db: SqlExec = requireDb()): Promise<boolean> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { eventId, sid, token } = input;
  if (typeof eventId !== "string" || typeof sid !== "string" || typeof token !== "string" || !uuid.test(eventId) || !uuid.test(sid) || token.length > 80) return false;
  if (!constantTimeEqual(pushAckToken(eventId, sid), token)) return false;
  // Si el SW conoce su endpoint, tiene que coincidir con el del dispositivo (defensa extra); sin endpoint (p. ej. navegador sin suscripción) se acepta por firma.
  const endpoint = typeof input.endpoint === "string" && input.endpoint.length <= 2048 ? input.endpoint : null;
  if (endpoint) {
    const own = ((await db.execute(sql`select 1 as x from portal_push_subscriptions where id = ${sid}::uuid and endpoint = ${endpoint}`)).rows as Row[]).length;
    const known = ((await db.execute(sql`select 1 as x from portal_push_subscriptions where id = ${sid}::uuid`)).rows as Row[]).length;
    if (known && !own) return false;
  }
  // Upsert: el acuse puede llegar antes de que el worker termine de registrar el resultado del envío; el registro del envío no pisa `acked_at`.
  const rows = (await db.execute(sql`
    insert into portal_push_deliveries (outbox_id, client_id, subscription_id, result, acked_at, ack_agent)
    select o.id, o.client_id, ${sid}::uuid, 'ACEPTADO', now(), ${input.userAgent?.slice(0, 200) ?? null} from portal_push_outbox o where o.id = ${eventId}::uuid
    on conflict (outbox_id, subscription_id) do update set acked_at = coalesce(portal_push_deliveries.acked_at, now()), ack_agent = coalesce(portal_push_deliveries.ack_agent, excluded.ack_agent)
    returning id`)).rows;
  if (rows.length) await db.execute(sql`update portal_push_subscriptions set last_verified_at = now() where id = ${sid}::uuid`);
  return rows.length > 0;
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

export type PushWorkerHeartbeat = { lastStartedAt: string | null; lastFinishedAt: string | null; lastCronAt: string | null; lastCronOk: boolean | null; lastCronError: string | null; lastOk: boolean | null; lastError: string | null; lastTrigger: string | null; runsTotal: number; lastSummary: Record<string, unknown> | null };

export async function workerHeartbeat(db: SqlExec): Promise<PushWorkerHeartbeat> {
  const r = ((await db.execute(sql`select last_started_at, last_finished_at, last_cron_at, last_cron_ok, last_cron_error, last_ok, last_error, last_trigger, runs_total, last_summary from portal_push_worker_runs where id = 1`)).rows as Row[])[0];
  return {
    lastStartedAt: isoOrNull(r?.last_started_at), lastFinishedAt: isoOrNull(r?.last_finished_at), lastCronAt: isoOrNull(r?.last_cron_at), lastCronOk: r?.last_cron_ok == null ? null : r.last_cron_ok === true, lastCronError: r?.last_cron_error ? String(r.last_cron_error) : null,
    lastOk: r ? r.last_ok === true : null, lastError: r?.last_error ? String(r.last_error) : null, lastTrigger: r?.last_trigger ? String(r.last_trigger) : null,
    runsTotal: Number(r?.runs_total ?? 0), lastSummary: (r?.last_summary as Record<string, unknown> | null) ?? null,
  };
}

/** Si el cron no corrió en este lapso, el diagnóstico avisa «sin ejecuciones recientes» (el cron corre cada 2 minutos). */
export const CRON_STALE_MS = 5 * 60_000;
export const cronIsStale = (lastCronAt: string | null, now: Date = new Date()): boolean => !lastCronAt || now.getTime() - new Date(lastCronAt).getTime() > CRON_STALE_MS;

export type PushAdminOverview = {
  worker: PushWorkerHeartbeat;
  /** true si el cron no corrió hace más de 5 minutos (o nunca): «sin ejecuciones recientes». */
  cronStale: boolean;
  settings: PushSettings;
  vapidConfigured: boolean;
  /** Huella corta (no secreta) de la clave pública VAPID del servidor, para comparar con la de los dispositivos. */
  vapidFingerprint: string | null;
  cronConfigured: boolean;
  queue: PushQueueIndicators;
  clients: PushClientRow[];
};

export async function pushAdminOverview(staff: PushStaff, db: SqlExec = requireDb(), now: Date = new Date()): Promise<PushAdminOverview> {
  need(staff);
  const clients = (await db.execute(sql`
    select c.id::text as id, c.display_name, c.public_code,
           (select count(*)::int from portal_users u where u.client_id = c.id and u.removed_at is null and u.status = 'ACTIVO') as users,
           (select count(*)::int from portal_push_subscriptions s where s.client_id = c.id) as devices,
           (select max(s.created_at) from portal_push_subscriptions s where s.client_id = c.id) as last_sub_at,
           (select count(*)::int from portal_push_subscriptions s where s.client_id = c.id and (s.last_error is not null or s.invalid_reason is not null)) as device_errors,
           (select max(o.processed_at) from portal_push_outbox o where o.client_id = c.id and o.status = 'ENVIADA' and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as last_sent_at,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status in ('PENDIENTE', 'PROCESANDO') and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as ev_pend,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'SIMULADA') as ev_sim,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'ENVIADA' and o.event_type <> ${PUSH_TEST_EVENT_TYPE}) as ev_env,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'FALLIDA') as ev_fail,
           (select count(*)::int from portal_push_outbox o where o.client_id = c.id and o.status = 'SIN_DISPOSITIVOS') as ev_nodev,
           (select count(*)::int from portal_push_deliveries d where d.client_id = c.id and d.result = 'ACEPTADO' and d.http_status is not null) as dl_acc,
           (select count(*)::int from portal_push_deliveries d where d.client_id = c.id and d.acked_at is not null) as dl_ack,
           (select count(*)::int from portal_push_deliveries d where d.client_id = c.id and d.result = 'ERROR') as dl_err,
           (select coalesce(o.last_error, 'sin detalle') || '|' || coalesce(o.processed_at, o.created_at)::text from portal_push_outbox o
             where o.client_id = c.id and (o.status = 'FALLIDA' or o.last_error is not null) and o.status <> 'SIMULADA' order by coalesce(o.processed_at, o.created_at) desc limit 1) as last_failure,
           coalesce(p.enabled, false) as enabled, p.enabled_at, p.baseline_at, coalesce(p.baseline_orders, 0) as baseline_orders,
           coalesce(p.real_send_enabled, false) as real_send, p.real_send_enabled_at
      from portal_clients c left join portal_push_client_pilot p on p.client_id = c.id
     where c.access_enabled and c.status = 'ACTIVO'
       and (exists (select 1 from portal_users u where u.client_id = c.id and u.removed_at is null) or exists (select 1 from portal_authorized_emails e where e.client_id = c.id and e.removed_at is null))
     order by c.display_name`)).rows as Row[];
  const ids = clients.map((r) => String(r.id));
  const devs = ids.length ? ((await db.execute(sql`
    select id::text as id, client_id::text as client_id, user_agent, created_at, last_verified_at, last_ok_at, invalid_reason, key_mismatch, last_error, last_status
      from portal_push_subscriptions where client_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) order by created_at`)).rows as Row[]) : [];
  const evs = ids.length ? ((await db.execute(sql`
    select * from (
      select o.id::text as id, o.client_id::text as client_id, o.event_type, o.order_ref, o.status, o.mode, o.created_at, o.processed_at, o.last_error,
             (select count(*)::int from portal_push_deliveries d where d.outbox_id = o.id and d.result = 'ACEPTADO' and d.http_status is not null) as accepted,
             (select count(*)::int from portal_push_deliveries d where d.outbox_id = o.id and d.acked_at is not null) as received,
             row_number() over (partition by o.client_id order by o.created_at desc) as rn
        from portal_push_outbox o where o.client_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})) t
     where rn <= 6 order by created_at desc`)).rows as Row[]) : [];
  const vapid = vapidConfig();
  const worker = await workerHeartbeat(db);
  return {
    worker,
    cronStale: cronIsStale(worker.lastCronAt, now),
    settings: await getPushSettings(db),
    vapidConfigured: vapid != null,
    vapidFingerprint: vapid ? vapidFingerprint(vapid.publicKey) : null,
    cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
    queue: await queueIndicators(db),
    clients: clients.map((r) => ({
      id: String(r.id), name: String(r.display_name), code: String(r.public_code), users: Number(r.users), devices: Number(r.devices),
      lastSubscriptionAt: isoOrNull(r.last_sub_at), lastSentAt: isoOrNull(r.last_sent_at), deviceErrors: Number(r.device_errors),
      events: { pendientes: Number(r.ev_pend), simulados: Number(r.ev_sim), enviados: Number(r.ev_env), fallidos: Number(r.ev_fail), sinDispositivos: Number(r.ev_nodev) },
      deliveries: { aceptadas: Number(r.dl_acc), recibidas: Number(r.dl_ack), errores: Number(r.dl_err) },
      lastFailure: r.last_failure ? (([reason, at]) => ({ reason: reason ?? "", at: isoOrNull(at) ?? "" }))(String(r.last_failure).split(/\|([\s\S]*)/)) : null,
      devicesList: devs.filter((d) => String(d.client_id) === String(r.id)).map((d): PushDeviceRow => ({
        id: String(d.id), userAgent: d.user_agent ? String(d.user_agent) : null, createdAt: isoOrNull(d.created_at)!, lastVerifiedAt: isoOrNull(d.last_verified_at), lastOkAt: isoOrNull(d.last_ok_at),
        valid: d.invalid_reason == null && d.key_mismatch !== true, invalidReason: d.invalid_reason ? String(d.invalid_reason) : d.key_mismatch === true ? "CLAVE_VAPID_DISTINTA" : null,
        lastError: d.last_error ? String(d.last_error) : null, lastStatus: d.last_status == null ? null : Number(d.last_status),
      })),
      recentEvents: evs.filter((e) => String(e.client_id) === String(r.id)).map((e): PushRecentEvent => ({
        id: String(e.id), type: String(e.event_type), orderRef: e.order_ref ? String(e.order_ref) : null, status: String(e.status), mode: e.mode ? String(e.mode) : null,
        createdAt: isoOrNull(e.created_at)!, processedAt: isoOrNull(e.processed_at), accepted: Number(e.accepted), received: Number(e.received), error: e.last_error ? String(e.last_error) : null,
      })),
      pilotEnabled: r.enabled === true, realSendEnabled: r.enabled === true && r.real_send === true, realSendEnabledAt: isoOrNull(r.real_send_enabled_at),
      enabledAt: isoOrNull(r.enabled_at), baselineAt: isoOrNull(r.baseline_at), baselineOrders: Number(r.baseline_orders),
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
export type PushClientConfig = {
  available: boolean;
  reason: "ok" | "vapid";
  publicKey: string | null;
  devices: number;
  /** Este dispositivo está registrado Y su suscripción es válida (no fue rechazada por el servicio push). */
  thisDevice: boolean;
  /** El dispositivo estaba registrado pero el servicio push lo rechazó (VAPID): hay que volver a activar las notificaciones. */
  needsResubscribe: boolean;
  pilotEnabled: boolean;
};

export async function pushClientConfig(session: PortalSession, endpoint: string | null, db: SqlExec = requireDb()): Promise<PushClientConfig> {
  const key = vapidPublicKey();
  const owner = ownerKeyOf(session);
  const devices = Number((((await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where client_id = ${session.clientId}::uuid and owner_key = ${owner} and invalid_reason is null`)).rows as Row[])[0]?.n) ?? 0);
  let thisDevice = false;
  let needsResubscribe = false;
  if (endpoint) {
    const r = ((await db.execute(sql`
      update portal_push_subscriptions set last_verified_at = now()
       where endpoint = ${endpoint} and owner_key = ${owner} and client_id = ${session.clientId}::uuid returning invalid_reason, key_mismatch`)).rows as Row[])[0];
    thisDevice = Boolean(r) && r!.invalid_reason == null && r!.key_mismatch !== true;
    needsResubscribe = Boolean(r) && !thisDevice;
  }
  const pilotEnabled = await isPilotEnabled(db, session.clientId);
  if (!key) return { available: false, reason: "vapid", publicKey: null, devices, thisDevice, needsResubscribe, pilotEnabled };
  return { available: true, reason: "ok", publicKey: key, devices, thisDevice, needsResubscribe, pilotEnabled };
}

/** Alta/actualización de un dispositivo. El endpoint es único: si lo tenía otro usuario (equipo compartido), pasa al actual. */
export async function savePushSubscription(session: PortalSession, input: unknown, userAgent: string | null, db: SqlExec = requireDb(), applicationServerKey: unknown = null): Promise<{ registered: true; devices: number }> {
  const current = vapidPublicKey();
  if (!current) throw new PortalError("Las notificaciones no están disponibles por ahora.", 503, "PUSH_UNAVAILABLE");
  const sub = parseSubscriptionInput(input);
  if (!sub) throw new PortalError("Suscripción inválida.", 400, "VALIDATION");
  // La suscripción creada con OTRA clave VAPID jamás podría recibir nada (el servicio push responde 401/403): se rechaza para que el
  // dispositivo se vuelva a suscribir con la clave actual.
  const keyOk = typeof applicationServerKey === "string" && applicationServerKey.length > 0 ? vapidFingerprint(applicationServerKey) === vapidFingerprint(current) : null;
  if (keyOk === false) throw new PortalError("Este dispositivo se suscribió con una clave anterior. Volvé a activar las notificaciones.", 409, "PUSH_KEY_MISMATCH");
  await db.execute(sql`
    insert into portal_push_subscriptions (id, client_id, owner_key, user_id, endpoint, p256dh, auth, user_agent, last_verified_at)
    values (${randomUUID()}::uuid, ${session.clientId}::uuid, ${ownerKeyOf(session)}, ${session.userId}::uuid, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${userAgent?.slice(0, 300) ?? null}, now())
    on conflict (endpoint) do update set client_id = excluded.client_id, owner_key = excluded.owner_key, user_id = excluded.user_id, p256dh = excluded.p256dh,
           auth = excluded.auth, user_agent = excluded.user_agent, failures = 0, last_error = null, last_status = null, invalid_reason = null, invalidated_at = null,
           key_mismatch = false, last_verified_at = now()`);
  // Confirmación REAL: se vuelve a leer de PostgreSQL. Solo si la fila existe se responde que quedó registrado.
  const check = (await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where endpoint = ${sub.endpoint} and client_id = ${session.clientId}::uuid and owner_key = ${ownerKeyOf(session)}`)).rows as Row[];
  if (Number(check[0]?.n ?? 0) !== 1) throw new PortalError("No pudimos registrar este dispositivo. Reintentá.", 500, "PUSH_NOT_SAVED");
  await audit(db, { clientId: session.clientId, type: "PUSH_DISPOSITIVO_ALTA", kind: "CLIENTE", actor: session.actor });
  const devices = Number((((await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where client_id = ${session.clientId}::uuid and owner_key = ${ownerKeyOf(session)} and invalid_reason is null`)).rows as Row[])[0]?.n) ?? 0);
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
     where o.client_id = ${session.clientId}::uuid and o.mode = 'REAL' and o.status in ('ENVIADA', 'SIN_DISPOSITIVOS', 'FALLIDA') and not (o.event_type = ${PUSH_TEST_EVENT_TYPE} and o.status <> 'ENVIADA')
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
        where event_type <> 'prueba' and ((status = 'PENDIENTE' and next_attempt_at <= now()) or (status = 'PROCESANDO' and claimed_at < now() - (${staleSeconds} * interval '1 second')))
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

/** Dispositivos VÁLIDOS de un cliente (sin los rechazados por el servicio push ni con clave VAPID distinta). */
async function validSubscriptions(db: SqlExec, clientId: string): Promise<PushSubscriptionRow[]> {
  return ((await db.execute(sql`
    select id::text as id, endpoint, p256dh, auth from portal_push_subscriptions
     where client_id = ${clientId}::uuid and invalid_reason is null and key_mismatch = false order by created_at`)).rows as Row[]).map(
    (r): PushSubscriptionRow => ({ id: String(r.id), endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }),
  );
}

const hostOf = (endpoint: string): string | null => {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
};

/** Guarda el resultado de CADA dispositivo (upsert por evento+dispositivo; no pisa el acuse) y actualiza la suscripción según el resultado. */
async function recordDeviceOutcomes(db: SqlExec, eventId: string, clientId: string, subs: ReadonlyArray<PushSubscriptionRow>, outcomes: ReadonlyArray<DeviceOutcome>, summary?: PushWorkerSummary): Promise<void> {
  const byId = new Map(subs.map((s2) => [s2.id, s2]));
  for (const o of outcomes) {
    const sub = byId.get(o.id);
    const result = o.kind === "accepted" ? "ACEPTADO" : o.kind === "gone" ? "BAJA" : "ERROR";
    await db.execute(sql`
      insert into portal_push_deliveries (outbox_id, client_id, subscription_id, endpoint_host, result, http_status, error, attempts)
      values (${eventId}::uuid, ${clientId}::uuid, ${o.id}::uuid, ${sub ? hostOf(sub.endpoint) : null}, ${result}, ${o.status}, ${o.error}, 1)
      on conflict (outbox_id, subscription_id) do update set result = excluded.result, http_status = excluded.http_status, error = excluded.error,
             endpoint_host = coalesce(excluded.endpoint_host, portal_push_deliveries.endpoint_host), attempts = portal_push_deliveries.attempts + 1, attempted_at = now()`);
    if (o.kind === "accepted") {
      await db.execute(sql`update portal_push_subscriptions set last_ok_at = now(), failures = 0, last_error = null, last_status = ${o.status}, last_verified_at = now() where id = ${o.id}::uuid`);
    } else if (o.kind === "gone") {
      await db.execute(sql`delete from portal_push_subscriptions where id = ${o.id}::uuid`);
      if (summary) summary.dispositivosBaja++;
    } else if (o.kind === "invalid") {
      await db.execute(sql`update portal_push_subscriptions set invalid_reason = 'VAPID_RECHAZADO', invalidated_at = now(), last_status = ${o.status}, last_error = ${o.error} where id = ${o.id}::uuid`);
    } else {
      await db.execute(sql`update portal_push_subscriptions set failures = failures + 1, last_status = ${o.status}, last_error = ${o.error} where id = ${o.id}::uuid`);
      await db.execute(sql`delete from portal_push_subscriptions where id = ${o.id}::uuid and failures >= ${PUSH_MAX_SUBSCRIPTION_FAILURES}`);
    }
  }
}

/**
 * Entrega los eventos pendientes. Cliente en piloto SIN «envío real» y global apagado → solo registra «simulados» (jamás toca web-push).
 * Envío REAL = interruptor global encendido O envío real habilitado para ESE cliente (Dirección).
 */
export async function dispatchPending(db: SqlExec, now: Date, summary: PushWorkerSummary, deps: { sender: PushSender | null }, globalSendEnabled: boolean): Promise<void> {
  const batch = await claimBatch(db);
  summary.claimed += batch.length;
  for (const ev of batch) {
    try {
      const age = now.getTime() - new Date(ev.createdAt).getTime();
      const mode = await clientSendMode(db, ev.clientId);
      if (!mode.pilot) {
        await finish(db, ev.id, "EXPIRADA", null, { error: "piloto deshabilitado" });
        summary.expiradas++;
        continue;
      }
      if (!globalSendEnabled && !mode.realSend) {
        await finish(db, ev.id, "SIMULADA", "SIMULADO", { error: "envío real apagado (global y de este cliente)" });
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
      const all = await validSubscriptions(db, ev.clientId);
      // En un reintento NO se vuelve a enviar a los dispositivos que ya aceptaron este evento (evita avisos duplicados).
      const done = new Set(((await db.execute(sql`select subscription_id::text as id from portal_push_deliveries where outbox_id = ${ev.id}::uuid and result = 'ACEPTADO' and http_status is not null`)).rows as Row[]).map((r) => String(r.id)));
      const subs = all.filter((s2) => !done.has(s2.id));
      if (!all.length) {
        const invalid = Number((((await db.execute(sql`select count(*)::int as n from portal_push_subscriptions where client_id = ${ev.clientId}::uuid`)).rows as Row[])[0]?.n) ?? 0);
        await finish(db, ev.id, invalid ? "FALLIDA" : "SIN_DISPOSITIVOS", "REAL", { error: invalid ? "todos los dispositivos fueron rechazados por el servicio push (hay que volver a activar las notificaciones)" : null });
        if (invalid) summary.fallidas++;
        else summary.sinDispositivos++;
        continue;
      }
      const payloadFor = (sub: PushSubscriptionRow): PushPayload => ({ title: ev.title, body: ev.body, url: ev.url, tag: `pedido-${ev.id}`, eventId: ev.id, ack: { sid: sub.id, token: pushAckToken(ev.id, sub.id) } });
      const plan = await planPushSend(subs, payloadFor, deps.sender);
      await recordDeviceOutcomes(db, ev.id, ev.clientId, subs, plan.outcomes, summary);
      const accepted = done.size + plan.sent.length;
      const retryable = plan.failed.filter((f) => !f.permanent);
      const firstError = plan.outcomes.find((o) => o.kind !== "accepted")?.error ?? null;
      if (retryable.length > 0 && ev.attempts < PUSH_MAX_ATTEMPTS) {
        const wait = Math.max(pushBackoffMs(ev.attempts), ...retryable.map((f) => f.retryAfterMs ?? 0));
        await release(db, ev.id, wait, retryable[0]!.error);
        summary.reintentos++;
      } else if (accepted > 0) {
        await finish(db, ev.id, "ENVIADA", "REAL", { sent: accepted, failed: plan.failed.length + plan.invalid.length, error: firstError });
        summary.enviadas++;
      } else if (plan.failed.length === 0 && plan.invalid.length === 0) {
        await finish(db, ev.id, "SIN_DISPOSITIVOS", "REAL", { error: "todos los dispositivos habían caducado (404/410)" });
        summary.sinDispositivos++;
      } else {
        await finish(db, ev.id, "FALLIDA", "REAL", { failed: plan.failed.length + plan.invalid.length, error: firstError });
        summary.fallidas++;
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
      insert into portal_push_worker_runs (id, last_started_at, last_finished_at, last_ok, last_error, last_trigger, last_summary, last_cron_at, last_cron_ok, last_cron_error, runs_total, updated_at)
      values (1, ${startedAt.toISOString()}::timestamptz, now(), ${ok}, ${outcome.error ?? null}, ${trigger}, ${outcome.summary ? JSON.stringify(outcome.summary) : null}::jsonb,
              ${trigger === "cron" ? sql`now()` : sql`null`}, ${trigger === "cron" ? ok : null}, ${trigger === "cron" ? (outcome.error ?? null) : null}, 1, now())
      on conflict (id) do update set last_started_at = excluded.last_started_at, last_finished_at = now(), last_ok = excluded.last_ok, last_error = excluded.last_error,
             last_trigger = excluded.last_trigger, last_summary = excluded.last_summary,
             last_cron_at = coalesce(excluded.last_cron_at, portal_push_worker_runs.last_cron_at),
             last_cron_ok = case when excluded.last_cron_at is not null then excluded.last_cron_ok else portal_push_worker_runs.last_cron_ok end,
             last_cron_error = case when excluded.last_cron_at is not null then excluded.last_cron_error else portal_push_worker_runs.last_cron_error end,
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

export type PushTestResult = {
  /** Id del evento de prueba (sirve para consultar después si llegó el acuse de recepción). */
  testId: string | null;
  /** Dispositivos que el servicio push ACEPTÓ (HTTP 2xx). */
  sent: number;
  failed: number;
  removed: number;
  devices: number;
  /** Primer error (con código HTTP) si hubo, para mostrar el motivo. */
  error: string | null;
};

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
  const subs = await validSubscriptions(db, clientId);
  if (!subs.length) throw new PortalError("El cliente no tiene dispositivos suscriptos válidos: nadie activó las notificaciones todavía.", 409, "PUSH_NO_DEVICES");
  // Antirrebote (doble clic / reintentos): una sola prueba por cliente cada 30 s, contada en la base.
  const rl = await rateLimitHit(db, `push-test:${clientId}`, PUSH_TEST_WINDOW_SECONDS, 1);
  if (!rl.allowed) throw new PortalError("Ya se envió una notificación de prueba a este cliente hace instantes. Esperá unos segundos.", 429, "RATE_LIMITED");

  const testId = randomUUID();
  // La fila del evento de prueba se crea ANTES de enviar: el acuse del dispositivo puede llegar apenas el servicio push lo acepta.
  await db.execute(sql`
    insert into portal_push_outbox (id, client_id, order_key, order_ref, order_opaque_id, product_key, event_type, title, body, url, status, mode, attempts, claimed_at)
    values (${testId}::uuid, ${clientId}::uuid, ${`prueba:${testId}`}, null, null, '', ${PUSH_TEST_EVENT_TYPE}, ${PUSH_TEST_TITLE}, ${PUSH_TEST_BODY}, ${PUSH_TEST_URL}, 'PROCESANDO', 'REAL', 1, now())`);
  const plan = await planPushSend(subs, (sub) => ({ title: PUSH_TEST_TITLE, body: PUSH_TEST_BODY, url: PUSH_TEST_URL, tag: `prueba-${testId}`, eventId: testId, ack: { sid: sub.id, token: pushAckToken(testId, sub.id) } }), sender);
  await recordDeviceOutcomes(db, testId, clientId, subs, plan.outcomes);
  const firstError = plan.outcomes.find((o) => o.kind !== "accepted")?.error ?? null;
  // «PROCESANDO» + claimed_at viejo lo reclamaría el worker de pedidos: se cierra siempre acá (el worker solo reclama PENDIENTE/PROCESANDO sin tipo «prueba»).
  await db.execute(sql`
    update portal_push_outbox set status = ${plan.sent.length > 0 ? "ENVIADA" : "FALLIDA"}, sent_count = ${plan.sent.length}, failed_count = ${plan.failed.length + plan.invalid.length}, last_error = ${firstError}, processed_at = now(), claimed_at = null
     where id = ${testId}::uuid`);
  await audit(db, { clientId, type: "PUSH_PRUEBA_ENVIADA", kind: "STAFF", actor: staff.email, detail: { devices: subs.length, sent: plan.sent.length, failed: plan.failed.length, removed: plan.gone.length } });
  return { testId, sent: plan.sent.length, failed: plan.failed.length + plan.invalid.length, removed: plan.gone.length, devices: subs.length, error: firstError };
}

export type PushTestStatus = { testId: string; devices: number; accepted: number; received: number; errors: number; firstError: string | null };

/** Estado de una notificación de prueba: «aceptada por el servicio push» y, aparte, «recepción comprobada en el dispositivo» (acuse del SW). */
export async function getTestPushStatus(staff: PushStaff, testId: string, db: SqlExec = requireDb()): Promise<PushTestStatus> {
  need(staff);
  if (!/^[0-9a-f-]{36}$/i.test(testId)) throw new PortalError("Prueba inválida.", 400, "VALIDATION");
  const r = ((await db.execute(sql`
    select count(*)::int as devices,
           count(*) filter (where result = 'ACEPTADO' and http_status is not null)::int as accepted,
           count(*) filter (where acked_at is not null)::int as received,
           count(*) filter (where result in ('ERROR', 'BAJA'))::int as errors,
           min(error) filter (where result in ('ERROR', 'BAJA')) as first_error
      from portal_push_deliveries where outbox_id = ${testId}::uuid`)).rows as Row[])[0];
  return { testId, devices: Number(r?.devices ?? 0), accepted: Number(r?.accepted ?? 0), received: Number(r?.received ?? 0), errors: Number(r?.errors ?? 0), firstError: r?.first_error ? String(r.first_error) : null };
}


// ───────────────────────── Salud (solo Dirección): verificar producción sin acceso a la base ─────────────────────────

export type PushHealth = {
  ok: boolean;
  /** Problemas detectados, en español, para leer de un vistazo. */
  problems: string[];
  checkedAt: string;
  vapid: { configured: boolean; fingerprint: string | null };
  cron: { secretConfigured: boolean; lastRunAt: string | null; lastOk: boolean | null; lastError: string | null; stale: boolean; minutesSinceLastRun: number | null };
  worker: { lastTrigger: string | null; lastFinishedAt: string | null; lastOk: boolean | null; lastError: string | null; runsTotal: number };
  globalSendEnabled: boolean;
  queue: PushQueueIndicators;
  clients: Array<{
    id: string; name: string; code: string; pilotEnabled: boolean; realSendEnabled: boolean; devices: number; validDevices: number;
    events: PushClientRow["events"]; deliveries: PushClientRow["deliveries"]; lastFailure: PushClientRow["lastFailure"];
    lastEvent: { type: string; status: string; mode: string | null; accepted: number; received: number; at: string } | null;
  }>;
};

/** Resumen de salud del circuito de notificaciones (sin endpoints, claves ni datos de contacto). */
export async function pushHealth(staff: PushStaff, db: SqlExec = requireDb(), now: Date = new Date()): Promise<PushHealth> {
  const ov = await pushAdminOverview(staff, db, now);
  const problems: string[] = [];
  if (!ov.vapidConfigured) problems.push("Faltan las claves VAPID (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT): no se puede enviar.");
  if (!ov.cronConfigured) problems.push("Falta CRON_SECRET: el cron del worker responde 500 y no corre.");
  if (ov.cronStale) problems.push("Sin ejecuciones recientes del cron (más de 5 minutos o nunca).");
  if (ov.worker.lastCronOk === false) problems.push(`La última corrida del cron terminó con error: ${ov.worker.lastCronError ?? "sin detalle"}.`);
  for (const c of ov.clients) {
    if (c.pilotEnabled && !ov.settings.globalSendEnabled && !c.realSendEnabled) problems.push(`${c.name}: piloto habilitado pero el envío es SIMULADO (global apagado y sin «Envío real a este cliente»).`);
    if (c.pilotEnabled && c.devices === 0) problems.push(`${c.name}: ningún dispositivo activó las notificaciones.`);
    const bad = c.devicesList.filter((d) => !d.valid).length;
    if (bad) problems.push(`${c.name}: ${bad} dispositivo(s) con suscripción inválida (el cliente debe volver a activar las notificaciones).`);
  }
  const last = (c: PushClientRow) => c.recentEvents.find((e) => e.type !== PUSH_TEST_EVENT_TYPE) ?? null;
  return {
    ok: problems.length === 0,
    problems,
    checkedAt: now.toISOString(),
    vapid: { configured: ov.vapidConfigured, fingerprint: ov.vapidFingerprint },
    cron: {
      secretConfigured: ov.cronConfigured, lastRunAt: ov.worker.lastCronAt, lastOk: ov.worker.lastCronOk, lastError: ov.worker.lastCronError, stale: ov.cronStale,
      minutesSinceLastRun: ov.worker.lastCronAt ? Math.round((now.getTime() - new Date(ov.worker.lastCronAt).getTime()) / 60_000) : null,
    },
    worker: { lastTrigger: ov.worker.lastTrigger, lastFinishedAt: ov.worker.lastFinishedAt, lastOk: ov.worker.lastOk, lastError: ov.worker.lastError, runsTotal: ov.worker.runsTotal },
    globalSendEnabled: ov.settings.globalSendEnabled,
    queue: ov.queue,
    clients: ov.clients.map((c) => {
      const e = last(c);
      return {
        id: c.id, name: c.name, code: c.code, pilotEnabled: c.pilotEnabled, realSendEnabled: c.realSendEnabled, devices: c.devices, validDevices: c.devicesList.filter((d) => d.valid).length,
        events: c.events, deliveries: c.deliveries, lastFailure: c.lastFailure,
        lastEvent: e ? { type: e.type, status: e.status, mode: e.mode, accepted: e.accepted, received: e.received, at: e.processedAt ?? e.createdAt } : null,
      };
    }),
  };
}
