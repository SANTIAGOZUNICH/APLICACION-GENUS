"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPushHistory, markPushRead, type PushHistoryItem } from "./push-client";

/** Historial de avisos push del cliente (leídos/no leídos por usuario). Se consulta al montar, al volver a la pestaña y cada 60 s. */
export function usePushInbox(enabled: boolean) {
  const [items, setItems] = useState<PushHistoryItem[]>([]);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const r = await fetchPushHistory();
    if (r) setItems(r.items);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    // Carga inicial: el estado se actualiza al resolver la consulta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    const onVis = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", onVis);
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void reload(); }, 60_000);
    return () => { document.removeEventListener("visibilitychange", onVis); window.clearInterval(t); };
  }, [enabled, reload]);
  const read = useCallback(async (ids: string[] | "all") => {
    setItems((prev) => prev.map((i) => (ids === "all" || ids.includes(i.id) ? { ...i, read: true } : i)));
    await markPushRead(ids);
  }, []);
  return { items, unread: items.filter((i) => !i.read).length, read, reload };
}
