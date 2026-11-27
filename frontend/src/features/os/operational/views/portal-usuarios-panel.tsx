"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildPortalAccessMessage, buildWhatsappShareUrl, generateAccessPassword } from "@/lib/portal/access-credentials";
import type { AdminPortalUser } from "@/lib/portal/user-admin-service";

type Json = Record<string, unknown>;
type ClientOpt = { id: string; name: string; code: string; status: string };

const input = "rounded-lg border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-sm";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "nunca");

async function api(body?: Json, query = "?view=users"): Promise<{ ok: boolean; data: Json }> {
  const res = await fetch("/api/v1/portal-admin" + (body ? "" : query), body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Json };
}

/**
 * Usuarios del Portal de Clientes (usuario + contraseña). Solo Dirección y Administración: el servidor lo vuelve a validar.
 * La contraseña temporal se muestra UNA sola vez; después solo existe su hash.
 */
export function PortalUsuariosPanel({ onForbidden }: { onForbidden?: () => void }) {
  const [users, setUsers] = useState<AdminPortalUser[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [allowed, setAllowed] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [secret, setSecret] = useState<{ username: string; password: string } | null>(null);
  const [form, setForm] = useState({ clientId: "", username: "", displayName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api();
    if (r.data.code === "FORBIDDEN") {
      setAllowed(false);
      onForbidden?.();
      return;
    }
    if (!r.ok) return setMsg({ kind: "err", text: String(r.data.error ?? "No se pudieron cargar los usuarios.") });
    setUsers(r.data.users as AdminPortalUser[]);
    setClients(r.data.clients as ClientOpt[]);
  }, [onForbidden]);
  useEffect(() => {
    // Carga inicial: el estado se actualiza al resolver la consulta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function act(body: Json, okText: string) {
    setBusy(true);
    try {
      const r = await api(body);
      setMsg(r.ok ? { kind: "ok", text: okText } : { kind: "err", text: String(r.data.error ?? "No se pudo completar la acción.") });
      if (r.ok) await load();
      return r;
    } finally {
      setBusy(false);
    }
  }

  async function pickClient(clientId: string) {
    if (!clientId) return setForm({ ...form, clientId, username: "", password: "" });
    const r = await api(undefined, `?view=suggest_username&clientId=${encodeURIComponent(clientId)}`);
    const username = r.ok ? String(r.data.username ?? "") : "";
    setForm({ ...form, clientId, username, password: generateAccessPassword(12, username) });
  }

  async function create() {
    const password = form.password || generateAccessPassword(12, form.username);
    const r = await act({ action: "create_user", ...form, password, autoSuffix: true }, "Acceso creado.");
    if (r.ok) {
      setSecret({ username: String(r.data.username), password });
      setForm({ clientId: form.clientId, username: "", displayName: "", email: "", password: "" });
    }
  }

  async function reset(u: AdminPortalUser) {
    if (!window.confirm(`Se genera una contraseña temporal para «${u.username}» y se cierran sus sesiones abiertas. ¿Continuar?`)) return;
    const r = await act({ action: "reset_user_password", userId: u.id }, "Contraseña restablecida y sesiones cerradas.");
    if (r.ok) setSecret({ username: String(r.data.username), password: String(r.data.temporaryPassword) });
  }

  if (!allowed) return null;
  return (
    <section className="space-y-4 rounded-xl border border-[var(--os-border)] p-4" data-testid="portal-users">
      <header className="space-y-1">
        <h3 className="font-semibold">Usuarios del portal (usuario y contraseña)</h3>
        <p className="text-sm text-[var(--os-text-muted)]">
          Cada usuario pertenece a UN cliente y solo ve sus pedidos. El correo es opcional. Quien ya ingresa con su correo sigue pudiendo hacerlo. La contraseña se guarda cifrada: no se puede consultar, solo restablecer.
        </p>
      </header>
      {msg ? <div role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-emerald-500/10 text-emerald-700" : "bg-red-500/10 text-red-700"}`}>{msg.text}</div> : null}
      {secret ? (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="user-secret">
          <div>Credenciales de <b>{secret.username}</b> (se muestran una sola vez; en su primer ingreso el cliente va a poder elegir una contraseña propia):</div>
          <div className="grid gap-1 sm:grid-cols-2">
            <code className="block select-all rounded bg-[var(--os-surface)] px-3 py-2 font-mono text-base" data-testid="user-secret-username">{secret.username}</code>
            <code className="block select-all rounded bg-[var(--os-surface)] px-3 py-2 font-mono text-base" data-testid="user-secret-value">{secret.password}</code>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button data-testid="copy-credentials" onClick={() => void navigator.clipboard?.writeText(buildPortalAccessMessage(secret.username, secret.password)).then(() => setMsg({ kind: "ok", text: "Credenciales copiadas al portapapeles." })).catch(() => setMsg({ kind: "err", text: "No se pudo copiar: seleccionalas y copialas a mano." }))}>Copiar credenciales</Button>
            <a className="inline-flex items-center rounded-lg border border-[var(--os-border)] px-3 py-2 text-sm font-medium" data-testid="share-whatsapp" href={buildWhatsappShareUrl(secret.username, secret.password)} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
            <Button onClick={() => setSecret(null)}>Ya las anoté</Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-5" data-testid="user-form">
        <select className={input} value={form.clientId} onChange={(e) => void pickClient(e.target.value)} aria-label="Cliente">
          <option value="">Cliente…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </select>
        <input className={input} placeholder="Usuario (ej. compras.acme)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} aria-label="Usuario" autoCapitalize="none" />
        <input className={input} placeholder="Nombre (opcional)" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-label="Nombre" />
        <input className={input} placeholder="Correo (opcional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="Correo opcional" />
        <input className={input} placeholder="Contraseña" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Contraseña inicial" autoComplete="off" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setForm({ ...form, password: generateAccessPassword(12, form.username) })} disabled={busy || !form.clientId} data-testid="regen-password">Regenerar</Button>
        <Button onClick={() => void create()} disabled={busy || !form.clientId || form.username.trim().length < 3} data-testid="create-user">Crear acceso</Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="user-table">
          <thead className="text-xs uppercase text-[var(--os-text-muted)]"><tr><th className="py-1 pr-3">Cliente</th><th className="pr-3">Usuario</th><th className="pr-3">Correo</th><th className="pr-3">Estado</th><th className="pr-3">Último acceso</th><th>Acciones</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--os-border)] align-top" data-testid="user-row">
                <td className="py-2 pr-3">{u.clientName}</td>
                <td className="pr-3"><b>{u.username}</b>{u.displayName ? <div className="text-xs text-[var(--os-text-muted)]">{u.displayName}</div> : null}</td>
                <td className="pr-3">{u.email ?? <span className="text-[var(--os-text-muted)]">sin correo</span>}</td>
                <td className="pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${u.status === "ACTIVO" ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}`}>{u.status === "ACTIVO" ? "Activo" : "Desactivado"}</span>
                  {u.locked ? <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700">Bloqueado por intentos</span> : null}
                  {u.mustChangePassword ? <span className="ml-1 text-xs text-[var(--os-text-muted)]">clave temporal</span> : null}
                  <div className="text-xs text-[var(--os-text-muted)]">sesiones: {u.liveSessions}</div>
                </td>
                <td className="pr-3">{when(u.lastLoginAt)}</td>
                <td className="space-x-3 whitespace-nowrap py-2">
                  <button className="text-xs underline" onClick={() => void reset(u)} data-testid="reset-user">Restablecer contraseña</button>
                  <button className="text-xs underline" onClick={() => void act({ action: u.status === "ACTIVO" ? "deactivate_user" : "activate_user", userId: u.id }, u.status === "ACTIVO" ? "Usuario desactivado y sesiones cerradas." : "Usuario activado.")} data-testid="toggle-user">{u.status === "ACTIVO" ? "Desactivar" : "Activar"}</button>
                  <button className="text-xs underline" onClick={() => { const email = window.prompt("Correo (opcional, vacío para quitarlo):", u.email ?? ""); if (email !== null) void act({ action: "update_user", userId: u.id, email, displayName: u.displayName ?? "" }, "Usuario actualizado."); }}>Correo</button>
                  <button className="text-xs underline" onClick={() => { if (window.confirm(`Dar de baja a «${u.username}»? Se cierran sus sesiones y se libera el nombre de usuario.`)) void act({ action: "remove_user", userId: u.id }, "Usuario dado de baja."); }}>Baja</button>
                </td>
              </tr>
            ))}
            {users.length === 0 ? <tr><td colSpan={6} className="py-3 text-[var(--os-text-muted)]">Todavía no hay usuarios con contraseña.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
