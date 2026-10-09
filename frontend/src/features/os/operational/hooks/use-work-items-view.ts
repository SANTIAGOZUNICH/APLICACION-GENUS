"use client";

import { useEffect, useState } from "react";

const KEY = "genus_os_work_items_view";
export type WorkItemsView = "cards" | "planilla";

/** Vista de «Mi trabajo» (preferencia de este navegador): tarjetas por defecto; «Planilla» para editar en bloque. */
export function useWorkItemsView(): [WorkItemsView, (v: WorkItemsView) => void] {
  const [view, setViewState] = useState<WorkItemsView>("cards");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "cards" || saved === "planilla") setViewState(saved);
    } catch {
      /* sin almacenamiento: tarjetas */
    }
  }, []);
  const setView = (v: WorkItemsView) => {
    setViewState(v);
    try {
      window.localStorage.setItem(KEY, v);
      // las demás tablas de la página (p. ej. otra rama/línea) siguen la misma preferencia
      window.dispatchEvent(new CustomEvent(KEY, { detail: v }));
    } catch {
      /* no crítico */
    }
  };
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent<WorkItemsView>).detail;
      if (v === "cards" || v === "planilla") setViewState(v);
    };
    window.addEventListener(KEY, on);
    return () => window.removeEventListener(KEY, on);
  }, []);
  return [view, setView];
}
