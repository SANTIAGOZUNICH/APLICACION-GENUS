/** Cliente de notificaciones del portal: permiso solo tras un gesto del usuario, suscripción y baja. */
import { pushSupported, urlBase64ToUint8Array } from "./pwa-env";

export type PushConfig = { available: boolean; reason: "ok" | "vapid" | "demo"; publicKey: string | null; devices: number; thisDevice: boolean; pilotEnabled?: boolean };

const post = (path: string, body: unknown) => fetch(`/entregas/api/push/${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/entregas");
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

export async function fetchPushConfig(): Promise<PushConfig | null> {
  try {
    const endpoint = await currentEndpoint();
    const res = await fetch(`/entregas/api/push/config${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`, { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as PushConfig) : null;
  } catch {
    return null;
  }
}

/** Debe llamarse DENTRO de un gesto del usuario (click): pide el permiso del navegador y registra el dispositivo. */
export async function enablePush(publicKey: string): Promise<{ ok: true } | { ok: false; reason: "denied" | "unsupported" | "error"; message: string }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported", message: "Este navegador no admite notificaciones." };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied", message: "No diste permiso para notificaciones. Podés habilitarlo desde los ajustes del navegador." };
    const reg = (await navigator.serviceWorker.getRegistration("/entregas")) ?? (await navigator.serviceWorker.ready);
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    const res = await post("subscribe", { subscription: sub.toJSON() });
    const j = (await res.json().catch(() => ({}))) as { error?: string; registered?: boolean };
    if (!res.ok || j.registered !== true) {
      await sub.unsubscribe().catch(() => undefined);
      return { ok: false, reason: "error", message: j.error ?? "No pudimos activar las notificaciones." };
    }
    // Segunda comprobación independiente: el servidor tiene que listar ESTE dispositivo. Si no, no se muestra «activadas».
    const cfg = await fetchPushConfig();
    if (!cfg?.thisDevice) return { ok: false, reason: "error", message: "No pudimos confirmar el registro de este dispositivo. Reintentá." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error", message: "No pudimos activar las notificaciones en este dispositivo." };
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/entregas");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await post("unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch {
    /* nada */
  }
}

/** Al cerrar sesión: el dispositivo deja de recibir avisos de ESTE usuario y no queda nada privado en caché. */
export async function cleanupOnLogout(): Promise<void> {
  try {
    await disablePush();
    const reg = await navigator.serviceWorker?.getRegistration("/entregas");
    reg?.active?.postMessage({ type: "CLEAR_CACHES" });
  } catch {
    /* best-effort */
  }
}

export type PushHistoryItem = { id: string; type: string; title: string; body: string; url: string; createdAt: string; read: boolean };

export async function fetchPushHistory(): Promise<{ items: PushHistoryItem[]; unread: number } | null> {
  try {
    const res = await fetch("/entregas/api/push/history", { credentials: "same-origin", cache: "no-store" });
    return res.ok ? ((await res.json()) as { items: PushHistoryItem[]; unread: number }) : null;
  } catch {
    return null;
  }
}

export async function markPushRead(ids: string[] | "all"): Promise<void> {
  await post("read", ids === "all" ? { all: true } : { ids }).catch(() => undefined);
}
