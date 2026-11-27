"use client";

import { useState, type FormEvent } from "react";
import { PortalHeader } from "./shell";
import { logout } from "./dashboard";

/** Pantalla obligatoria cuando la contraseña es temporal (alta o restablecimiento por el personal de GENUS). */
export function ChangePasswordForm({ username }: { username: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setMsg("Las contraseñas nuevas no coinciden.");
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/entregas/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ current, next }) });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && json.ok !== false) {
        window.location.assign("/entregas");
        return;
      }
      setMsg(json.error ?? "No pudimos cambiar la contraseña.");
    } catch {
      setMsg("No hay conexión. Revisá tu internet y probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PortalHeader right={<button className="gp-btn gp-btn-ghost gp-btn-sm" onClick={() => void logout()}>Salir</button>} />
      <main className="gp-login">
        <div className="gp-login-card" data-testid="change-password">
          <h1>Elegí tu contraseña</h1>
          <p className="gp-meta">Hola <b>{username}</b>. Tu contraseña es temporal: elegí una propia para continuar (mínimo 10 caracteres, con letras y números).</p>
          <form onSubmit={submit} noValidate>
            <div className="gp-field">
              <label htmlFor="gp-cur">Contraseña actual (temporal)</label>
              <input id="gp-cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
            <div className="gp-field">
              <label htmlFor="gp-new">Contraseña nueva</label>
              <input id="gp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
            </div>
            <div className="gp-field">
              <label htmlFor="gp-again">Repetí la contraseña nueva</label>
              <input id="gp-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            </div>
            <button className="gp-btn gp-btn-primary" type="submit" disabled={busy || !current || !next || !again}>{busy ? "Guardando…" : "Guardar y continuar"}</button>
          </form>
          {msg ? <div className="gp-msg err" role="alert" data-testid="change-msg">{msg}</div> : null}
        </div>
      </main>
    </>
  );
}
