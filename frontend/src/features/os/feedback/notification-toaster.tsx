"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Volume2, VolumeX, X } from "lucide-react";
import { usePreviewContext, usePreviewSession } from "@/features/os/session/preview-context";
import { fetchOsNotifications, patchOsNotificationApi } from "@/lib/orders/orders-client";
import { compactOperationalIdsInText } from "@/lib/orders/format-operational-id";
import { workItemIdFromNotificationHref } from "./notification-bell";
import { parseShownIds, pickToastsToShow, serializeShownIds, TOAST_MAX_VISIBLE } from "./notification-toaster-logic";

type Toast = { id: string; kind: string; title: string; message: string; href: string | null; createdAt: string };

const POLL_MS = 20_000;
const AUTO_HIDE_MS = 20_000;

const store = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* sin almacenamiento: se muestra igual */ }
  },
};

/** Sonido breve (dos notas) generado con WebAudio: no requiere archivos. Devuelve false si el navegador lo bloquea. */
async function playChime(ctx: AudioContext): Promise<boolean> {
  try {
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return false;
    const t0 = ctx.currentTime;
    [[880, 0], [1320, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq!;
      gain.gain.setValueAtTime(0.0001, t0 + at!);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at! + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at! + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at!);
      osc.stop(t0 + at! + 0.32);
    });
    return true;
  } catch {
    return false;
  }
}

const KIND_LABEL: Record<string, string> = {
  aviso_interno: "NUEVO AVISO",
  listo_para_entregar: "LISTO PARA ENTREGAR",
  entrega_registrada: "ENTREGA REGISTRADA — YA SE PUEDE FACTURAR",
};

/**
 * Tarjetas flotantes + sonido para notificaciones nuevas (misma fuente persistente que la campana: os_notifications).
 * No bloquea la pantalla; cada tarjeta se muestra una sola vez por usuario/dispositivo; el sonido es configurable por usuario.
 */
export function NotificationToaster() {
  const { email, sectorId } = usePreviewSession();
  const { openWorkItem, navigateTo } = usePreviewContext();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundOn, setSoundOn] = useState(true);
  const [needsGesture, setNeedsGesture] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const shownRef = useRef<Set<string>>(new Set());
  const soundKey = `genus_notif_sound:${email}`;
  const shownKey = `genus_notif_toasted:${email}`;

  useEffect(() => {
    if (!email) return;
    setSoundOn(store.get(soundKey) !== "off");
    shownRef.current = parseShownIds(store.get(shownKey));
  }, [email, soundKey, shownKey]);

  const getCtx = useCallback(() => {
    if (!ctxRef.current && typeof window !== "undefined") {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctxRef.current = new AC();
    }
    return ctxRef.current;
  }, []);

  const ring = useCallback(async () => {
    if (store.get(soundKey) === "off") return;
    const ctx = getCtx();
    if (!ctx) return;
    const ok = await playChime(ctx);
    setNeedsGesture(!ok);
  }, [getCtx, soundKey]);

  const poll = useCallback(async () => {
    if (!email) return;
    try {
      const list = await fetchOsNotifications({ email, sector: sectorId }, { allForSector: true });
      const mapped = list
        .filter((n) => !n.dismissedBy.includes(email))
        .map((n) => ({ ...n, read: n.readBy.includes(email) }));
      const fresh = pickToastsToShow(mapped, shownRef.current);
      if (fresh.length === 0) return;
      fresh.forEach((n) => shownRef.current.add(n.id));
      store.set(shownKey, serializeShownIds(shownRef.current));
      setToasts((prev) => [...fresh.map((n) => ({ id: n.id, kind: n.kind, title: n.title, message: n.message, href: n.href, createdAt: n.createdAt })), ...prev].slice(0, TOAST_MAX_VISIBLE));
      void ring(); // un solo sonido por tanda, aunque lleguen varias
    } catch {
      /* sin red: se reintenta en el próximo ciclo */
    }
  }, [email, sectorId, shownKey, ring]);

  useEffect(() => {
    if (!email) return;
    void poll();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [email, poll]);

  // Los navegadores exigen un gesto del usuario para audio: lo desbloqueamos con el primer toque/clic.
  useEffect(() => {
    const unlock = () => {
      const ctx = getCtx();
      if (ctx && ctx.state === "suspended") void ctx.resume().then(() => setNeedsGesture(false)).catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [getCtx]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => setToasts((prev) => prev.slice(0, -1)), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [toasts]);

  function close(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }
  async function open(t: Toast) {
    close(t.id);
    if (email) void patchOsNotificationApi({ email, sector: sectorId }, t.id, "read").catch(() => undefined);
    const workItemId = workItemIdFromNotificationHref(t.href);
    if (workItemId) openWorkItem(workItemId);
    else if (t.href?.startsWith("/avisos")) navigateTo({ view: "avisos" });
  }
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    store.set(soundKey, next ? "on" : "off");
    if (next) void ring();
  }

  if (!email) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" data-testid="notif-toaster" aria-live="polite">
      {needsGesture && soundOn ? (
        <button type="button" className="pointer-events-auto min-h-11 rounded-lg border border-[var(--os-teal)] bg-[var(--os-surface)] px-3 py-2 text-left text-sm text-[var(--os-text)] shadow-lg" onClick={() => void ring()} data-testid="notif-enable-sound">
          <Volume2 className="mr-1 inline size-4" aria-hidden="true" /> Activar sonido de avisos
        </button>
      ) : null}
      {toasts.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto rounded-lg border border-[var(--os-teal)]/60 bg-[var(--os-surface)] p-3 text-[var(--os-text)] shadow-2xl" data-testid="notif-toast" data-kind={t.kind}>
          <div className="flex items-start gap-2">
            <Bell className="mt-0.5 size-4 shrink-0 text-[var(--os-teal)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--os-teal)]">{KIND_LABEL[t.kind] ?? "NOTIFICACIÓN"}</p>
              <p className="mt-0.5 break-words text-sm font-medium">{compactOperationalIdsInText(t.title)}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[var(--os-text-muted)]">{compactOperationalIdsInText(t.message)}</p>
              <p className="mt-1 text-[10px] text-[var(--os-text-muted)]">{new Date(t.createdAt).toLocaleString("es-AR")}</p>
            </div>
            <button type="button" aria-label="Cerrar" className="flex size-9 items-center justify-center rounded hover:bg-white/10" onClick={() => close(t.id)} data-testid="notif-toast-close"><X className="size-4" aria-hidden="true" /></button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" className="min-h-10 rounded border border-[var(--os-teal)] px-3 text-xs text-[var(--os-teal)]" onClick={() => void open(t)} data-testid="notif-toast-open">Abrir</button>
            <button type="button" className="flex min-h-10 items-center gap-1 rounded px-2 text-xs text-[var(--os-text-muted)] hover:bg-white/10" onClick={toggleSound} data-testid="notif-sound-toggle">
              {soundOn ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
              {soundOn ? "Sonido activado" : "Sonido silenciado"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
