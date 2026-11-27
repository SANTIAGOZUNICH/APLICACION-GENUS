"use client";

import { useState, useSyncExternalStore } from "react";
import { PUSH_STATE_LABEL } from "./push-state";
import type { PlatformInfo } from "./pwa-env";
import { portalPwaStore } from "./pwa-store";
import type { PushController } from "./use-push-state";

/** Instrucciones de instalación por plataforma (la instalación en iPhone es manual: Safari no ofrece «Instalar»). */
export function InstallInstructions({ platform }: { platform: PlatformInfo }) {
  return (
    <div className="gp-install-help" data-testid="install-help">
      {platform.ios ? (
        <div data-testid="install-ios">
          <b>En iPhone o iPad (Safari)</b>
          <ol>
            <li>Abrí este portal en <b>Safari</b>.</li>
            <li>Tocá el botón <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
            <li>Elegí <b>Agregar a pantalla de inicio</b> y confirmá.</li>
            <li>Abrí el portal desde el ícono nuevo: <b>las notificaciones solo funcionan desde la app instalada</b> (requiere iOS 16.4 o superior).</li>
          </ol>
        </div>
      ) : null}
      {platform.android || !platform.ios ? (
        <div data-testid="install-android">
          <b>En Android (Chrome)</b>
          <ol>
            <li>Tocá el botón <b>Instalar app</b> de arriba o, en el menú ⋮ de Chrome, <b>Instalar aplicación</b> / <b>Agregar a la pantalla principal</b>.</li>
            <li>Confirmá y abrí el portal desde el ícono nuevo.</li>
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Instalar la app + estado permanente de las notificaciones en ESTE dispositivo (activar / desactivar / reintentar). */
export function AppPanel({ push }: { push: PushController }) {
  const installEvent = useSyncExternalStore(portalPwaStore.subscribe, portalPwaStore.getInstallEvent, () => null);
  const [showHelp, setShowHelp] = useState(false);
  const { platform, cfg, state, busy, message } = push;

  async function install() {
    const ev = portalPwaStore.getInstallEvent();
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
    portalPwaStore.setInstallEvent(null);
  }

  if (!platform) return null;
  const standalone = platform.standalone;
  const on = state === "activadas";
  const canToggle = on || state === "desactivadas" || state === "error";
  const devices = cfg?.devices ?? 0;

  return (
    <section className="gp-card gp-app-panel" aria-labelledby="gp-app" data-testid="app-panel">
      <h2 id="gp-app" style={{ fontSize: 18, marginBottom: 6 }}>Portal en tu celular</h2>
      <p className="gp-meta" style={{ marginTop: 0 }}>Instalalo como app y activá los avisos para enterarte al instante de cada avance de tu pedido.</p>

      <div className="gp-app-actions">
        {standalone ? (
          <span className="gp-note" data-testid="installed-note">App instalada en este dispositivo.</span>
        ) : installEvent ? (
          <button type="button" className="gp-btn gp-btn-primary gp-btn-sm" onClick={() => void install()} data-testid="install-btn">Instalar app</button>
        ) : null}
        {!standalone ? (
          <button type="button" className="gp-link-btn" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp} data-testid="install-help-toggle">
            {showHelp ? "Ocultar instrucciones" : "Cómo instalarla"}
          </button>
        ) : null}
      </div>
      {(showHelp || state === "instalacion") && !standalone ? <InstallInstructions platform={platform} /> : null}

      <div className="gp-push" data-testid="push-box">
        <b>Notificaciones de pedidos</b>
        <p className="gp-note" data-testid="push-state" data-state={state} role="status">
          {PUSH_STATE_LABEL[state]}
          {state === "activadas" && devices > 0 ? ` · ${devices} ${devices === 1 ? "dispositivo" : "dispositivos"} en tu cuenta` : ""}
        </p>
        {state === "instalacion" ? <p className="gp-note" data-testid="push-msg">En iPhone las notificaciones solo funcionan desde la app instalada (iOS 16.4 o superior): agregala a la pantalla de inicio y abrila desde ahí.</p> : null}
        {state === "no_compatible" ? <p className="gp-note" data-testid="push-msg">Este dispositivo o navegador no admite notificaciones. En iPhone se necesita iOS 16.4 o superior.</p> : null}
        {state === "bloqueado" ? <p className="gp-note" data-testid="push-msg">Bloqueaste las notificaciones de este sitio. Para activarlas, habilitalas desde los ajustes del navegador o del teléfono y volvé a abrir el portal.</p> : null}
        {state === "no_disponible" ? <p className="gp-note" data-testid="push-msg">Las notificaciones no están disponibles por el momento.</p> : null}
        {canToggle ? (
          <div className="gp-app-actions">
            <button type="button" className={`gp-btn ${on ? "gp-btn-ghost" : "gp-btn-primary"} gp-btn-sm`} disabled={busy} onClick={() => void (on ? push.disable() : push.enable())} data-testid="push-toggle" data-state={on ? "on" : "off"}>
              {on ? "Desactivar notificaciones" : state === "error" ? "Reintentar" : "Activar notificaciones"}
            </button>
          </div>
        ) : null}
        {message ? <p className="gp-note" role="status" data-testid="push-feedback">{message}</p> : null}
      </div>
    </section>
  );
}
