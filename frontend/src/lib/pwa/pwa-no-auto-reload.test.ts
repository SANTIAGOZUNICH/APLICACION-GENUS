import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA interna: sin recarga automática", () => {
  const src = readFileSync(resolve(process.cwd(), "src/features/os/pwa/pwa-service-worker-registration.tsx"), "utf8");
  it("no recarga la página en el statechange del SW sin acción del usuario", () => {
    const m = src.match(/const trackWaiting[\s\S]*?\n        \};/);
    expect(m?.[0]).toBeTruthy();
    expect(m![0]).not.toMatch(/location\.reload/);
    expect(m![0]).not.toMatch(/statechange/);
  });
  it("el panel de usuarios del portal registra una operación bloqueante con datos sin enviar", () => {
    const panel = readFileSync(resolve(process.cwd(), "src/features/os/operational/views/portal-usuarios-panel.tsx"), "utf8");
    expect(panel).toMatch(/beginOperationGuard\("form-dirty"/);
    expect(panel).toMatch(/endOperationGuard/);
  });
});
