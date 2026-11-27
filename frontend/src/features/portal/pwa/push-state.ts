/** Estado visible de las notificaciones en ESTE dispositivo (puro, probado sin navegador). */
import type { PlatformInfo } from "./pwa-env";

export type PushUiState = "cargando" | "activadas" | "desactivadas" | "bloqueado" | "instalacion" | "no_compatible" | "error" | "no_disponible";

export const PUSH_STATE_LABEL: Record<PushUiState, string> = {
  cargando: "Comprobando notificaciones…",
  activadas: "Notificaciones activadas",
  desactivadas: "Notificaciones desactivadas",
  bloqueado: "Permiso bloqueado",
  instalacion: "Instalación requerida",
  no_compatible: "Dispositivo no compatible",
  error: "Error de suscripción",
  no_disponible: "Notificaciones no disponibles por el momento",
};

export function derivePushState(i: {
  platform: PlatformInfo | null;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  cfg: { available: boolean; thisDevice: boolean } | null | undefined;
  failed: boolean;
}): PushUiState {
  const p = i.platform;
  if (!p) return "cargando";
  // iPhone/iPad: solo funciona desde la app instalada (Safari en pestaña no expone Web Push) y desde iOS 16.4.
  if (p.ios && p.iosVersion != null && p.iosVersion < 16.04) return "no_compatible";
  if (p.iosSafariTab && !i.supported) return "instalacion";
  if (!i.supported) return "no_compatible";
  if (i.cfg === undefined) return "cargando";
  if (i.cfg === null || !i.cfg.available) return "no_disponible";
  if (i.cfg.thisDevice && i.permission === "granted") return "activadas";
  if (i.permission === "denied") return "bloqueado";
  if (i.failed) return "error";
  return "desactivadas";
}

/** ¿Hay que ofrecer el aviso la primera vez? (nunca si ya está activo, bloqueado o no se puede). */
export function shouldOfferPrompt(state: PushUiState, dismissed: boolean): boolean {
  if (dismissed) return false;
  return state === "desactivadas" || state === "instalacion";
}

export const PROMPT_TITLE = "¡Enterate del avance de tus pedidos!";
export const PROMPT_TEXT = "Activá las notificaciones para recibir novedades sobre tus productos, incluso cuando no estés utilizando la aplicación.";
export const dismissKey = (scope: string) => `genus_portal_push_prompt_v1:${scope}`;
