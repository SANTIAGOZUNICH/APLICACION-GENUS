"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { disablePush, enablePush, fetchPushConfig, type PushConfig } from "./push-client";
import { currentPlatform, pushSupported, type PlatformInfo } from "./pwa-env";
import { portalPwaStore } from "./pwa-store";

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

const PUSH_MESSAGES: Record<string, string> = {
  vapid: "Las notificaciones no están disponibles por el momento.",
  pilot: "Las notificaciones todavía no están habilitadas para tu cuenta.",
  demo: "Las notificaciones no están disponibles en la demostración.",
};

/** Instalar la app + activar/desactivar avisos en ESTE dispositivo. El permiso del navegador solo se pide al tocar el botón. */
export function AppPanel() {
  const installEvent = useSyncExternalStore(portalPwaStore.subscribe, portalPwaStore.getInstallEvent, () => null);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [cfg, setCfg] = useState<PushConfig | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const reload = useCallback(async () => setCfg(await fetchPushConfig()), []);
  useEffect(() => {
    // Datos del navegador y del servidor: se resuelven después del montaje.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(currentPlatform());
    void reload();
  }, [reload]);

  async function install() {
    const ev = portalPwaStore.getInstallEvent();
    if (!ev) return;
    await ev.prompt();
    await ev.userChoice.catch(() => undefined);
    portalPwaStore.setInstallEvent(null);
  }
  async function toggle() {
    if (!cfg) return;
    setBusy(true);
    setMsg(null);
    try {
      if (cfg.thisDevice) {
        await disablePush();
        setMsg("Notificaciones desactivadas en este dispositivo.");
      } else if (cfg.publicKey) {
        const r = await enablePush(cfg.publicKey);
        setMsg(r.ok ? "Listo: vas a recibir avisos de tus pedidos en este dispositivo." : r.message);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (!platform) return null;
  const standalone = platform.standalone;
  const supported = pushSupported();
  const iosNeedsInstall = platform.iosSafariTab && !supported;
  const iosTooOld = platform.ios && platform.iosVersion != null && platform.iosVersion < 16.04;

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
      {showHelp && !standalone ? <InstallInstructions platform={platform} /> : null}

      <div className="gp-push" data-testid="push-box">
        <b>Notificaciones de pedidos</b>
        {iosTooOld ? (
          <p className="gp-note" data-testid="push-msg">Para recibir notificaciones en iPhone necesitás iOS 16.4 o superior.</p>
        ) : iosNeedsInstall ? (
          <p className="gp-note" data-testid="push-msg">En iPhone las notificaciones solo funcionan desde la app instalada: agregala a la pantalla de inicio y abrila desde ahí.</p>
        ) : cfg === undefined ? (
          <p className="gp-note" data-testid="push-msg" data-loading="1">Comprobando notificaciones…</p>
        ) : !cfg ? (
          <p className="gp-note" data-testid="push-msg">Notificaciones no disponibles por el momento.</p>
        ) : !cfg.available ? (
          <p className="gp-note" data-testid="push-msg">{PUSH_MESSAGES[cfg.reason] ?? "Notificaciones no disponibles."}</p>
        ) : !supported ? (
          <p className="gp-note" data-testid="push-msg">Este navegador no admite notificaciones.</p>
        ) : (
          <div className="gp-app-actions">
            <button type="button" className={`gp-btn ${cfg.thisDevice ? "gp-btn-ghost" : "gp-btn-primary"} gp-btn-sm`} disabled={busy} onClick={() => void toggle()} data-testid="push-toggle" data-state={cfg.thisDevice ? "on" : "off"}>
              {cfg.thisDevice ? "Desactivar notificaciones" : "Activar notificaciones"}
            </button>
            <span className="gp-note" data-testid="push-state">{cfg.thisDevice ? "Activadas en este dispositivo" : "Desactivadas en este dispositivo"}{cfg.devices > 0 ? ` · ${cfg.devices} ${cfg.devices === 1 ? "dispositivo" : "dispositivos"} en tu cuenta` : ""}</span>
          </div>
        )}
        {msg ? <p className="gp-note" role="status" data-testid="push-feedback">{msg}</p> : null}
      </div>
    </section>
  );
}
