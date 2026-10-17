"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TwinShell } from "@/features/os/shell/twin-shell";
import type { AdminClient } from "@/lib/portal/admin-service";

type Json = Record<string, unknown>;
type Problems = {
  unmappedClients: Array<{ label: string; works: number; withoutPedido: number }>;
  mappedWithoutPedido: Array<{ client: string; alias: string; worksWithoutPedido: number }>;
  aliasesWithoutWork: Array<{ client: string; alias: string }>;
};
type Activity = {
  notifications: Array<{ title: string; body: string; createdAt: string | null; read: boolean; emailed: boolean }>;
  emails: Array<{ kind: string; to: string; subject: string; status: string; error: string | null; createdAt: string | null }>;
  receipts: Array<{ product: string; orderRef: string | null; quantity: string; unit: string | null; confirmedAt: string | null; by: string }>;
  audit: Array<{ type: string; kind: string; actor: string | null; createdAt: string | null }>;
};
type Preview = { client: { name: string; code: string }; summary: { inProcess: number; elaboracion: number; envasado: number; listos: number }; products: Array<{ id: string; product: string; orderRef: string | null; stageLabel: string; message: string; quantities: { requested: number | null; delivered: number; pending: number | null; available: number; unit: string | null } }>; deliveries: unknown[] };

type HistItem = { key: string; name: string; works: number; pedidos: number; entregas: number; similarTo: string[] };
type HistPreview = { total: number; items: HistItem[]; previewToken: string };
const ORIGIN: Record<string, string> = { MANUAL: "alta manual", AUTOMATICO: "generado automáticamente", HISTORICO: "generación histórica" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—");
const input = "rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm";

async function api(path: string, body?: Json): Promise<{ ok: boolean; data: Json }> {
  const res = await fetch(`/api/v1/portal-admin${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, data };
}

export function PortalClientesView() {
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [holidays, setHolidays] = useState<Array<{ date: string; name: string; action: string }>>([]);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [activity, setActivity] = useState<{ client: AdminClient; data: Activity } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [form, setForm] = useState({ name: "", aliases: "", emails: "" });
  const [hol, setHol] = useState({ date: "", name: "", action: "AGREGAR" });
  const [demoLink, setDemoLink] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [hist, setHist] = useState<HistPreview | null>(null);
  const [histExclude, setHistExclude] = useState<Set<string>>(new Set());
  const [histBusy, setHistBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
    } catch {
      setMsg({ kind: "err", text: "No se pudo copiar automáticamente. Seleccioná el código y copialo a mano." });
    }
  }

  async function loadHistory() {
    setHistBusy(true);
    try {
      const r = await api("?view=history_preview");
      if (!r.ok) return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo armar la vista previa.") });
      setHist(r.data as unknown as HistPreview);
      setHistExclude(new Set());
    } finally {
      setHistBusy(false);
    }
  }

  async function confirmHistory() {
    if (!hist) return;
    const selected = hist.items.filter((i) => !histExclude.has(i.key));
    if (!selected.length) return;
    if (!window.confirm(`Se van a generar ${selected.length} códigos de cliente. Quedan con el acceso al portal DESHABILITADO y no se envía ningún correo. ¿Confirmás?`)) return;
    setHistBusy(true);
    try {
      const r = await api("", { action: "history_generate", previewToken: hist.previewToken, expectedCount: selected.length, excludeKeys: [...histExclude] });
      if (!r.ok) {
        setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo generar.") });
        if (r.data.code === "PREVIEW_STALE" || r.data.code === "COUNT_MISMATCH") setHist(null);
        return;
      }
      setMsg({ kind: "ok", text: `Códigos generados: ${String(r.data.created)} (ya existentes: ${String(r.data.skippedExisting)}, con error: ${String(r.data.failed)}).` });
      setHist(null);
      await load();
    } finally {
      setHistBusy(false);
    }
  }

  /** Portal de prueba: pide un token temporal de un solo uso y abre el portal real en otra pestaña con una sesión demo. */
  async function openDemo() {
    setDemoBusy(true);
    setDemoLink(null);
    // La pestaña se abre en el mismo gesto del clic (evita el bloqueo de ventanas emergentes) y después se la dirige a la URL.
    const tab = window.open("about:blank", "_blank");
    try {
      const r = await api("", { action: "demo_launch" });
      if (!r.ok) {
        tab?.close();
        return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo abrir el portal de prueba.") });
      }
      const url = String(r.data.url);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
        setMsg({ kind: "ok", text: "Portal de prueba abierto en otra pestaña. El enlace sirve una sola vez y vence en 2 minutos." });
      } else {
        setDemoLink(url);
        setMsg({ kind: "ok", text: "Tu navegador bloqueó la pestaña nueva: usá el enlace de abajo (sirve una sola vez y vence en 2 minutos)." });
      }
    } finally {
      setDemoBusy(false);
    }
  }

  const load = useCallback(async () => {
    const r = await api("?view=clients");
    if (!r.ok) return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudo cargar el portal.") });
    setClients(r.data.clients as AdminClient[]);
    setHolidays(r.data.holidays as typeof holidays);
    const p = await api("?view=problems");
    if (p.ok) setProblems(p.data as unknown as Problems);
  }, []);
  useEffect(() => {
    // Carga inicial: el estado se actualiza al resolver la consulta (no de forma síncrona).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(body: Json, okText: string) {
    const r = await api("", body);
    setMsg(r.ok ? { kind: "ok", text: okText } : { kind: "err", text: String(r.data.error ?? "No se pudo completar la acción.") });
    if (r.ok) await load();
    return r;
  }

  async function createClient() {
    const lines = (s: string) => s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
    const r = await act({ action: "create_client", displayName: form.name, aliases: lines(form.aliases).length ? lines(form.aliases) : [form.name], emails: lines(form.emails) }, "Cliente creado.");
    if (r.ok) {
      setMsg({ kind: "ok", text: `Cliente creado. Código de cliente: ${String(r.data.publicCode)}` });
      setForm({ name: "", aliases: "", emails: "" });
    }
  }

  return (
    <TwinShell title="Portal de Clientes">
      <div className="space-y-6" data-testid="portal-admin">
        <header className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Portal de Clientes</h2>
          <p className="text-sm text-[var(--os-text-muted)]">
            Habilitá clientes para que sigan sus pedidos en <strong>laboratoriogenus.com.ar/entregas</strong>. Cada cliente entra con su código + un correo autorizado + un código temporal. Los datos salen de GENUS OS; nada se carga dos veces.
          </p>
        </header>
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--os-border)] bg-[var(--os-surface)] p-4" data-testid="portal-demo">
          <div className="max-w-2xl space-y-1">
            <h3 className="font-semibold">Portal de prueba</h3>
            <p className="text-sm text-[var(--os-text-muted)]">
              Abre el portal real (laboratoriogenus.com.ar/entregas) con datos <strong>ficticios</strong>, sin crear clientes ni mandar correos. Entrás con tu sesión de GENUS OS; nada de lo que hagas ahí modifica pedidos, entregas ni stock reales.
            </p>
            {demoLink ? <p className="break-all text-sm"><a className="underline" href={demoLink} target="_blank" rel="noopener noreferrer" data-testid="demo-link">Abrir portal de prueba (enlace de un solo uso)</a></p> : null}
          </div>
          <Button onClick={() => void openDemo()} disabled={demoBusy} data-testid="open-demo">{demoBusy ? "Abriendo…" : "Abrir portal de prueba"}</Button>
        </section>
        {msg ? <div role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>{msg.text}</div> : null}

        <section className="space-y-3 rounded-xl border border-[var(--os-border)] p-4">
          <h3 className="font-semibold">Nuevo cliente</h3>
          <div className="grid gap-3 md:grid-cols-3">
            <input className={input} placeholder="Nombre del cliente" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nombre del cliente" />
            <input className={input} placeholder="Nombre(s) en GENUS OS (coma). Vacío = igual al nombre" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} aria-label="Nombres en GENUS OS" />
            <input className={input} placeholder="Correos autorizados (coma)" value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} aria-label="Correos autorizados" />
          </div>
          <Button onClick={() => void createClient()} disabled={form.name.trim().length < 2}>Crear cliente y generar código</Button>
        </section>

        <section className="space-y-3 rounded-xl border border-[var(--os-border)] p-4" data-testid="history-codes">
          <h3 className="font-semibold">Clientes históricos sin código</h3>
          <p className="text-sm text-[var(--os-text-muted)]">
            Los clientes nuevos reciben su código solos. Acá podés generar el de los clientes que ya existían en GENUS OS: primero ves la lista (no se escribe nada) y recién después confirmás. Los códigos quedan con el acceso <strong>deshabilitado</strong> y no se envía ningún correo.
          </p>
          {!hist ? <Button onClick={() => void loadHistory()} disabled={histBusy} data-testid="history-preview-btn">{histBusy ? "Calculando…" : "Ver vista previa"}</Button> : (
            <div className="space-y-2">
              <p className="text-sm" data-testid="history-total">Sin código: {hist.total} · seleccionados: {hist.items.length - histExclude.size}</p>
              <ul className="max-h-72 space-y-1 overflow-auto text-sm" data-testid="history-list">
                {hist.items.map((i) => (
                  <li key={i.key} className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={!histExclude.has(i.key)} onChange={(e) => setHistExclude((prev) => { const n = new Set(prev); if (e.target.checked) n.delete(i.key); else n.add(i.key); return n; })} />
                      <span>{i.name}</span>
                    </label>
                    <span className="text-xs text-[var(--os-text-muted)]">trabajos {i.works} · pedidos {i.pedidos} · entregas {i.entregas}</span>
                    {i.similarTo.length ? <span className="text-xs text-amber-700">¿Parecido a: {i.similarTo.join(", ")}?</span> : null}
                  </li>
                ))}
                {hist.items.length === 0 ? <li className="text-[var(--os-text-muted)]">No hay clientes pendientes.</li> : null}
              </ul>
              <div className="flex gap-2">
                <Button onClick={() => void confirmHistory()} disabled={histBusy || hist.items.length - histExclude.size === 0} data-testid="history-confirm">Generar códigos ({hist.items.length - histExclude.size})</Button>
                <Button onClick={() => setHist(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">Clientes habilitados ({clients.length})</h3>
          {clients.length === 0 ? <p className="text-sm text-[var(--os-text-muted)]">Todavía no hay clientes en el portal.</p> : null}
          {clients.map((c) => (
            <article key={c.id} className="space-y-3 rounded-xl border border-[var(--os-border)] p-4" data-testid="portal-client">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold">{c.displayName} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${c.status === "ACTIVO" ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}`}>{c.status}</span></div>
                  <div className="text-sm text-[var(--os-text-muted)]">Código de cliente: <code className="font-mono text-base text-[var(--os-text)]" data-testid="client-code">{c.publicCode}</code> <button className="text-xs underline" data-testid="copy-code" onClick={() => void copyCode(c.publicCode)}>{copied === c.publicCode ? "¡Copiado!" : "Copiar"}</button> · sesiones activas: {c.liveSessions} · recepciones confirmadas: {c.confirmations}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs" data-testid="client-flags">
                    <span data-testid="flag-access" className={`rounded-full px-2 py-0.5 ${c.accessEnabled ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`}>{c.accessEnabled ? "Acceso habilitado" : "Acceso NO habilitado"}</span>
                    <span data-testid="flag-email" className={`rounded-full px-2 py-0.5 ${c.activeEmails > 0 ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`}>{c.activeEmails > 0 ? `Correo autorizado (${c.activeEmails})` : "Sin correo autorizado"}</span>
                    <span className="rounded-full bg-[var(--os-border)] px-2 py-0.5 text-[var(--os-text-muted)]">Origen: {ORIGIN[c.origin] ?? c.origin}{c.originDetail ? ` · ${c.originDetail}` : ""}</span>
                  </div>
                  {c.suspendReason ? <div className="text-sm text-red-700">Suspendido: {c.suspendReason}</div> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={async () => { const r = await api(`?view=preview&clientId=${c.id}`); if (r.ok) setPreview(r.data as unknown as Preview); else setMsg({ kind: "err", text: String(r.data.error) }); }}>Ver como cliente</Button>
                  <Button onClick={async () => { const r = await api(`?view=activity&clientId=${c.id}`); if (r.ok) setActivity({ client: c, data: r.data as unknown as Activity }); }}>Actividad</Button>
                  <Button data-testid="toggle-access" onClick={() => void act({ action: c.accessEnabled ? "disable_access" : "enable_access", clientId: c.id }, c.accessEnabled ? "Acceso deshabilitado y sesiones cerradas." : "Acceso habilitado. Ahora puede ingresar con un correo autorizado.")}>{c.accessEnabled ? "Deshabilitar acceso" : "Habilitar acceso"}</Button>
                  <Button onClick={() => { const name = window.prompt("Nuevo nombre comercial (el código y los pedidos vinculados no cambian):", c.displayName); if (name && name.trim() !== c.displayName) void act({ action: "rename_client", clientId: c.id, name }, "Nombre actualizado. El código no cambió."); }}>Renombrar</Button>
                  {c.status === "ACTIVO" ? (
                    <Button onClick={() => { const reason = window.prompt("Motivo de la suspensión (se cierran sus sesiones):"); if (reason) void act({ action: "suspend", clientId: c.id, reason }, "Cliente suspendido y sesiones cerradas."); }}>Suspender</Button>
                  ) : (
                    <Button onClick={() => void act({ action: "activate", clientId: c.id }, "Cliente reactivado.")}>Reactivar</Button>
                  )}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Nombres en GENUS OS (vínculo con sus pedidos)</div>
                  <ul className="space-y-1 text-sm">
                    {c.aliases.map((a) => (
                      <li key={a.name} className="flex items-center justify-between gap-2"><span>{a.name}</span><button className="text-xs underline" onClick={() => void act({ action: "remove_alias", clientId: c.id, name: a.name }, "Nombre quitado.")}>Quitar</button></li>
                    ))}
                    {c.aliases.length === 0 ? <li className="text-[var(--os-text-muted)]">Sin nombres: no verá ningún pedido.</li> : null}
                  </ul>
                  <button className="text-sm underline" onClick={() => { const name = window.prompt("Nombre exacto del cliente en GENUS OS:"); if (name) void act({ action: "add_alias", clientId: c.id, name }, "Nombre agregado."); }}>+ Agregar nombre</button>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Correos autorizados</div>
                  <ul className="space-y-1 text-sm">
                    {c.emails.map((e) => (
                      <li key={e.email} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{e.email} <span className="text-xs text-[var(--os-text-muted)]">{e.lastLoginAt ? `· último ingreso ${when(e.lastLoginAt)}` : "· nunca ingresó"}{e.invitedAt ? ` · invitado ${when(e.invitedAt)}` : ""}</span></span>
                        <span className="flex gap-3">
                          <button className="text-xs underline" onClick={() => void act({ action: "invite", clientId: c.id, email: e.email }, "Invitación registrada (se envía solo si el correo está activado).")}>Invitar</button>
                          <button className="text-xs underline" onClick={() => void act({ action: "remove_email", clientId: c.id, email: e.email }, "Correo dado de baja y sesiones cerradas.")}>Quitar</button>
                        </span>
                      </li>
                    ))}
                    {c.emails.length === 0 ? <li className="text-[var(--os-text-muted)]">Sin correos: nadie puede ingresar.</li> : null}
                  </ul>
                  <button className="text-sm underline" onClick={() => { const email = window.prompt("Correo a autorizar:"); if (email) void act({ action: "add_email", clientId: c.id, email }, "Correo autorizado."); }}>+ Autorizar correo</button>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="space-y-2 rounded-xl border border-[var(--os-border)] p-4" data-testid="portal-problems">
          <h3 className="font-semibold">Problemas de vinculación</h3>
          {!problems ? <p className="text-sm text-[var(--os-text-muted)]">Cargando…</p> : (
            <div className="space-y-3 text-sm">
              <div><b>Clientes de GENUS OS sin cliente de portal ({problems.unmappedClients.length}):</b> pedidos que ningún cliente ve todavía.
                <ul className="mt-1 max-h-48 overflow-auto">{problems.unmappedClients.map((u) => <li key={u.label}>{u.label} · {u.works} trabajos</li>)}</ul></div>
              <div><b>Vinculados con trabajos sin pedido ({problems.mappedWithoutPedido.length}):</b> se agrupan por nombre de producto.
                <ul className="mt-1">{problems.mappedWithoutPedido.map((u) => <li key={u.alias}>{u.client} · «{u.alias}» · {u.worksWithoutPedido}</li>)}</ul></div>
              <div><b>Nombres sin trabajos vivos ({problems.aliasesWithoutWork.length}):</b> posible error de tipeo.
                <ul className="mt-1">{problems.aliasesWithoutWork.map((u) => <li key={u.alias}>{u.client} · «{u.alias}»</li>)}</ul></div>
            </div>
          )}
        </section>

        <section className="space-y-2 rounded-xl border border-[var(--os-border)] p-4">
          <h3 className="font-semibold">Feriados por decreto (cuenta de días hábiles)</h3>
          <p className="text-sm text-[var(--os-text-muted)]">Los feriados nacionales ya están calculados. Cargá acá una excepción solo si un decreto agrega o mueve un día.</p>
          <ul className="text-sm">{holidays.map((h) => <li key={h.date} className="flex gap-3">{h.date} · {h.name} · {h.action}<button className="underline" onClick={() => void act({ action: "holiday", date: h.date, remove: true }, "Excepción quitada.")}>Quitar</button></li>)}</ul>
          <div className="flex flex-wrap gap-2">
            <input className={input} type="date" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} aria-label="Fecha" />
            <input className={input} placeholder="Nombre" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} aria-label="Nombre del feriado" />
            <select className={input} value={hol.action} onChange={(e) => setHol({ ...hol, action: e.target.value })} aria-label="Acción"><option value="AGREGAR">Agregar día no laborable</option><option value="QUITAR">Quitar feriado</option></select>
            <Button onClick={() => void act({ action: "holiday", date: hol.date, name: hol.name, holidayAction: hol.action }, "Excepción guardada.")} disabled={!hol.date || hol.name.trim().length < 2}>Guardar</Button>
          </div>
        </section>
      </div>

      {preview ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Vista previa del cliente">
          <div className="max-h-[90dvh] w-full max-w-2xl space-y-3 overflow-auto rounded-2xl bg-[var(--os-surface)] p-5">
            <h3 className="text-lg font-semibold">Lo que ve {preview.client.name} ({preview.client.code})</h3>
            <p className="text-sm text-[var(--os-text-muted)]">Vista de solo lectura, generada con el mismo código que el portal. No inicia sesión como el cliente.</p>
            <p className="text-sm">En proceso {preview.summary.inProcess} · Elaboración {preview.summary.elaboracion} · Envasado {preview.summary.envasado} · Listos {preview.summary.listos}</p>
            <ul className="space-y-2 text-sm">{preview.products.map((p) => <li key={p.id} className="rounded-lg border border-[var(--os-border)] p-2"><b>{p.product}</b> {p.orderRef ? `· Pedido ${p.orderRef}` : ""} · <b>{p.stageLabel}</b><div className="text-[var(--os-text-muted)]">{p.message}</div><div>Solicitado {p.quantities.requested ?? "—"} · entregado {p.quantities.delivered} · disponible {p.quantities.available} {p.quantities.unit ?? ""}</div></li>)}</ul>
            <Button onClick={() => setPreview(null)}>Cerrar</Button>
          </div>
        </div>
      ) : null}
      {activity ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Actividad del cliente">
          <div className="max-h-[90dvh] w-full max-w-3xl space-y-3 overflow-auto rounded-2xl bg-[var(--os-surface)] p-5 text-sm">
            <h3 className="text-lg font-semibold">Actividad de {activity.client.displayName}</h3>
            <div><b>Recepciones confirmadas</b><ul>{activity.data.receipts.map((r, i) => <li key={i}>{when(r.confirmedAt)} · {r.product} {r.orderRef ? `(${r.orderRef})` : ""} · {r.quantity} {r.unit ?? ""} · {r.by}</li>)}{activity.data.receipts.length === 0 ? <li className="text-[var(--os-text-muted)]">Ninguna todavía.</li> : null}</ul></div>
            <div><b>Notificaciones</b><ul>{activity.data.notifications.map((n, i) => <li key={i}>{when(n.createdAt)} · {n.title} — {n.body} {n.emailed ? "· con correo" : ""}</li>)}</ul></div>
            <div><b>Correos</b><ul>{activity.data.emails.map((m, i) => <li key={i}>{when(m.createdAt)} · {m.kind} · {m.to} · <b>{m.status}</b>{m.error ? ` (${m.error})` : ""}</li>)}</ul></div>
            <div><b>Auditoría de accesos y acciones</b><ul>{activity.data.audit.map((a, i) => <li key={i}>{when(a.createdAt)} · {a.type} · {a.kind}{a.actor ? ` · ${a.actor}` : ""}</li>)}</ul></div>
            <Button onClick={() => setActivity(null)}>Cerrar</Button>
          </div>
        </div>
      ) : null}
    </TwinShell>
  );
}
