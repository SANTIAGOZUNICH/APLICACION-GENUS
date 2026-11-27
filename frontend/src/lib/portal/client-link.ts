/**
 * Vínculo por ID entre pedidos/trabajos de GENUS OS y el cliente del portal (`portal_clients.id`).
 *
 * Causa raíz que corrige: el portal vinculaba por NOMBRE (texto libre del pedido ⇄ alias). Una diferencia de escritura (guion,
 * «S.A.», sin espacio…) creaba otro cliente «automático» y el pedido quedaba huérfano; además un pedido sin trabajos con un
 * estado distinto de INGRESO no se mostraba. Ahora:
 *  - Al crear/editar un pedido se guarda el ID del cliente (elegido en el formulario o resuelto SIN ambigüedad por nombre).
 *  - Los trabajos heredan el ID de su pedido (o el del nombre resuelto si no tienen pedido).
 *  - El portal lista por ese ID; el nombre solo es respaldo para históricos y SOLO si es inequívoco.
 *  - Backfill idempotente (solo Dirección, bajo demanda) para los históricos; ambiguos y sin coincidencia se REPORTAN, nunca se vinculan.
 *
 * Nada de esto toca stock, estados operativos ni cantidades: solo escribe `portal_client_id`.
 */
import "server-only";

import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db/client";
import { schedulePortalPush } from "./push/push-trigger";
import { ensureClientIdentity, type IdentitySource } from "./client-identity";
import { normalizeClientName } from "./client-identity-rules";
import { buildNameIndex, isClientUuid, resolveName, type NameIndex } from "./client-link-rules";
import { canManagePortal, PORTAL_FORBIDDEN_MESSAGE } from "./portal-access";
import { audit, PortalError, type Row, type SqlExec } from "./store";

const LIVE_W = sql`w.deleted_at is null and w.operational_cancelled_at is null and w.operational_status <> 'cancelado' and w.status::text <> 'CANCELADO'`;

export async function loadNameIndex(db: SqlExec): Promise<NameIndex> {
  const clients = (await db.execute(sql`select id::text as id, display_name from portal_clients`)).rows as Row[];
  const aliases = (await db.execute(sql`select client_id::text as client_id, name_key from portal_client_aliases where removed_at is null`)).rows as Row[];
  return buildNameIndex(
    clients.map((c) => ({ id: String(c.id), displayName: String(c.display_name) })),
    aliases.map((a) => ({ clientId: String(a.client_id), nameKey: String(a.name_key) }))
  );
}

export async function clientExists(db: SqlExec, clientId: string): Promise<boolean> {
  if (!isClientUuid(clientId)) return false;
  return ((await db.execute(sql`select 1 from portal_clients where id = ${clientId}::uuid`)).rows as Row[]).length > 0;
}

// ───────────────────────── Selector de cliente del formulario de Pedidos ─────────────────────────

export type PortalClientOption = { id: string; name: string; code: string; status: string; labels: string[] };

/** Clientes del portal con TODAS las formas con las que Producción los nombra (nombre comercial + alias vigentes). */
export async function listPortalClientOptions(db: SqlExec = getDb() as unknown as SqlExec): Promise<PortalClientOption[]> {
  const clients = (await db.execute(sql`select id::text as id, display_name, public_code, status from portal_clients order by display_name`)).rows as Row[];
  const aliases = (await db.execute(sql`select client_id::text as client_id, name_label from portal_client_aliases where removed_at is null order by name_label`)).rows as Row[];
  return clients.map((c) => {
    const id = String(c.id);
    const labels: string[] = [];
    const seen = new Set<string>();
    for (const label of [String(c.display_name), ...aliases.filter((a) => a.client_id === id).map((a) => String(a.name_label))]) {
      const key = normalizeClientName(label)?.key;
      if (key && !seen.has(key)) {
        seen.add(key);
        labels.push(label);
      }
    }
    return { id, name: String(c.display_name), code: String(c.public_code), status: String(c.status), labels };
  });
}

// ───────────────────────── Vincular un pedido ─────────────────────────

export type LinkVia = "explicit" | "name" | "created" | "ambiguous" | "none";
export type LinkResult = { clientId: string | null; via: LinkVia };

/** Resuelve (sin escribir) a qué cliente corresponde un pedido: ID elegido, nombre inequívoco, cliente nuevo o ninguno. */
async function resolveClient(db: SqlExec, input: { cliente: unknown; portalClientId?: unknown; source: IdentitySource; actor?: string | null }): Promise<LinkResult> {
  if (input.portalClientId != null && input.portalClientId !== "") {
    if (!(await clientExists(db, String(input.portalClientId)))) throw new PortalError("El cliente elegido ya no existe en el Portal de Clientes.", 400, "CLIENT_NOT_FOUND");
    return { clientId: String(input.portalClientId), via: "explicit" };
  }
  if (!normalizeClientName(input.cliente)) return { clientId: null, via: "none" };
  const r = resolveName(input.cliente, await loadNameIndex(db));
  if (r.status === "unique") return { clientId: r.clientId, via: "name" };
  if (r.status === "ambiguous") return { clientId: null, via: "ambiguous" };
  const created = await ensureClientIdentity(input.cliente, { source: input.source, actor: input.actor }, db);
  return created ? { clientId: created.clientId, via: "created" } : { clientId: null, via: "none" };
}

/**
 * Deja el pedido vinculado al cliente (ID elegido o nombre inequívoco; si el nombre es nuevo se crea la identidad como antes) y
 * propaga el vínculo a sus trabajos. Idempotente. Lanza ante error: usar `linkPedidoSafe` en los flujos de Producción.
 */
export async function linkPedidoToClient(
  pedidoId: string,
  input: { cliente: unknown; portalClientId?: unknown; source: IdentitySource; actor?: string | null },
  db: SqlExec = getDb() as unknown as SqlExec
): Promise<LinkResult> {
  const result = await resolveClient(db, input);
  const prev = ((await db.execute(sql`select portal_client_id::text as id from production_pedidos where id = ${pedidoId}::uuid`)).rows as Row[])[0];
  if (!prev) return result;
  const before = prev.id ? String(prev.id) : null;
  if (before !== result.clientId) {
    await db.execute(sql`update production_pedidos set portal_client_id = ${result.clientId}::uuid where id = ${pedidoId}::uuid`);
    if (result.clientId) {
      await db.execute(sql`update work_items set portal_client_id = ${result.clientId}::uuid where production_pedido_id = ${pedidoId}::uuid and portal_client_id is distinct from ${result.clientId}::uuid`);
    } else if (before) {
      // El pedido quedó sin vínculo (nombre ambiguo/sin cliente): sus trabajos que tenían ESE vínculo vuelven a depender del nombre.
      await db.execute(sql`update work_items set portal_client_id = null where production_pedido_id = ${pedidoId}::uuid and portal_client_id = ${before}::uuid`);
    }
    if (result.via === "explicit" || before) {
      await audit(db, { clientId: result.clientId ?? before, type: "PEDIDO_VINCULADO", kind: "SISTEMA", actor: input.actor ?? null, detail: { pedidoId, via: result.via, before, after: result.clientId } });
    }
  }
  return result;
}

/** Para los flujos reales de Producción: NUNCA rompe el alta/edición del pedido (la conciliación y el backfill lo recuperan). */
export async function linkPedidoSafe(pedidoId: string, input: { cliente: unknown; portalClientId?: unknown; source: IdentitySource; actor?: string | null }): Promise<LinkResult | null> {
  try {
    if (!isDatabaseConfigured()) return null;
    const linked = await linkPedidoToClient(pedidoId, input);
    // Pedido recién asignado a un cliente: «Pedido recibido» al instante (en segundo plano; nunca afecta al alta).
    if (linked?.clientId) schedulePortalPush({ clientId: linked.clientId });
    return linked;
  } catch (err) {
    console.error("[portal] no se pudo vincular el pedido al cliente del portal (el backfill lo reintenta)", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Trabajo nuevo: hereda el ID del cliente de su pedido; sin pedido (o con pedido histórico sin ID) se resuelve su nombre
 * (inequívoco o identidad nueva, como antes). Nunca rompe el alta del trabajo.
 */
export async function linkWorkSafe(workId: string | null | undefined, client: unknown, source: IdentitySource, actor?: string | null): Promise<void> {
  try {
    if (!workId || !isDatabaseConfigured()) return;
    const db = getDb() as unknown as SqlExec;
    const w = ((await db.execute(sql`
      select w.portal_client_id::text as wid, p.portal_client_id::text as pid
        from work_items w left join production_pedidos p on p.id = w.production_pedido_id and p.deleted_at is null
       where w.id = ${workId}::uuid`)).rows as Row[])[0];
    if (!w) return;
    let target: string | null = w.pid ? String(w.pid) : null;
    if (!target) {
      const r = await resolveClient(db, { cliente: client, source, actor });
      target = r.clientId;
    }
    if (target && target !== (w.wid ? String(w.wid) : null)) {
      await db.execute(sql`update work_items set portal_client_id = ${target}::uuid where id = ${workId}::uuid`);
    }
  } catch (err) {
    console.error("[portal] no se pudo vincular el trabajo al cliente del portal (el backfill lo reintenta)", err instanceof Error ? err.message : err);
  }
}

// ───────────────────────── Backfill de históricos y reporte ─────────────────────────

export type BackfillGroup = { name: string; pedidos: number; works: number; ops: string[] };
export type BackfillAmbiguous = BackfillGroup & { clients: Array<{ id: string; name: string }> };
export type BackfillReport = {
  executed: boolean;
  pedidos: { pending: number; linkable: number; ambiguous: number; unmatched: number };
  works: { pending: number; viaPedido: number; viaName: number; ambiguous: number; unmatched: number };
  /** Trabajos cuyo ID propio difiere del de su pedido (prevalece el del pedido; el del trabajo es solo informativo). */
  divergent: number;
  ambiguous: BackfillAmbiguous[];
  unmatched: BackfillGroup[];
  applied: { pedidos: number; works: number };
};

const REPORT_LIMIT = 200;
const chunk = <T,>(items: T[], n = 400): T[][] => Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, (i + 1) * n));
const uuidList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/**
 * Calcula (y con `execute` aplica) el vínculo por ID de los históricos. Solo toca filas con `portal_client_id` NULO: es idempotente
 * y nunca pisa un vínculo existente. Vincula únicamente lo INEQUÍVOCO (el nombre normalizado apunta a UN solo cliente).
 */
export async function runIdBackfill(opts: { execute: boolean; actor?: string | null }, db: SqlExec = getDb() as unknown as SqlExec): Promise<BackfillReport> {
  const index = await loadNameIndex(db);
  const clientNames = new Map(((await db.execute(sql`select id::text as id, display_name from portal_clients`)).rows as Row[]).map((c) => [String(c.id), String(c.display_name)]));
  const pedidos = (await db.execute(sql`select id::text as id, op, cliente, portal_client_id::text as cid from production_pedidos where deleted_at is null`)).rows as Row[];
  const works = (await db.execute(sql`
    select w.id::text as id, w.client, w.portal_client_id::text as wid, w.production_pedido_id::text as pedido_id
      from work_items w where ${LIVE_W}`)).rows as Row[];

  const pedidoCid = new Map<string, string | null>(pedidos.map((p) => [String(p.id), p.cid ? String(p.cid) : null]));
  const report: BackfillReport = {
    executed: opts.execute,
    pedidos: { pending: 0, linkable: 0, ambiguous: 0, unmatched: 0 },
    works: { pending: 0, viaPedido: 0, viaName: 0, ambiguous: 0, unmatched: 0 },
    divergent: 0,
    ambiguous: [],
    unmatched: [],
    applied: { pedidos: 0, works: 0 },
  };
  const amb = new Map<string, BackfillAmbiguous>();
  const unm = new Map<string, BackfillGroup>();
  const bump = (target: "ambiguous" | "unmatched", raw: unknown, kind: "pedidos" | "works", op: string | null, clientIds?: string[]) => {
    const n = normalizeClientName(raw);
    const key = n?.key ?? "(sin nombre)";
    const label = n?.label ?? "(sin nombre)";
    if (target === "ambiguous") {
      const g = amb.get(key) ?? { name: label, pedidos: 0, works: 0, ops: [], clients: (clientIds ?? []).map((id) => ({ id, name: clientNames.get(id) ?? id })) };
      g[kind]++;
      if (op && g.ops.length < 8 && !g.ops.includes(op)) g.ops.push(op);
      amb.set(key, g);
    } else {
      const g = unm.get(key) ?? { name: label, pedidos: 0, works: 0, ops: [] };
      g[kind]++;
      if (op && g.ops.length < 8 && !g.ops.includes(op)) g.ops.push(op);
      unm.set(key, g);
    }
  };

  // 1) Pedidos sin ID: nombre inequívoco → vincular; ambiguo / sin coincidencia → reportar.
  const toLinkPedidos = new Map<string, string[]>(); // clientId → pedidoIds
  for (const p of pedidos) {
    if (p.cid) continue;
    report.pedidos.pending++;
    const r = resolveName(p.cliente, index);
    if (r.status === "unique") {
      report.pedidos.linkable++;
      toLinkPedidos.set(r.clientId, [...(toLinkPedidos.get(r.clientId) ?? []), String(p.id)]);
      pedidoCid.set(String(p.id), r.clientId);
    } else if (r.status === "ambiguous") {
      report.pedidos.ambiguous++;
      bump("ambiguous", p.cliente, "pedidos", p.op ? String(p.op) : null, r.clientIds);
    } else {
      report.pedidos.unmatched++;
      bump("unmatched", p.cliente, "pedidos", p.op ? String(p.op) : null);
    }
  }

  // 2) Trabajos sin ID: heredan el de su pedido (ya vinculado o por vincular); sin pedido vinculado, nombre inequívoco.
  const toLinkWorks = new Map<string, string[]>();
  for (const w of works) {
    const pid = w.pedido_id ? pedidoCid.get(String(w.pedido_id)) ?? null : null;
    if (w.wid && pid && String(w.wid) !== pid) report.divergent++;
    if (w.wid) continue;
    report.works.pending++;
    if (pid) {
      report.works.viaPedido++;
      toLinkWorks.set(pid, [...(toLinkWorks.get(pid) ?? []), String(w.id)]);
      continue;
    }
    const r = resolveName(w.client, index);
    if (r.status === "unique") {
      report.works.viaName++;
      toLinkWorks.set(r.clientId, [...(toLinkWorks.get(r.clientId) ?? []), String(w.id)]);
    } else if (r.status === "ambiguous") {
      report.works.ambiguous++;
      bump("ambiguous", w.client, "works", null, r.clientIds);
    } else {
      report.works.unmatched++;
      bump("unmatched", w.client, "works", null);
    }
  }
  report.ambiguous = [...amb.values()].sort((a, b) => b.pedidos + b.works - (a.pedidos + a.works)).slice(0, REPORT_LIMIT);
  report.unmatched = [...unm.values()].sort((a, b) => b.pedidos + b.works - (a.pedidos + a.works)).slice(0, REPORT_LIMIT);

  if (opts.execute) {
    for (const [clientId, ids] of toLinkPedidos) {
      for (const part of chunk(ids)) {
        const rows = (await db.execute(sql`update production_pedidos set portal_client_id = ${clientId}::uuid where id in (${uuidList(part)}) and portal_client_id is null returning id`)).rows;
        report.applied.pedidos += rows.length;
      }
    }
    for (const [clientId, ids] of toLinkWorks) {
      for (const part of chunk(ids)) {
        const rows = (await db.execute(sql`update work_items set portal_client_id = ${clientId}::uuid where id in (${uuidList(part)}) and portal_client_id is null returning id`)).rows;
        report.applied.works += rows.length;
      }
    }
    await audit(db, {
      type: "VINCULO_ID_BACKFILL", kind: "STAFF", actor: opts.actor ?? null,
      detail: { applied: report.applied, pedidos: report.pedidos, works: report.works, divergent: report.divergent, ambiguous: report.ambiguous.length, unmatched: report.unmatched.length },
    });
  }
  return report;
}

/** Ejecución bajo demanda: Administración, Producción y Dirección. */
export async function executeIdBackfill(staff: { email: string; sector: string }, db: SqlExec = getDb() as unknown as SqlExec): Promise<BackfillReport> {
  if (!canManagePortal(staff.sector)) throw new PortalError(PORTAL_FORBIDDEN_MESSAGE, 403, "FORBIDDEN");
  return runIdBackfill({ execute: true, actor: staff.email }, db);
}
