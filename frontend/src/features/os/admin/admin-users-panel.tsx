"use client";

import { useCallback, useEffect, useState } from "react";

type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  sector: string;
  sectorLabel: string;
  status: string;
  roleLabel: string;
  jobTitle: string;
  lastLoginAt: string | null;
  updatedAt: string;
};

type AuditEvent = {
  id: string;
  eventType: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

type SectorOption = { id: string; label: string };

const STATUS_OPTIONS = ["ACTIVO", "BLOQUEADO", "INACTIVO"] as const;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Error ${res.status}`);
  }
  return body as T;
}

export function AdminUsersPanel({ sectors }: { sectors: SectorOption[] }) {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [sector, setSector] = useState("");
  const [status, setStatus] = useState("ACTIVO");
  const [reason, setReason] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    const data = await api<{ users: PublicUser[] }>("/api/v1/auth/admin/users");
    setUsers(data.users);
  }, []);

  useEffect(() => {
    loadUsers().catch((err) => setError(err instanceof Error ? err.message : "Error"));
  }, [loadUsers]);

  useEffect(() => {
    const selected = users.find((u) => u.id === selectedId);
    if (!selected) return;
    setDisplayName(selected.displayName);
    setEmail(selected.email);
    setSector(selected.sector);
    setStatus(selected.status);
    setReason("");
    setNewPassword("");
    api<{ events: AuditEvent[] }>(`/api/v1/auth/admin/users/${selected.id}/audit`)
      .then((data) => setAudit(data.events))
      .catch(() => setAudit([]));
  }, [selectedId, users]);

  async function saveProfile() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/api/v1/auth/admin/users/${selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName, email, sector, status, reason }),
      });
      setMessage("Usuario actualizado.");
      setNewPassword("");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ sessionsRevoked: number }>(
        `/api/v1/auth/admin/users/${selectedId}/reset-password`,
        {
          method: "POST",
          body: JSON.stringify({ newPassword, reason }),
        }
      );
      setMessage(
        `Contraseña restablecida. Sesiones revocadas: ${result.sessionsRevoked}.`
      );
      setNewPassword("");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al restablecer");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSessions() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ sessionsRevoked: number }>(
        `/api/v1/auth/admin/users/${selectedId}/revoke-sessions`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        }
      );
      setMessage(`Sesiones cerradas: ${result.sessionsRevoked}.`);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cerrar sesiones");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="border-b border-[color:var(--ig-border,rgba(0,0,0,.12))] pb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-[color:var(--ig-text,#111)]">
          Administración de usuarios
        </h1>
        <p className="mt-1 text-sm text-[color:var(--ig-muted,#555)]">
          Panel privado. No aparece en la navegación del sistema.
        </p>
      </header>

      {error ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
        <section className="overflow-hidden rounded-lg border border-[color:var(--ig-border,rgba(0,0,0,.12))]">
          <div className="border-b px-3 py-2 text-sm font-medium">Usuarios</div>
          <ul className="max-h-[70vh] divide-y overflow-auto">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-black/5 ${
                    selectedId === u.id ? "bg-black/5" : ""
                  }`}
                  onClick={() => setSelectedId(u.id)}
                >
                  <span className="font-medium">{u.displayName}</span>
                  <span className="text-xs opacity-70">{u.email}</span>
                  <span className="text-xs opacity-70">
                    {u.sectorLabel || u.sector} · {u.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-[color:var(--ig-border,rgba(0,0,0,.12))] p-4">
          {!selectedId ? (
            <p className="text-sm opacity-70">Seleccioná un usuario.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Nombre visible
                <input
                  className="rounded border px-3 py-2"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Email (conserva el mismo userId)
                <input
                  className="rounded border px-3 py-2"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Sector
                <select
                  className="rounded border px-3 py-2"
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Estado
                <select
                  className="rounded border px-3 py-2"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Motivo (obligatorio)
                <input
                  className="rounded border px-3 py-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motivo del cambio"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="rounded bg-[color:var(--ig-accent,#1f4b3a)] px-3 py-2 text-sm text-white disabled:opacity-50"
                  onClick={() => void saveProfile()}
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => void revokeSessions()}
                >
                  Cerrar todas las sesiones
                </button>
              </div>

              <div className="mt-2 border-t pt-3">
                <label className="flex flex-col gap-1 text-sm">
                  Nueva contraseña
                  <input
                    type="password"
                    className="rounded border px-3 py-2"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <p className="mt-1 text-xs opacity-70">
                  Invalida la anterior y revoca todas las sesiones. Nunca se muestra ni se
                  audita en claro.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  className="mt-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
                  onClick={() => void resetPassword()}
                >
                  Restablecer contraseña
                </button>
              </div>

              <div className="mt-2 border-t pt-3">
                <h2 className="mb-2 text-sm font-medium">Auditoría reciente</h2>
                <ul className="max-h-56 space-y-2 overflow-auto text-xs">
                  {audit.length === 0 ? (
                    <li className="opacity-70">Sin eventos.</li>
                  ) : (
                    audit.map((ev) => (
                      <li key={ev.id} className="rounded border px-2 py-1">
                        <div className="font-medium">{ev.eventType}</div>
                        <div className="opacity-70">{ev.createdAt}</div>
                        <pre className="mt-1 whitespace-pre-wrap break-all opacity-80">
                          {JSON.stringify(ev.detail)}
                        </pre>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
