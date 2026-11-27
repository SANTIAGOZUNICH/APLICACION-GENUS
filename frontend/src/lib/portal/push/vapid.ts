/**
 * Configuración VAPID (solo variables de entorno; nunca en el repo):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: o https:)
 * Generar el par con:  npx web-push generate-vapid-keys
 * Sin configuración completa, todo degrada: la UI muestra «notificaciones no disponibles» y el worker no envía ni falla.
 */
import "server-only";

import webpush from "web-push";
import type { PushSender } from "./push-send";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/i.test(subject)) return null;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey); // valida formato de las claves
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export const vapidPublicKey = (): string | null => vapidConfig()?.publicKey ?? null;

/** Sender real (web-push). Solo se usa con el envío REAL encendido. */
export function createWebPushSender(cfg: VapidConfig): PushSender {
  const details = { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey };
  return async (sub, payload) => {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
      vapidDetails: details,
      TTL: 24 * 3600,
      urgency: "normal",
      timeout: 10_000,
    });
  };
}
