"use client";

import { ArrowLeft, MessageCircle, Minus, RefreshCcw, Sparkles, X } from "lucide-react";
import { CreamyChat } from "@/features/os/assistant/creamy-chat";
import { useCreamyChat } from "@/features/os/assistant/creamy-chat-context";
import {
  usePreviewContext,
  usePreviewSession,
  useResolvedHome,
} from "../session/preview-context";
import { useSectorWorkItems } from "@/features/work/hooks/use-sector-work-items";
import { buildCopilotContext } from "@/features/work/lib/creamy-copilot";
import { canAccessAsignacionLotes } from "@/features/os/operational/lib/asignacion-lotes-rbac";
import { filterWorkItemsForDate } from "@/features/work/lib/work-items-day-view";
import { startOfDay } from "@/features/work/lib/calendar";
import { useCallback, useEffect, useMemo, useState } from "react";

type CreamyConfigStatus = "checking" | "configured" | "not_configured" | "offline";

interface CreamyStatusPayload {
  configured?: boolean;
  provider?: string | null;
  model?: string | null;
}

/** Creamy global — FAB flotante + panel de conversación compartida. */
export function CreamyCompanion() {
  const { creamyOpen, closeCreamy, openCreamy, creamyTeaser, applyEffectiveStatus, navigateSidebar } =
    usePreviewContext();
  const { panelMode, openPanel, closePanel, minimizePanel, resetConversation } = useCreamyChat();
  const { sectorId, ownerPerson } = usePreviewSession();
  const home = useResolvedHome();
  const { data } = useSectorWorkItems(sectorId, { ownerPerson });
  const [configStatus, setConfigStatus] = useState<CreamyConfigStatus>("checking");
  const [providerInfo, setProviderInfo] = useState<{ provider?: string | null; model?: string | null }>({});
  const [keyboardInset, setKeyboardInset] = useState(0);

  const today = useMemo(() => startOfDay(new Date()), []);
  const workItems = useMemo(
    () => applyEffectiveStatus(data?.workItems ?? []),
    [data?.workItems, applyEffectiveStatus]
  );
  const dayItems = useMemo(() => {
    return filterWorkItemsForDate(workItems, today, today);
  }, [workItems, today]);

  const copilot = useMemo(
    () =>
      creamyTeaser
        ? {
            headline: creamyTeaser.headline,
            hint: creamyTeaser.hint,
            suggestions: home.creamyContext.baseSuggestions,
          }
        : buildCopilotContext(dayItems, home.definition.title, home.creamyContext),
    [creamyTeaser, dayItems, home.creamyContext, home.definition.title]
  );

  const canSearchLotes = canAccessAsignacionLotes(sectorId);
  const openAsignacionLotes = useCallback(() => {
    navigateSidebar("asignacion_lotes");
  }, [navigateSidebar]);

  useEffect(() => {
    if (creamyOpen) openPanel();
  }, [creamyOpen, openPanel]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/assistant/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("status_failed");
        const payload = (await response.json()) as CreamyStatusPayload;
        if (!cancelled) {
          setConfigStatus(payload.configured ? "configured" : "not_configured");
          setProviderInfo({ provider: payload.provider, model: payload.model });
        }
      })
      .catch(() => {
        if (!cancelled) setConfigStatus("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const sync = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  const handleOpen = useCallback(() => {
    openPanel();
    if (!creamyOpen) openCreamy();
  }, [creamyOpen, openCreamy, openPanel]);

  const handleClose = useCallback(() => {
    closePanel();
    closeCreamy();
  }, [closeCreamy, closePanel]);

  const handleMinimize = useCallback(() => {
    minimizePanel();
    closeCreamy();
  }, [closeCreamy, minimizePanel]);

  const showLauncher = panelMode === "closed" || panelMode === "minimized";
  const isOpen = panelMode === "open";

  const statusLabel =
    configStatus === "configured"
      ? providerInfo.provider
        ? `${providerInfo.provider === "gemini" ? "Gemini" : "OpenAI"}${providerInfo.model ? ` · ${providerInfo.model}` : ""}`
        : "IA configurada"
      : configStatus === "not_configured"
        ? "IA no configurada"
        : configStatus === "offline"
          ? "Sin conexión al asistente"
          : "Verificando configuración…";

  const statusDot =
    configStatus === "configured"
      ? "bg-emerald-400"
      : configStatus === "not_configured"
        ? "bg-amber-300"
        : configStatus === "offline"
          ? "bg-rose-400"
          : "bg-white/60";

  return (
    <>
      {showLauncher && (
        <div
          className="pointer-events-none fixed right-4 z-40 flex flex-col items-end gap-2 sm:right-6"
          style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {panelMode === "minimized" && (
            <button
              type="button"
              onClick={handleOpen}
              className="pointer-events-auto rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-[var(--os-shadow-card)] hover:border-[var(--os-teal)]"
            >
              Creamy
            </button>
          )}
          <button
            type="button"
            onClick={handleOpen}
            title="Hablar con Creamy"
            className="pointer-events-auto group flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-600 via-cyan-500 to-teal-400 text-white shadow-2xl ring-2 ring-white/70 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2"
            aria-label="Hablar con Creamy"
          >
            {panelMode === "minimized" ? (
              <MessageCircle className="size-6" aria-hidden="true" />
            ) : (
              <Sparkles className="size-6" aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      {isOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px] os-fade-in md:hidden"
            onClick={handleClose}
            aria-label="Cerrar copiloto"
          />
          <aside
            className="os-drawer fixed z-50 flex min-h-0 flex-col overflow-hidden border border-[var(--os-border)] bg-[var(--os-surface)] shadow-2xl max-md:inset-x-0 max-md:top-0 max-md:rounded-none md:inset-y-0 md:left-auto md:right-0 md:w-[420px] md:max-w-[450px] md:rounded-none md:border-y-0 md:border-r-0"
            style={{
              bottom: keyboardInset > 0 ? keyboardInset : undefined,
              height: keyboardInset > 0 ? `calc(100dvh - ${keyboardInset}px)` : undefined,
            }}
            aria-label="Creamy · Asistente de Genus OS"
          >
            <div className="shrink-0 border-b border-[var(--os-border)] bg-gradient-to-r from-sky-700 via-cyan-600 to-teal-500 px-4 py-3 text-white">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="rounded-full p-1.5 text-white/90 hover:bg-white/10 md:hidden"
                      aria-label="Volver"
                      title="Volver"
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" />
                    </button>
                    <Sparkles className="size-5 shrink-0 text-white" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">Creamy</p>
                      <p className="truncate text-xs text-white/80">Asistente de Genus OS</p>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/80">
                    <span className="inline-flex items-center gap-1">
                      <span className={`size-1.5 rounded-full ${statusDot}`} aria-hidden="true" />
                      {statusLabel}
                    </span>
                    <span className="hidden sm:inline">· {home.creamyContext.role}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-white/65">{copilot.headline || copilot.hint}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={resetConversation}
                    className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
                    aria-label="Nueva conversación"
                    title="Nueva conversación"
                  >
                    <RefreshCcw className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={handleMinimize}
                    className="hidden rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white md:inline-flex"
                    aria-label="Minimizar Creamy"
                    title="Minimizar"
                  >
                    <Minus className="size-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
                    aria-label="Cerrar Creamy"
                    title="Cerrar"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <CreamyChat
                sectorId={sectorId}
                workItems={workItems}
                suggestions={copilot.suggestions}
                lotesSearchEnabled={canSearchLotes}
                onOpenAsignacionLotes={openAsignacionLotes}
                compact
                showHeaderActions={false}
              />
            </div>
          </aside>
        </>
      )}
    </>
  );
}
