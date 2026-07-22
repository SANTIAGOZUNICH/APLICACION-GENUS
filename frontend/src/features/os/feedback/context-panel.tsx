"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Search, Sparkles } from "lucide-react";
import type { CopilotContext } from "@/features/work/lib/creamy-copilot";
import { answerLotesQuery } from "@/features/os/operational/lib/asignacion-lotes-creamy";

interface DeliveryItem {
  client: string;
  product: string;
  when: string;
}

interface ContextPanelProps {
  upcomingDeliveries: DeliveryItem[];
  problems: string[];
  copilot: CopilotContext;
  onSuggestionClick?: (suggestion: string) => void;
  lotesSearchEnabled?: boolean;
  onOpenAsignacionLotes?: () => void;
}

/** Panel lateral — entregas, problemas y Creamy copiloto contextual. */
export function ContextPanel({
  upcomingDeliveries,
  problems,
  copilot,
  onSuggestionClick,
  lotesSearchEnabled = false,
  onOpenAsignacionLotes,
}: ContextPanelProps) {
  const [lotesQuery, setLotesQuery] = useState("");
  const lotesAnswer = useMemo(() => answerLotesQuery(lotesQuery), [lotesQuery]);

  return (
    <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
      <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-[var(--os-teal)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Próximas entregas</h2>
        </div>
        {upcomingDeliveries.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--os-text-muted)]">Sin entregas próximas</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcomingDeliveries.map((item) => (
              <li
                key={`${item.client}-${item.product}-${item.when}`}
                className="rounded-[var(--os-radius-sm)] bg-[var(--os-bg)] px-3 py-3"
              >
                <p className="text-sm font-medium text-[var(--os-text)]">{item.client}</p>
                <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{item.product}</p>
                <p className="mt-1.5 text-xs font-semibold text-amber-700">{item.when}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 text-rose-500" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Problemas / faltantes</h2>
        </div>
        {problems.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--os-text-muted)]">Sin problemas reportados</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {problems.map((problem) => (
              <li
                key={problem}
                className="rounded-[var(--os-radius-sm)] border border-rose-100 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-900"
              >
                {problem}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--os-radius)] border border-[var(--os-teal-muted)] bg-gradient-to-br from-[var(--os-teal-soft)] to-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--os-teal)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Creamy · Copiloto</h2>
        </div>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--os-teal)]">
          {copilot.headline}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--os-text-muted)]">{copilot.hint}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {copilot.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionClick?.(suggestion)}
              className="rounded-full border border-[var(--os-teal-muted)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--os-text)] transition-colors hover:border-[var(--os-teal)] hover:text-[var(--os-teal)]"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {lotesSearchEnabled && (
          <div className="mt-5 rounded-[var(--os-radius-sm)] border border-[var(--os-teal-muted)] bg-white/70 p-3">
            <label
              htmlFor="creamy-lotes-search"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--os-teal)]"
            >
              Preguntá por un lote o producto
            </label>
            <div className="relative mt-2">
              <Search
                className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--os-text-muted)]"
                aria-hidden="true"
              />
              <input
                id="creamy-lotes-search"
                type="search"
                value={lotesQuery}
                onChange={(event) => setLotesQuery(event.target.value)}
                placeholder="Creamy, PR-120, L-CR-001..."
                className="w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--os-teal)] focus:ring-2 focus:ring-[var(--os-teal-muted)]"
              />
            </div>

            {lotesQuery.trim() && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-medium text-[var(--os-text)]">{lotesAnswer.headline}</p>
                <p className="text-xs text-[var(--os-text-muted)]">{lotesAnswer.hint}</p>
                {lotesAnswer.results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={onOpenAsignacionLotes}
                    className="block w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--os-teal)]"
                  >
                    <span className="block font-medium text-[var(--os-text)]">{result.label}</span>
                    <span className="mt-0.5 block text-[var(--os-text-muted)]">{result.meta || "Sin metadata"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
