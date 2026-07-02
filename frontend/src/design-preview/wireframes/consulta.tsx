"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { TwinShell } from "@/design-preview/components/twin-shell";
import { EmptyState } from "@/design-preview/components/empty-state";
import { usePreviewContext } from "@/design-preview/lib/preview-context";
import { useMultiSectorWorkItems } from "@/design-preview/hooks/use-multi-sector-work-items";
import {
  defaultSearchSuggestions,
  searchWorkItems,
  type SearchResult,
} from "@/design-preview/lib/search-work-items";

interface WireframeConsultaProps {
  initialQuery?: string;
}

/** Consulta tipo Spotlight — búsqueda sobre WorkItems reales. */
export function WireframeConsulta({ initialQuery = "" }: WireframeConsultaProps) {
  const { applyEffectiveStatus, openWorkItem, openOa, openOe, openClient } = usePreviewContext();
  const { items, loading } = useMultiSectorWorkItems([
    "ELABORACION",
    "ENVASADO_MASIVO",
    "ENVASADO_PREMIUM",
    "DEPOSITO",
    "PRODUCCION",
  ]);
  const [query, setQuery] = useState(initialQuery);
  const [focused, setFocused] = useState(false);

  const workItems = useMemo(() => applyEffectiveStatus(items), [items, applyEffectiveStatus]);

  const results = useMemo(() => {
    if (!query.trim()) return defaultSearchSuggestions(workItems);
    return searchWorkItems(workItems, query);
  }, [query, workItems]);

  const handleSelect = (result: SearchResult) => {
    if (result.href === "client" && result.ref) {
      openClient(result.ref);
      return;
    }
    if (result.href === "oe" && result.ref) {
      openOe(result.ref, result.workItemId);
      return;
    }
    if (result.href === "oa" && result.ref) {
      openOa(result.ref, result.workItemId);
      return;
    }
    if (result.workItemId) {
      openWorkItem(result.workItemId);
    }
  };

  return (
    <TwinShell title="Consulta" contentClassName="flex flex-col items-center pt-8">
      <div className="w-full max-w-xl os-fade-in">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 size-5 -translate-y-1/2 text-[var(--os-text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoFocus
            className={`w-full rounded-[var(--os-radius)] border bg-[var(--os-surface)] py-5 pl-14 pr-5 text-lg shadow-[var(--os-shadow)] outline-none transition-shadow ${
              focused ? "border-[var(--os-teal)] ring-2 ring-[var(--os-teal-muted)]" : "border-[var(--os-border)]"
            }`}
            placeholder="Pedido, producto, cliente, lote, OE, OA…"
          />
        </div>

        {loading && (
          <div className="mt-4 os-skeleton h-48 rounded-[var(--os-radius)] border border-[var(--os-border)]" />
        )}

        {!loading && results.length === 0 && query.trim() && (
          <div className="mt-6">
            <EmptyState
              title="Sin resultados"
              message={`No encontramos "${query}" en los WorkItems cargados.`}
            />
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="mt-4 overflow-hidden rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-card)]">
            {results.map((result, i) => (
              <button
                key={result.id}
                type="button"
                onClick={() => handleSelect(result)}
                className={`flex w-full gap-4 px-5 py-4 text-left transition-colors ${
                  i === 0 && query.trim()
                    ? "bg-[var(--os-teal-soft)]"
                    : "hover:bg-[var(--os-bg)]"
                }`}
              >
                <span className="w-14 shrink-0 text-xs font-bold uppercase text-[var(--os-teal)]">
                  {result.type}
                </span>
                <span>
                  <span className="block font-medium">{result.label}</span>
                  <span className="text-sm text-[var(--os-text-muted)]">{result.meta}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-[var(--os-text-muted)]">
          Spotlight · Enter para buscar · Click para abrir detalle
        </p>
      </div>
    </TwinShell>
  );
}
