"use client";

/**
 * Sincronización automática de planillas — EXCLUSIVAMENTE DE LECTURA.
 *
 * Vuelve a pedir los datos al servidor cada `intervalMs` mientras la pantalla está activa, al volver a la pestaña / recuperar la conexión, y a pedido
 * (`syncNow`, p. ej. tras un ingreso confirmado). Nunca escribe nada: ni datos, ni stock, ni almacenamiento local. Se POSTERGA (no se descarta) mientras
 * la persona edita una celda o hay una ventana abierta (carga o lectura de remitos, formularios), así no pisa cambios pendientes ni interrumpe la edición.
 * Quien la usa debe actualizar su estado SOLO si los datos cambiaron (comparar firma), para no mover el desplazamiento ni re-renderizar sin necesidad.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const AUTO_SYNC_INTERVAL_MS = 10_000;

/** ¿La persona está editando o hay una ventana abierta? (celda de la planilla, ventana de remito, formulario). Solo lee el DOM. */
export function isUserBusy(root: Document = document): boolean {
  if (root.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return true;
  const el = root.activeElement as HTMLElement | null;
  if (!el || el === root.body) return false;
  const editable = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
  if (!editable) return false;
  // Solo cuenta escribir dentro de una planilla o formulario; un buscador fuera de la grilla no bloquea la actualización.
  return Boolean(el.closest(".dsg-container, [data-testid*='grid'], form"));
}

export type AutoSyncState = { lastSyncAt: Date | null; error: string | null; syncing: boolean; deferred: boolean };

export function useAutoSync(opts: { enabled?: boolean; intervalMs?: number; run: () => Promise<void>; isBusy?: () => boolean }) {
  const { enabled = true, intervalMs = AUTO_SYNC_INTERVAL_MS } = opts;
  const [state, setState] = useState<AutoSyncState>({ lastSyncAt: null, error: null, syncing: false, deferred: false });
  const runRef = useRef(opts.run);
  const busyRef = useRef(opts.isBusy ?? isUserBusy);
  useEffect(() => {
    runRef.current = opts.run;
    busyRef.current = opts.isBusy ?? isUserBusy;
  });
  const inFlight = useRef(false);
  const alive = useRef(true);

  const markSynced = useCallback(() => {
    if (alive.current) setState((s) => ({ ...s, lastSyncAt: new Date(), error: null }));
  }, []);

  const syncNow = useCallback(async (force = false) => {
    if (inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (alive.current) setState((s) => ({ ...s, error: "Sin conexión: se reintenta solo." }));
      return;
    }
    if (!force && busyRef.current()) {
      if (alive.current) setState((s) => (s.deferred ? s : { ...s, deferred: true }));
      return; // se vuelve a intentar en el próximo ciclo
    }
    inFlight.current = true;
    if (alive.current) setState((s) => ({ ...s, syncing: true }));
    try {
      await runRef.current();
      if (alive.current) setState({ lastSyncAt: new Date(), error: null, syncing: false, deferred: false });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, syncing: false, error: e instanceof Error && e.message ? e.message : "No se pudo actualizar: se reintenta solo." }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return () => undefined;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const tick = () => {
      if (visible()) void syncNow();
    };
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => visible() && void syncNow();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [enabled, intervalMs, syncNow]);

  return { ...state, syncNow, markSynced };
}

const hhmmss = (d: Date) => d.toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false });

/** Indicador discreto: última sincronización o error de conexión. */
export function SyncStatus({ lastSyncAt, error, deferred }: { lastSyncAt: Date | null; error: string | null; deferred?: boolean }) {
  return (
    <span className={`text-xs ${error ? "text-amber-700 dark:text-amber-300" : "text-[var(--os-text-muted)]"}`} role="status" aria-live="polite" data-testid="sync-status" data-state={error ? "error" : lastSyncAt ? "ok" : "idle"}>
      {error ? `⚠ ${error}` : lastSyncAt ? `Sincronizado ${hhmmss(lastSyncAt)}${deferred ? " · actualizará al terminar de editar" : ""}` : "Sincronizando…"}
    </span>
  );
}

/** Firma barata de un listado: solo se vuelve a renderizar si cambió. */
export const listSignature = (data: unknown): string => JSON.stringify(data);
