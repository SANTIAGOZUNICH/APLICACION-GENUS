/** Detección de plataforma para instalación PWA (sin ocultar el botón). */

export type InstallPlatformKind =
  | "standalone"
  | "ios-safari"
  | "ios-other"
  | "mac-safari"
  | "chromium"
  | "other";

export function isStandaloneDisplay(
  win: Pick<Window, "matchMedia"> | undefined,
  nav: Navigator | undefined,
): boolean {
  if (!win || !nav) return false;
  const mq = win.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    "standalone" in nav && Boolean((nav as Navigator & { standalone?: boolean }).standalone);
  return mq || iosStandalone;
}

export function detectInstallPlatform(
  win: Pick<Window, "matchMedia"> | undefined,
  nav: Navigator | undefined,
): InstallPlatformKind {
  if (!nav) return "other";
  if (isStandaloneDisplay(win, nav)) return "standalone";

  const ua = nav.userAgent || "";
  const platform = nav.platform || "";
  const isIos =
    /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && nav.maxTouchPoints > 1);
  const isSafariUa =
    /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/i.test(ua);
  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);

  if (isIos) return isSafariUa ? "ios-safari" : "ios-other";
  if (isMac && isSafariUa) return "mac-safari";
  if (/Chrome|Chromium|Edg|CriOS|EdgiOS|Android/i.test(ua)) return "chromium";
  return "other";
}

export const INSTALL_LABEL = "Instalar Genus OS";
export const INSTALLED_LABEL = "Genus OS ya está instalada";

export type InstallUiStatus =
  | "preparing"
  | "install"
  | "prompting"
  | "started"
  | "cancelled"
  | "installed"
  | "unsupported";

export function statusMessageForInstall(status: InstallUiStatus): string | null {
  switch (status) {
    case "preparing":
      return "Preparando instalador…";
    case "prompting":
      return "Instalación iniciada — confirmá en el diálogo del navegador.";
    case "started":
      return "Instalación iniciada.";
    case "cancelled":
      return "Instalación cancelada.";
    case "installed":
      return INSTALLED_LABEL;
    case "unsupported":
      return "Este navegador no ofrece instalación automática. Usá Chrome/Edge o seguí la guía.";
    case "install":
    default:
      return null;
  }
}
