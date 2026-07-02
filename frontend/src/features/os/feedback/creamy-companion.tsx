"use client";

import { Sparkles, X } from "lucide-react";
import { ContextPanel } from "./context-panel";
import {
  usePreviewContext,
  usePreviewSession,
  useResolvedHome,
} from "../session/preview-context";
import { useSectorWorkItems } from "@/features/work/hooks/use-sector-work-items";
import { buildCopilotContext } from "@/features/work/lib/creamy-copilot";
import {
  extractProblems,
  extractUpcomingDeliveries,
  filterWorkItemsForDate,
} from "@/features/work/lib/work-items-day-view";
import { startOfDay } from "@/features/work/lib/calendar";
import { useMemo } from "react";

/** Creamy como compañera — bubble flotante + drawer contextual. */
export function CreamyCompanion() {
  const { creamyOpen, closeCreamy, openCreamy, creamyTeaser, applyEffectiveStatus } =
    usePreviewContext();
  const { sectorId, ownerPerson } = usePreviewSession();
  const home = useResolvedHome();
  const { data } = useSectorWorkItems(sectorId, { ownerPerson });

  const today = useMemo(() => startOfDay(new Date()), []);
  const dayItems = useMemo(() => {
    const items = applyEffectiveStatus(data?.workItems ?? []);
    return filterWorkItemsForDate(items, today, today);
  }, [data?.workItems, today, applyEffectiveStatus]);

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

  const upcomingDeliveries = useMemo(
    () => extractUpcomingDeliveries(applyEffectiveStatus(data?.workItems ?? []), today),
    [data?.workItems, today, applyEffectiveStatus]
  );
  const problems = useMemo(() => extractProblems(dayItems), [dayItems]);

  return (
    <>
      {!creamyOpen && (
        <button
          type="button"
          onClick={openCreamy}
          className="os-slide-up fixed bottom-24 right-8 z-40 flex max-w-xs items-start gap-3 rounded-[var(--os-radius)] border border-[var(--os-teal-muted)] bg-[var(--os-surface)] px-4 py-3 text-left shadow-[var(--os-shadow-card-hover)] transition-transform hover:scale-[1.02]"
          aria-label="Abrir Creamy copiloto"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--os-teal)]" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--os-teal)]">
              Creamy
            </p>
            <p className="mt-0.5 text-sm font-medium text-[var(--os-text)]">{copilot.headline}</p>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--os-text-muted)]">{copilot.hint}</p>
          </div>
        </button>
      )}

      {creamyOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] os-fade-in"
            onClick={closeCreamy}
            aria-label="Cerrar copiloto"
          />
          <aside className="os-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--os-border)] bg-[var(--os-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--os-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-[var(--os-teal)]" />
                <div>
                  <p className="text-sm font-semibold text-[var(--os-text)]">Creamy · Copiloto</p>
                  <p className="text-xs text-[var(--os-text-muted)]">{home.creamyContext.role}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCreamy}
                className="rounded-full p-2 text-[var(--os-text-muted)] hover:bg-[var(--os-bg)]"
                aria-label="Cerrar"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <ContextPanel
                upcomingDeliveries={upcomingDeliveries}
                problems={problems}
                copilot={copilot}
              />
            </div>
          </aside>
        </>
      )}
    </>
  );
}
