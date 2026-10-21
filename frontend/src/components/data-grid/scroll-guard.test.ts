import { describe, expect, it } from "vitest";
import { ScrollGuard, USER_INTENT_MS } from "./scroll-guard";

function fake() {
  const scrollHandlers: Array<() => void> = [];
  const inputHandlers = new Map<string, Array<(e: Event) => void>>();
  let top = 0;
  let left = 0;
  const el = {
    get scrollTop() { return top; },
    set scrollTop(v: number) { if (v !== top) { top = v; queueMicrotask(() => {}); pendingScroll = true; } },
    get scrollLeft() { return left; },
    set scrollLeft(v: number) { if (v !== left) { left = v; pendingScroll = true; } },
    addEventListener: (_: "scroll", fn: () => void) => { scrollHandlers.push(fn); },
    removeEventListener: () => {},
  };
  let pendingScroll = false;
  const input = {
    addEventListener: (t: string, fn: (e: Event) => void) => { inputHandlers.set(t, [...(inputHandlers.get(t) ?? []), fn]); },
    removeEventListener: () => {},
  };
  /** Simula el evento `scroll` que el navegador dispara después de cambiar la posición. */
  const flush = () => { if (pendingScroll) { pendingScroll = false; for (const h of scrollHandlers) h(); } };
  const user = (type: string, extra: Record<string, unknown> = {}) => { for (const h of inputHandlers.get(type) ?? []) h({ type, ...extra } as unknown as Event); };
  const set = (t: number, l = left) => { top = t; left = l; pendingScroll = true; };
  return { el, input, flush, user, set, get: () => ({ top, left }) };
}

describe("ScrollGuard", () => {
  it("fuera de una actualización de datos no interviene (el scroll programático legítimo pasa)", () => {
    const now = 0;
    const f = fake();
    const g = new ScrollGuard(f.el, f.input, () => now);
    f.set(500); f.flush();
    expect(f.get().top).toBe(500);
    expect(g.position().top).toBe(500);
  });

  it("durante una actualización revierte un salto que no pidió el usuario", () => {
    let now = 0;
    const f = fake();
    const g = new ScrollGuard(f.el, f.input, () => now);
    f.set(12456, 0); f.flush(); // el usuario llegó a la fila 350 (sin bloqueo todavía)
    g.lock(2000);
    now = 100;
    f.set(50724, 363); f.flush(); // el motor arrastra la hoja al final
    f.flush(); // evento de la restauración
    expect(f.get()).toEqual({ top: 12456, left: 0 });
    expect(g.position()).toEqual({ left: 0, top: 12456 });
  });

  it("un gesto real del usuario durante la actualización SÍ mueve la hoja", () => {
    let now = 0;
    const f = fake();
    const g = new ScrollGuard(f.el, f.input, () => now);
    f.set(1000); f.flush();
    g.lock(2000);
    now = 100;
    f.user("wheel");
    f.set(1800); f.flush();
    expect(f.get().top).toBe(1800);
    expect(g.position().top).toBe(1800);
  });

  it("teclas de navegación justifican el movimiento; escribir texto no", () => {
    let now = 0;
    const f = fake();
    const g = new ScrollGuard(f.el, f.input, () => now);
    f.set(1000); f.flush();
    g.lock(5000);
    now = 100;
    f.user("keydown", { key: "a" });
    f.set(9000); f.flush(); f.flush();
    expect(f.get().top).toBe(1000);
    now = 200;
    f.user("keydown", { key: "Enter" });
    f.set(1036); f.flush();
    expect(f.get().top).toBe(1036);
  });

  it("vencida la ventana de bloqueo ya no interviene", () => {
    let now = 0;
    const f = fake();
    const g = new ScrollGuard(f.el, f.input, () => now);
    f.set(1000); f.flush();
    g.lock(1000);
    now = 1000 + USER_INTENT_MS + 10;
    f.set(7000); f.flush();
    expect(f.get().top).toBe(7000);
  });
});
