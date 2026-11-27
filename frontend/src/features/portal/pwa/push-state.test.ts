import { describe, expect, it } from "vitest";
import { derivePushState, shouldOfferPrompt } from "./push-state";
import { detectPlatform } from "./pwa-env";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const OLD_IPHONE = IPHONE.replace("17_2", "15_4");
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const ok = { available: true, thisDevice: false };
const base = { supported: true, permission: "default" as const, cfg: ok, failed: false };

describe("derivePushState", () => {
  it("iPhone en Safari sin instalar → instalación requerida (y se ofrece el aviso con instrucciones)", () => {
    const s = derivePushState({ ...base, platform: detectPlatform({ userAgent: IPHONE }), supported: false, permission: "unsupported" });
    expect(s).toBe("instalacion");
    expect(shouldOfferPrompt(s, false)).toBe(true);
  });
  it("iOS viejo → dispositivo no compatible", () => expect(derivePushState({ ...base, platform: detectPlatform({ userAgent: OLD_IPHONE }), supported: false, permission: "unsupported" })).toBe("no_compatible"));
  it("iPhone con la app instalada: se puede activar", () => expect(derivePushState({ ...base, platform: detectPlatform({ userAgent: IPHONE, navigatorStandalone: true }) })).toBe("desactivadas"));
  it("Android: desactivadas → activadas solo con permiso concedido Y dispositivo registrado en el servidor", () => {
    const p = detectPlatform({ userAgent: ANDROID });
    expect(derivePushState({ ...base, platform: p })).toBe("desactivadas");
    expect(derivePushState({ ...base, platform: p, permission: "granted", cfg: { available: true, thisDevice: false } })).toBe("desactivadas");
    expect(derivePushState({ ...base, platform: p, permission: "granted", cfg: { available: true, thisDevice: true } })).toBe("activadas");
  });
  it("permiso denegado → bloqueado (no se vuelve a ofrecer)", () => {
    const s = derivePushState({ ...base, platform: detectPlatform({ userAgent: ANDROID }), permission: "denied" });
    expect(s).toBe("bloqueado");
    expect(shouldOfferPrompt(s, false)).toBe(false);
  });
  it("fallo de suscripción → error; sin soporte → no compatible; servidor sin VAPID → no disponible", () => {
    const p = detectPlatform({ userAgent: ANDROID });
    expect(derivePushState({ ...base, platform: p, failed: true })).toBe("error");
    expect(derivePushState({ ...base, platform: p, supported: false, permission: "unsupported" })).toBe("no_compatible");
    expect(derivePushState({ ...base, platform: p, cfg: { available: false, thisDevice: false } })).toBe("no_disponible");
  });
  it("«Ahora no» recuerda la decisión", () => expect(shouldOfferPrompt("desactivadas", true)).toBe(false));
});
