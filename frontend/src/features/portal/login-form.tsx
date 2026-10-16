"use client";

import { useState, type FormEvent } from "react";
import { PortalHeader } from "./shell";

type Step = "datos" | "codigo";

async function post(path: string, body: unknown) {
  const res = await fetch(`/entregas/api/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
  return { status: res.status, ok: res.ok && json.ok !== false, json };
}

export function LoginForm({ initialCode = "" }: { initialCode?: string }) {
  const [step, setStep] = useState<Step>("datos");
  const [code, setCode] = useState(initialCode);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await post("auth/request", { code, email });
      if (r.ok) {
        setStep("codigo");
        setMsg({ kind: "ok", text: r.json.message ?? "Te enviamos un código si los datos son correctos." });
      } else setMsg({ kind: "err", text: r.json.error ?? "No pudimos procesar la solicitud." });
    } catch {
      setMsg({ kind: "err", text: "No hay conexión. Revisá tu internet y probá de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await post("auth/verify", { code, email, otp });
      if (r.ok) {
        window.location.assign("/entregas");
        return;
      }
      setMsg({ kind: "err", text: r.json.error ?? "El código no es correcto." });
    } catch {
      setMsg({ kind: "err", text: "No hay conexión. Revisá tu internet y probá de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PortalHeader />
      <main className="gp-login">
        <div className="gp-login-card">
          <h1>Ingresá a tu portal</h1>
          <p className="gp-meta">Seguí el avance de tu producción en tiempo real. Necesitás tu código de cliente y el correo que registramos para vos.</p>
          {step === "datos" ? (
            <form onSubmit={requestCode} noValidate>
              <div className="gp-field">
                <label htmlFor="gp-code">Código de cliente</label>
                <input id="gp-code" name="code" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="GEN-XXXXXX" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <div className="gp-field">
                <label htmlFor="gp-email">Correo autorizado</label>
                <input id="gp-email" name="email" type="email" autoComplete="email" placeholder="nombre@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <small>El código de cliente solo no alcanza para ingresar.</small>
              </div>
              <button className="gp-btn gp-btn-primary" type="submit" disabled={busy || !code.trim() || !email.trim()}>{busy ? "Enviando…" : "Enviarme un código"}</button>
            </form>
          ) : (
            <form onSubmit={verify} noValidate>
              <div className="gp-field">
                <label htmlFor="gp-otp">Código recibido por correo</label>
                <input id="gp-otp" name="otp" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={12} value={otp} onChange={(e) => setOtp(e.target.value)} required />
                <small>Vence a los 10 minutos y sirve una sola vez.</small>
              </div>
              <button className="gp-btn gp-btn-primary" type="submit" disabled={busy || otp.trim().length < 4}>{busy ? "Verificando…" : "Ingresar"}</button>
              <p className="gp-meta" style={{ marginTop: 14 }}>
                ¿No te llegó? <button type="button" className="gp-link-btn" onClick={() => void requestCode()} disabled={busy}>Pedir otro código</button> · <button type="button" className="gp-link-btn" onClick={() => { setStep("datos"); setMsg(null); setOtp(""); }}>Cambiar datos</button>
              </p>
            </form>
          )}
          {msg ? <div className={`gp-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"} data-testid="login-msg">{msg.text}</div> : null}
        </div>
      </main>
    </>
  );
}
