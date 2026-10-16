/**
 * Avisos del portal: «producto listo» (en el portal y por correo), entregas registradas y reintentos de correo.
 *
 * Sin duplicados: cada aviso tiene una clave de deduplicación única en base (cliente + clave) y cada correo otra
 * (clave + destinatario). Un aviso viejo (producto que ya estaba listo antes de habilitar el portal, o más viejo que
 * EMAIL_MAX_AGE_HOURS) se registra como leído y NO se envía: evita una avalancha de correos vencidos al activar el envío.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { EMAIL_MAX_AGE_HOURS, emailMode, portalPublicBaseUrl } from "./config";
import { deliverEmail, type DeliveryResult } from "./email";
import { invitationEmail, readyEmail, type EmailContent } from "./email-templates";
import { loadPortalOverview } from "./data-service";
import { audit, requireDb, PortalError, type Row, type SqlExec } from "./store";

type OutboxKind = "INVITACION" | "LISTO_PARA_ENTREGAR" | "RECEPCION";

const fmtQty = (n: number | null, unit: string | null) =>
  n == null ? null : `${new Intl.NumberFormat("es-AR").format(n)}${unit ? ` ${unit}` : ""}`;

async function recordResult(db: SqlExec, outboxId: string, res: DeliveryResult) {
  await db.execute(sql`
    update portal_email_outbox set status = ${res.status}, provider = ${"provider" in res ? res.provider : null},
           provider_message_id = ${"providerMessageId" in res ? res.providerMessageId : null}, error = ${"error" in res ? res.error : null},
           attempts = attempts + 1, sent_at = ${res.status === "ENVIADO" ? new Date().toISOString() : null}::timestamptz
     where id = ${outboxId}::uuid`);
}

/** Encola (una sola vez por clave) y entrega. Devuelve null si ya existía (duplicado evitado). */
async function enqueueAndSend(
  db: SqlExec,
  a: { clientId: string; kind: OutboxKind; to: string; content: EmailContent; dedupeKey: string | null },
): Promise<{ outboxId: string; status: DeliveryResult["status"] } | null> {
  const id = randomUUID();
  const ins = (await db.execute(sql`
    insert into portal_email_outbox (id, client_id, kind, to_email, subject, body_text, body_html, dedupe_key)
    values (${id}::uuid, ${a.clientId}::uuid, ${a.kind}, ${a.to}, ${a.content.subject}, ${a.content.text}, ${a.content.html}, ${a.dedupeKey})
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id`)).rows as Row[];
  if (!ins.length) return null;
  const res = await deliverEmail({ to: a.to, subject: a.content.subject, text: a.content.text, html: a.content.html }, emailMode());
  await recordResult(db, id, res);
  return { outboxId: id, status: res.status };
}

export type ScanSummary = { clients: number; readyNotified: number; readySilenced: number; emailsQueued: number; deliveryNotices: number };

/** Recorre los clientes activos y genera los avisos pendientes. Idempotente: se puede ejecutar tantas veces como se quiera. */
export async function scanPortalNotifications(now: Date = new Date(), db: SqlExec = requireDb()): Promise<ScanSummary> {
  const summary: ScanSummary = { clients: 0, readyNotified: 0, readySilenced: 0, emailsQueued: 0, deliveryNotices: 0 };
  const clients = (await db.execute(sql`select id::text as id, display_name from portal_clients where status = 'ACTIVO'`)).rows as Row[];
  const maxAgeMs = EMAIL_MAX_AGE_HOURS * 3_600_000;
  for (const c of clients) {
    const clientId = String(c.id);
    const clientName = String(c.display_name);
    summary.clients++;
    const { overview } = await loadPortalOverview(clientId, now, db);
    const emails = ((await db.execute(sql`
      select email from portal_authorized_emails where client_id = ${clientId}::uuid and removed_at is null and status = 'ACTIVO'`)).rows as Row[]).map((r) => String(r.email));

    for (const r of overview.ready) {
      const qty = fmtQty(r.available, r.unit);
      const key = `ready:${r.workItemId}:${r.available ?? "s"}`;
      const fresh = r.readySince != null && now.getTime() - new Date(r.readySince).getTime() <= maxAgeMs;
      const ins = (await db.execute(sql`
        insert into portal_notifications (client_id, kind, dedupe_key, title, body, payload, read_at)
        values (${clientId}::uuid, 'LISTO_PARA_ENTREGAR', ${key}, ${"Tu producto está listo"},
                ${`${r.product}${qty ? ` · ${qty} disponibles` : ""}. Podés coordinar la entrega con nuestro equipo.`},
                ${JSON.stringify({ productId: r.productId })}::jsonb, ${fresh ? null : now.toISOString()}::timestamptz)
        on conflict (client_id, dedupe_key) do nothing
        returning id::text as id`)).rows as Row[];
      if (!ins.length) continue; // ya avisado
      if (!fresh) {
        summary.readySilenced++;
        continue;
      }
      summary.readyNotified++;
      await audit(db, { clientId, type: "AVISO_LISTO_GENERADO", kind: "SISTEMA", detail: { productId: r.productId } });
      let firstOutbox: string | null = null;
      for (const to of emails) {
        const sent = await enqueueAndSend(db, {
          clientId,
          kind: "LISTO_PARA_ENTREGAR",
          to,
          content: readyEmail({ clientName, product: r.product, quantity: qty, portalUrl: portalPublicBaseUrl() }),
          dedupeKey: `${key}:${to}`,
        });
        if (sent) {
          summary.emailsQueued++;
          firstOutbox ??= sent.outboxId;
        }
      }
      if (firstOutbox) {
        await db.execute(sql`update portal_notifications set email_outbox_id = ${firstOutbox}::uuid where client_id = ${clientId}::uuid and dedupe_key = ${key}`);
      }
    }

    // Entregas físicas registradas recientemente (solo aviso en el portal; la confirmación es del cliente).
    for (const d of overview.deliveries) {
      if (d.confirmation || now.getTime() - new Date(d.deliveredAt).getTime() > 14 * 86_400_000) continue;
      const qty = fmtQty(d.quantity, d.unit);
      const ins = (await db.execute(sql`
        insert into portal_notifications (client_id, kind, dedupe_key, title, body, payload)
        values (${clientId}::uuid, 'ENTREGA_REGISTRADA', ${`delivery:${d.id}`}, ${"Registramos una entrega"},
                ${`${d.product}${qty ? ` · ${qty}` : ""}. Cuando lo recibas, confirmá la recepción desde el portal.`}, '{}'::jsonb)
        on conflict (client_id, dedupe_key) do nothing returning id`)).rows;
      if (ins.length) summary.deliveryNotices++;
    }
  }
  return summary;
}

/** Reintenta correos sin enviar (sin proveedor al momento, o con error), solo los recientes. Los de acceso no se reintentan. */
export async function retryPendingEmails(db: SqlExec = requireDb()): Promise<{ attempted: number; sent: number }> {
  const mode = emailMode();
  if (mode === "off") return { attempted: 0, sent: 0 };
  const rows = (await db.execute(sql`
    select id::text as id, to_email, subject, body_text, body_html from portal_email_outbox
     where kind in ('LISTO_PARA_ENTREGAR', 'INVITACION', 'RECEPCION') and status in ('PENDIENTE', 'SIN_PROVEEDOR', 'ERROR')
       and attempts < 5 and created_at > now() - (${EMAIL_MAX_AGE_HOURS} * interval '1 hour')
     order by created_at limit 50`)).rows as Row[];
  let sent = 0;
  for (const r of rows) {
    const res = await deliverEmail({ to: String(r.to_email), subject: String(r.subject), text: String(r.body_text), html: String(r.body_html) }, mode);
    await recordResult(db, String(r.id), res);
    if (res.status === "ENVIADO" || res.status === "CAPTURADO") sent++;
  }
  return { attempted: rows.length, sent };
}

/** Invitación a un correo autorizado (acción de Producción/Dirección). Registra el envío; sin proveedor queda pendiente. */
export async function sendInvitation(args: { clientId: string; email: string; actor: string }, db: SqlExec = requireDb()): Promise<{ status: DeliveryResult["status"] }> {
  const rows = (await db.execute(sql`
    select c.display_name, c.public_code, c.status as client_status from portal_clients c
      join portal_authorized_emails e on e.client_id = c.id and e.removed_at is null and e.email = ${args.email}
     where c.id = ${args.clientId}::uuid`)).rows as Row[];
  const r = rows[0];
  if (!r) throw new PortalError("El correo no está autorizado para ese cliente.", 404, "NOT_FOUND");
  if (r.client_status !== "ACTIVO") throw new PortalError("El cliente está suspendido: reactivalo antes de invitar.", 409, "SUSPENDED");
  const sent = await enqueueAndSend(db, {
    clientId: args.clientId,
    kind: "INVITACION",
    to: args.email,
    content: invitationEmail({ clientName: String(r.display_name), publicCode: String(r.public_code), portalUrl: portalPublicBaseUrl() }),
    dedupeKey: null,
  });
  await db.execute(sql`update portal_authorized_emails set invited_at = now() where client_id = ${args.clientId}::uuid and email = ${args.email} and removed_at is null`);
  await audit(db, { clientId: args.clientId, type: "INVITACION_ENVIADA", kind: "STAFF", actor: args.actor, detail: { status: sent?.status ?? null } });
  return { status: sent?.status ?? "SIN_PROVEEDOR" };
}
