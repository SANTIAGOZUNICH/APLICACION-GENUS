/** Detección de plataforma para el Portal PWA (funciones puras, probadas sin navegador). */

export type PlatformInfo = { ios: boolean; android: boolean; standalone: boolean; iosVersion: number | null; iosSafariTab: boolean };

export function detectPlatform(input: { userAgent: string; maxTouchPoints?: number; standaloneDisplay?: boolean; navigatorStandalone?: boolean }): PlatformInfo {
  const ua = input.userAgent || "";
  const iPadOs = /Macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadOs;
  const android = /Android/i.test(ua);
  const standalone = input.standaloneDisplay === true || input.navigatorStandalone === true;
  const m = /OS (\d+)[_.](\d+)/.exec(ua);
  const iosVersion = ios && m ? Number(m[1]) + Number(m[2]) / 100 : null;
  return { ios, android, standalone, iosVersion, iosSafariTab: ios && !standalone };
}

export function currentPlatform(): PlatformInfo {
  if (typeof window === "undefined") return { ios: false, android: false, standalone: false, iosVersion: null, iosSafariTab: false };
  return detectPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standaloneDisplay: window.matchMedia?.("(display-mode: standalone)").matches,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  });
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** applicationServerKey (base64url) → bytes. */
export function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
