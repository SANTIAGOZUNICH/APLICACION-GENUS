"use client";

/**
 * «Asignar trabajo» ← Entregas programadas. Busca entregas pendientes (calendario de Entregas) que coincidan con el
 * cliente, el producto y el sector que Producción está cargando y las MUESTRA TODAS: nunca elige ni vincula sola.
 * Producción confirma cuál corresponde; recién ahí se completan los campos disponibles (solo los que la entrega tiene
 * cargados — nada se inventa). El servidor vuelve a validar el vínculo al guardar el trabajo.
 */
import { useEffect, useState } from "react";
import { CalendarCheck, Link2Off } from "lucide-react";
import type { DeliverySuggestion } from "@/lib/entregas/types";
import { DELIVERY_SECTOR_LABEL } from "@/lib/entregas/types";

const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

export interface AssignEntregaSuggestionsProps {
  sector: string;
  client: string;
  product: string;
  /** Entrega ya elegida (con los mismos cliente y producto que el formulario). */
  selected: DeliverySuggestion | null;
  disabled?: boolean;
  onPick: (s: DeliverySuggestion) => void;
  onClear: () => void;
}

export function AssignEntregaSuggestions({ sector, client, product, selected, disabled, onPick, onClear }: AssignEntregaSuggestionsProps) {
  const [state, setState] = useState<{ key: string; list: DeliverySuggestion[] } | null>(null);
  const enabled = (sector === "ENVASADO_MASIVO" || sector === "ENVASADO_PREMIUM") && client.trim().length >= 2 && product.trim().length >= 2;
  const key = `${sector}|${client.trim()}|${product.trim()}`;

  useEffect(() => {
    if (!enabled || selected) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ client: client.trim(), product: product.trim(), sector });
        const res = await fetch(`/api/v1/entregas/suggestions?${qs}`, { credentials: "include", cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setState({ key, list: [] });
          return;
        }
        const body = (await res.json()) as { suggestions?: DeliverySuggestion[] };
        if (!cancelled) setState({ key, list: body.suggestions ?? [] });
      } catch {
        if (!cancelled) setState({ key, list: [] });
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, Boolean(selected)]);

  if (selected) {
    return (
      <div className="space-y-1.5 sm:col-span-2" data-testid="assign-entrega-selected">
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--os-radius-sm)] border border-[var(--os-teal)]/50 bg-[var(--os-teal)]/10 px-3 py-2 text-sm">
          <CalendarCheck className="size-4 text-[var(--os-teal)]" aria-hidden="true" />
          <span className="font-semibold">Entrega programada vinculada</span>
          <span className="text-[var(--os-text-muted)]">
            {selected.client} · {selected.product} · entrega {fmtDate(selected.deliveryDate)}
            {selected.quantity ? ` · ${selected.quantity}${selected.unit ? ` ${selected.unit}` : ""}` : ""}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-[var(--os-teal)] hover:underline"
            data-testid="assign-entrega-clear"
          >
            <Link2Off className="size-3.5" aria-hidden="true" /> No vincular
          </button>
        </div>
        <p className="text-xs text-[var(--os-text-muted)]">
          Se completaron los datos que la entrega tiene cargados. La fecha de fabricación (Desde / Hasta) la elegís vos.
        </p>
      </div>
    );
  }

  const list = enabled && state?.key === key ? state.list : [];
  if (list.length === 0) return null;
  return (
    <div className="space-y-1.5 sm:col-span-2 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] p-3" data-testid="assign-entrega-suggestions">
      <p className="text-sm font-semibold">
        {list.length === 1 ? "Hay una entrega programada que coincide" : `Hay ${list.length} entregas programadas que coinciden`} — ¿cuál corresponde a este trabajo?
      </p>
      <ul className="space-y-1.5">
        {list.map((s) => (
          <li key={s.itemId} className="flex flex-wrap items-center gap-2 rounded border border-[var(--os-border)]/70 px-2.5 py-1.5 text-sm" data-testid="assign-entrega-option">
            <span className="min-w-0 flex-1">
              <b>{s.client}</b> · {s.product} · entrega {fmtDate(s.deliveryDate)}
              {s.quantity ? ` · ${s.quantity}${s.unit ? ` ${s.unit}` : ""}` : ""}
              {s.sector ? ` · ${DELIVERY_SECTOR_LABEL[s.sector]}` : ""}
              {s.lot ? ` · Lote ${s.lot}` : ""}
              {s.vto ? ` · VTO ${s.vto}` : ""}
              {s.linkedWorks > 0 ? ` · ya tiene ${s.linkedWorks} trabajo(s)${s.coveredQuantity != null ? ` (${s.coveredQuantity.toLocaleString("es-AR")} cubiertas)` : ""}` : ""}
              {s.match === "compatible" ? " · coincidencia aproximada" : ""}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="rounded border border-[var(--os-teal)]/60 px-2 py-0.5 text-xs font-semibold text-[var(--os-teal)] hover:bg-[var(--os-teal)]/10"
              data-testid="assign-entrega-pick"
            >
              Usar esta entrega
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--os-text-muted)]">No se vincula nada hasta que elijas una. Si ninguna corresponde, seguí normalmente.</p>
    </div>
  );
}
