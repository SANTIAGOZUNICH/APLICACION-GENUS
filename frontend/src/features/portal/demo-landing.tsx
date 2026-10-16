"use client";

import { useEffect, useRef, useState } from "react";
import { PortalHeader } from "./shell";

/**
 * Entrada al modo demostración. El token de un solo uso viaja en el FRAGMENTO de la URL (nunca llega al servidor ni a los
 * registros); se saca de la barra de direcciones apenas se lee y se canjea con un POST.
 */
export function DemoLanding() {
  const [state, setState] = useState<"busy" | "error" | "empty">("busy");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");
    history.replaceState(null, "", window.location.pathname);
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("empty");
      return;
    }
    fetch("/entregas/api/demo/start", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ token }) })
      .then((r) => {
        if (r.ok) window.location.replace("/entregas");
        else setState("error");
      })
      .catch(() => setState("error"));
  }, []);
  return (
    <>
      <PortalHeader />
      <main className="gp-login">
        <div className="gp-login-card" data-testid="demo-landing">
          {state === "busy" ? (
            <>
              <h1>Abriendo el portal de prueba…</h1>
              <p className="gp-meta">Un momento, estamos preparando la demostración.</p>
            </>
          ) : (
            <>
              <h1>No se pudo abrir la demostración</h1>
              <div className="gp-msg err" role="alert" data-testid="demo-error">
                {state === "empty" ? "Este enlace no es válido." : "El enlace de prueba venció o ya fue usado."} Volvé a abrir «Abrir portal de prueba» desde GENUS OS.
              </div>
              <a className="gp-btn gp-btn-ghost" href="/entregas" style={{ marginTop: 16 }}>Ir al ingreso de clientes</a>
            </>
          )}
        </div>
      </main>
    </>
  );
}
