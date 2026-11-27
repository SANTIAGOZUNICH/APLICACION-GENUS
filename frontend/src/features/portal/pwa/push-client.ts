/** Cliente de notificaciones del portal: permiso solo tras un gesto del usuario, suscripción y baja. */
import { pushSupported, urlBase64ToUint8Array } from "./pwa-env";

export type PushConfig = { available: boolean; reason: "ok" | "vapid" | "demo"; publicKey: string | null; devices: number; thisDevice: boolean; needsResubscribe?: boolean; pilotEnabled?: boolean };

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

/** La suscripción del navegador se creó con la MISMA clave VAPID pública que usa el servidor hoy (si no, el servicio push la rechaza siempre). */
export function subscriptionMatchesKey(sub: PushSubscription, publicKey: string): boolean {
  const k = sub.options?.applicationServerKey;
  if (!k) return true; // el navegador no lo informa: el servidor lo detecta igual (401/403) y pide reactivar
  const a = new Uint8Array(k as ArrayBuffer);
  const b = urlBase64ToUint8Array(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Suscripción vigente con la clave actual: si había una creada con otra clave, se da de baja y se crea una nueva. */
async function ensureSubscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const existing = await reg.pushManager.getSubscription();
  if (existing && subscriptionMatchesKey(existing, publicKey)) return existing;
  if (existing) {
    await post("unsubscribe", { endpoint: existing.endpoint }).catch(() => undefined);
    await existing.unsubscribe().catch(() => undefined);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
}

/** Registra la suscripción en el servidor (con la clave usada, para detectar claves viejas). */
async function registerSubscription(sub: PushSubscription, publicKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await post("subscribe", { subscription: sub.toJSON(), applicationServerKey: publicKey });
  const j = (await res.json().catch(() => ({}))) as { error?: string; registered?: boolean };
  return res.ok && j.registered === true ? { ok: true } : { ok: false, error: j.error };
}

/** Debe llamarse DENTRO de un gesto del usuario (click): pide el permiso del navegador y registra el dispositivo. */
export async function enablePush(publicKey: string): Promise<{ ok: true } | { ok: false; reason: "denied" | "unsupported" | "error"; message: string }> {
  if (!pushSupported()) return { ok: false, reason: "unsupported", message: "Este navegador no admite notificaciones." };
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied", message: "No diste permiso para notificaciones. Podés habilitarlo desde los ajustes del navegador." };
    const reg = (await navigator.serviceWorker.getRegistration("/entregas")) ?? (await navigator.serviceWorker.ready);
    const sub = await ensureSubscription(reg, publicKey);
    const saved = await registerSubscription(sub, publicKey);
    if (!saved.ok) {
      await sub.unsubscribe().catch(() => undefined);
      return { ok: false, reason: "error", message: saved.error ?? "No pudimos activar las notificaciones." };
    }
    // Segunda comprobación independiente: el servidor tiene que listar ESTE dispositivo. Si no, no se muestra «activadas».
    const cfg = await fetchPushConfig();
    if (!cfg?.thisDevice) return { ok: false, reason: "error", message: "No pudimos confirmar el registro de este dispositivo. Reintentá." };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error", message: "No pudimos activar las notificaciones en este dispositivo." };
  }
}

/**
 * Reparación SILENCIOSA (sin gesto: el permiso ya está concedido): si el navegador tiene una suscripción pero el servidor no la tiene como
 * válida (la dio de baja, la rechazó el servicio push o se creó con una clave anterior), se vuelve a registrar con la clave vigente.
 */
export async function repairSubscription(cfg: PushConfig): Promise<boolean> {
  if (!pushSupported() || !cfg.available || !cfg.publicKey || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/entregas");
    if (!reg) return false;
    const current = await reg.pushManager.getSubscription();
    if (!current) return false; // nunca activó en este dispositivo: se ofrece con el aviso normal (requiere gesto)
    const needs = !cfg.thisDevice || cfg.needsResubscribe || !subscriptionMatchesKey(current, cfg.publicKey);
    if (!needs) return false;
    const sub = await ensureSubscription(reg, cfg.publicKey);
    return (await registerSubscription(sub, cfg.publicKey)).ok;
  } catch {
    return false;
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
