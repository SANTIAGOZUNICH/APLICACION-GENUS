"use client";

import { useCallback, useEffect, useState } from "react";
import { usePreviewSession } from "@/features/os/session/preview-context";
import { fetchTransferView, type CodificadoTransferView } from "./codificado-transfer-client";

/** Entregas a Codificado de un trabajo (se refresca al abrir, cada 20 s y con `refresh()`). Solo trabajos nativos. */
export function useTransferView(workItemId: string | null | undefined, enabled: boolean) {
  const { email, sectorId } = usePreviewSession();
  const [view, setView] = useState<CodificadoTransferView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const native = Boolean(workItemId && workItemId.startsWith("native:"));
  const load = useCallback(async () => {
    if (!workItemId || !native) return;
    try {
      setView(await fetchTransferView({ email, sector: sectorId }, workItemId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [workItemId, native, email, sectorId]);
  useEffect(() => {
    if (!enabled || !native) return;
    const t0 = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 20_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [enabled, native, load]);
  return { view: enabled && native ? view : null, error, refresh: load };
}
