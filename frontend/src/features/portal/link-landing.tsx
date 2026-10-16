"use client";

import { useState } from "react";
import { PortalHeader } from "./shell";

/** Aterrizaje del enlace seguro: el token se canjea con un POST explícito (un GET de antivirus no lo consume). */
export function LinkLanding({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  async function go() {
    setState("busy");
    try {
      const res = await fetch("/entregas/api/auth/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin" });
      if (res.ok) {
        window.location.assign("/entregas");
        return;
      }
    } catch {
      /* cae al error */
    }
    setState("error");
  }
  return (
    <>
      <PortalHeader />
      <main className="gp-login">
        <div className="gp-login-card">
          <h1>Ingresar al portal</h1>
          <p className="gp-meta">Tocá el botón para entrar con tu enlace seguro. Sirve una sola vez.</p>
          {state === "error" ? <div className="gp-msg err" role="alert" data-testid="link-error">El enlace venció o ya fue usado. <a href="/entregas">Pedí un código nuevo</a>.</div> : null}
          <button className="gp-btn gp-btn-primary" onClick={go} disabled={state === "busy" || !token}>{state === "busy" ? "Ingresando…" : "Ingresar al portal"}</button>
        </div>
      </main>
    </>
  );
}
