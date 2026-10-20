"use client";

import { useEffect, useState } from "react";
import { PASSWORD_MIN_LENGTH, validateNewPassword } from "@/lib/auth/admin-activation-rules";

type Phase = "checking" | "invalid" | "form" | "done";

export function ActivarAdministracionForm() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // El token viaja en el fragmento (#t=...): no llega a servidores ni logs. Se borra de la barra al leerlo.
    const t = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!t) {
      queueMicrotask(() => setPhase("invalid"));
      return;
    }
    queueMicrotask(() => setToken(t));
    void fetch("/api/v1/auth/activar-administracion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "inspect", token: t }), cache: "no-store" })
      .then((r) => r.json())
      .then((d: { valid?: boolean; email?: string }) => {
        if (d.valid) {
          setEmail(d.email ?? "");
          setPhase("form");
        } else setPhase("invalid");
      })
      .catch(() => setPhase("invalid"));
  }, []);

  const weak = pw ? validateNewPassword(pw) : null;
  const mismatch = pw2 !== "" && pw !== pw2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = validateNewPassword(pw);
    if (w) return setError(w);
    if (pw !== pw2) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/activar-administracion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "redeem", token, password: pw }), cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 404 || res.status === 409) setPhase("invalid");
        else setError(body.error ?? "No se pudo activar la cuenta.");
      } else {
        setPw("");
        setPw2("");
        setPhase("done");
      }
    } catch {
      setError("No se pudo conectar. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const card = "w-full max-w-md rounded-2xl border border-[var(--os-border,#2a3a44)] bg-[var(--os-surface,#10202a)] p-6 text-[var(--os-text,#e8f1f4)] shadow-2xl";
  const field = "min-h-12 w-full rounded-lg border border-[var(--os-border,#2a3a44)] bg-transparent px-3 py-2 text-base";

  if (phase === "checking") return <div className={card} data-testid="activar-checking">Verificando enlace…</div>;
  if (phase === "invalid")
    return (
      <div className={card} data-testid="activar-invalid" role="alert">
        <h1 className="text-xl font-semibold">Enlace no válido</h1>
        <p className="mt-2 text-sm">Este enlace venció, ya se usó o no es correcto. Pedile al administrador general que genere uno nuevo desde «Administración de usuarios».</p>
      </div>
    );
  if (phase === "done")
    return (
      <div className={card} data-testid="activar-done">
        <h1 className="text-xl font-semibold">Cuenta activada</h1>
        <p className="mt-2 text-sm">Ya podés iniciar sesión con <strong>{email}</strong> y la contraseña que elegiste.</p>
        <a href="/login" className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-[var(--os-teal,#14b8a6)] px-5 font-semibold text-white" data-testid="activar-login">Ir a iniciar sesión</a>
      </div>
    );
  return (
    <form className={card} onSubmit={submit} data-testid="activar-form" autoComplete="off">
      <h1 className="text-xl font-semibold">Activar cuenta de Administración</h1>
      <p className="mt-1 text-sm">Cuenta: <strong data-testid="activar-email">{email}</strong> · sector Administración / Facturación. Este enlace sirve una sola vez.</p>
      <label className="mt-4 block text-sm">Nueva contraseña
        <input className={field} type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-testid="activar-pw" />
      </label>
      <label className="mt-3 block text-sm">Repetir contraseña
        <input className={field} type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" data-testid="activar-pw2" />
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar contraseña</label>
      <p className="mt-2 text-xs text-[var(--os-text-muted,#9fb3bd)]">Mínimo {PASSWORD_MIN_LENGTH} caracteres, con al menos tres tipos (minúsculas, MAYÚSCULAS, números, símbolos). Sin «admin123» ni datos de la empresa.</p>
      {weak ? <p className="mt-1 text-xs text-amber-400" data-testid="activar-weak">{weak}</p> : null}
      {mismatch ? <p className="mt-1 text-xs text-amber-400">Las contraseñas no coinciden.</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-sm" data-testid="activar-error">{error}</p> : null}
      <button type="submit" disabled={busy} className="mt-4 min-h-12 w-full rounded-lg bg-[var(--os-teal,#14b8a6)] px-5 font-semibold text-white disabled:opacity-50" data-testid="activar-submit">{busy ? "Activando…" : "Activar cuenta"}</button>
    </form>
  );
}
