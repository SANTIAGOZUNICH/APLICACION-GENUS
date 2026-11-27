import { describe, expect, it } from "vitest";
import { detectPlatform } from "./pwa-env";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
describe("detectPlatform", () => {
  it("iPhone en Safari (pestaña) → instrucciones de iPhone", () => {
    expect(detectPlatform({ userAgent: IPHONE })).toMatchObject({ ios: true, android: false, standalone: false, iosSafariTab: true, iosVersion: 17.02 });
  });
  it("iPhone con la app instalada", () => expect(detectPlatform({ userAgent: IPHONE, navigatorStandalone: true })).toMatchObject({ ios: true, standalone: true, iosSafariTab: false }));
  it("iPadOS se identifica como Mac con pantalla táctil", () => expect(detectPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }).ios).toBe(true));
  it("Android", () => expect(detectPlatform({ userAgent: ANDROID, standaloneDisplay: false })).toMatchObject({ android: true, ios: false }));
  it("escritorio no es iOS", () => expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120", maxTouchPoints: 0 }).ios).toBe(false));
});
