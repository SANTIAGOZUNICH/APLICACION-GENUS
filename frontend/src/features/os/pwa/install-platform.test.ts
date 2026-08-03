import { describe, expect, it } from "vitest";
import {
  INSTALL_LABEL,
  INSTALLED_LABEL,
  detectInstallPlatform,
  isStandaloneDisplay,
} from "./install-platform";

function mockWin(standalone: boolean): Pick<Window, "matchMedia"> {
  return {
    matchMedia: (query: string) =>
      ({
        matches: query.includes("standalone") ? standalone : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  };
}

function mockNav(partial: Partial<Navigator> & { userAgent: string; platform?: string; standalone?: boolean }) {
  return {
    maxTouchPoints: partial.maxTouchPoints ?? 0,
    platform: partial.platform ?? "Win32",
    userAgent: partial.userAgent,
    ...(partial.standalone !== undefined ? { standalone: partial.standalone } : {}),
  } as Navigator;
}

describe("install-platform", () => {
  it("exposes stable install labels", () => {
    expect(INSTALL_LABEL).toBe("Instalar Genus OS");
    expect(INSTALLED_LABEL).toBe("Genus OS ya está instalada");
  });

  it("maps install UI status messages", async () => {
    const { statusMessageForInstall } = await import("./install-platform");
    expect(statusMessageForInstall("cancelled")).toMatch(/cancelada/i);
    expect(statusMessageForInstall("installed")).toBe("Genus OS ya está instalada");
    expect(statusMessageForInstall("unsupported")).toMatch(/no ofrece instalación automática/i);
  });

  it("detects standalone display-mode", () => {
    expect(isStandaloneDisplay(mockWin(true), mockNav({ userAgent: "Chrome" }))).toBe(true);
    expect(detectInstallPlatform(mockWin(true), mockNav({ userAgent: "Chrome" }))).toBe("standalone");
  });

  it("detects iOS Safari vs other browsers", () => {
    const safari = mockNav({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
    });
    const chromeIos = mockNav({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
    });
    expect(detectInstallPlatform(mockWin(false), safari)).toBe("ios-safari");
    expect(detectInstallPlatform(mockWin(false), chromeIos)).toBe("ios-other");
  });

  it("detects chromium desktop without requiring beforeinstallprompt", () => {
    const chrome = mockNav({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    expect(detectInstallPlatform(mockWin(false), chrome)).toBe("chromium");
  });

  it("detects Mac Safari dock install path", () => {
    const safari = mockNav({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      platform: "MacIntel",
    });
    expect(detectInstallPlatform(mockWin(false), safari)).toBe("mac-safari");
  });
});
