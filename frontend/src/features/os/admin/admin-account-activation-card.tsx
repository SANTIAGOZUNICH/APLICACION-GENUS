"use client";

import { useCallback, useEffect, useState } from "react";

type Status = { email: string; exists: boolean; userStatus: string | null; sector: string | null; pendingActivation: { expiresAt: string } | null };

async function call<T>(method: string): Promise<T> {
  const res = await fetch("/api/v1/auth/admin/activation", { method, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
  return body as T;
}

/** Activación inicial de la cuenta de Administración: solo la ve el superadministrador (la página responde 404 al resto). */
export function AdminAccountActivationCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus((await call<{ status: Status }>("GET")).status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setLink(await call<{ url: string; expiresAt: string }>("POST"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    setBusy(true);
    try {
      await call("DELETE");
      setLink(null);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setError("No se pudo copiar: mantené presionado el enlace para copiarlo.");
    }
  }

  const btn = "min-h-12 rounded-lg px-4 text-sm font-semibold disabled:opacity-50";
  return (
    <section className="mb-6 rounded-xl border p-4" data-testid="admin-activation-card">
      <h2 className="text-lg font-semibold">Cuenta de Administración / Facturación</h2>
      <p className="mt-1 text-sm">Correo: <strong>{status?.email ?? "admin@laboratoriogenus.com.ar"}</strong></p>
      {status === null && !error ? <p className="mt-2 text-sm">Verificando…</p> : null}
      {status?.exists ? (
        <p className="mt-2 text-sm" data-testid="admin-activation-exists">La cuenta ya existe ({status.sector} · {status.userStatus}). Para cambiar su contraseña usá la lista de usuarios de abajo.</p>
      ) : null}
      {status && !status.exists ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm" data-testid="admin-activation-missing">La cuenta todavía no existe. Generá un enlace de activación (un solo uso, vence en 30 minutos) y abrilo para elegir la contraseña. Se crea con sector Administración, sin privilegios de superadministrador.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void generate()} className={`${btn} bg-[color:var(--ig-accent,#1f4b3a)] text-white`} data-testid="admin-activation-generate">Generar enlace de activación</button>
            {status.pendingActivation ? <button type="button" disabled={busy} onClick={() => void revoke()} className={`${btn} border`} data-testid="admin-activation-revoke">Anular enlace pendiente</button> : null}
          </div>
          {status.pendingActivation && !link ? <p className="text-xs">Hay un enlace vigente hasta {new Date(status.pendingActivation.expiresAt).toLocaleTimeString("es-AR")}. Por seguridad no se vuelve a mostrar: generá uno nuevo.</p> : null}
          {link ? (
            <div className="space-y-2 rounded-lg border p-3" data-testid="admin-activation-link-box">
              <p className="text-xs">Se muestra una sola vez. Vence a las {new Date(link.expiresAt).toLocaleTimeString("es-AR")}.</p>
              <p className="break-all rounded bg-black/10 p-2 text-xs" data-testid="admin-activation-link">{link.url}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy()} className={`${btn} border`}>{copied ? "Copiado" : "Copiar enlace"}</button>
                <a href={link.url} className={`${btn} inline-flex items-center bg-[color:var(--ig-accent,#1f4b3a)] text-white`} data-testid="admin-activation-open">Abrir y elegir contraseña</a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
