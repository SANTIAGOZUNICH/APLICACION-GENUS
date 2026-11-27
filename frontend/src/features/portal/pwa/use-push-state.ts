"use client";

import { useCallback, useEffect, useState } from "react";
import { disablePush, enablePush, fetchPushConfig, repairSubscription, type PushConfig } from "./push-client";
import { derivePushState, type PushUiState } from "./push-state";
import { currentPlatform, pushSupported, type PlatformInfo } from "./pwa-env";

/** Estado de las notificaciones de ESTE dispositivo + acciones. El permiso del navegador solo se pide dentro de `enable()` (gesto del usuario). */
export function usePushState() {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [cfg, setCfg] = useState<PushConfig | null | undefined>(undefined);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    let c = await fetchPushConfig();
    // Dispositivo con permiso y suscripción en el navegador pero sin registro válido en el servidor: se repara solo (sin molestar al cliente).
    if (c && (await repairSubscription(c))) c = await fetchPushConfig();
    setCfg(c);
  }, []);
  useEffect(() => {
    // Datos del navegador y del servidor: se resuelven después del montaje.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(currentPlatform());
    void reload();
    const onVis = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reload]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!cfg?.publicKey) return false;
    setBusy(true);
    setMessage(null);
    try {
      const r = await enablePush(cfg.publicKey);
      setFailed(!r.ok && r.reason === "error");
      setMessage(r.ok ? "Listo: vas a recibir avisos de tus pedidos en este dispositivo." : r.message);
      await reload();
      return r.ok;
    } finally {
      setBusy(false);
    }
  }, [cfg, reload]);

  const disable = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      await disablePush();
      setFailed(false);
      setMessage("Notificaciones desactivadas en este dispositivo.");
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const state: PushUiState = derivePushState({ platform, supported: pushSupported(), permission, cfg, failed });
  return { platform, cfg, state, busy, message, enable, disable, reload };
}
export type PushController = ReturnType<typeof usePushState>;
