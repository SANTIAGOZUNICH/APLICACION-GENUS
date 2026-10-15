"use client";

import { Trophy } from "lucide-react";
import { fmtInt, fmtPercent } from "@/lib/dashboard/format";
import type { DashboardResponsibleRow } from "@/lib/dashboard/types";

const MEDAL: Record<number, { label: string; color: string; pedestal: string; order: string }> = {
  1: { label: "1.º", color: "#f5b301", pedestal: "sm:min-h-44", order: "sm:order-2" },
  2: { label: "2.º", color: "#9aa8b8", pedestal: "sm:min-h-36", order: "sm:order-1" },
  3: { label: "3.º", color: "#cd7f32", pedestal: "sm:min-h-32", order: "sm:order-3" },
};

/**
 * Podio visual 1.º / 2.º / 3.º por unidades envasadas (Métricas). En pantallas anchas se arma el podio clásico
 * (2.º · 1.º · 3.º, con pedestales de distinta altura); en celular se apila de arriba hacia abajo. Nunca incluye
 * «Sin responsable». Con menos de 3 responsables solo se dibujan los que existen.
 */
export function DashboardPodium({ podium }: { podium: DashboardResponsibleRow[] }) {
  if (!podium.length) {
    return (
      <p className="rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] p-4 text-sm text-[var(--os-text-muted)]" data-testid="podium-empty">
        Sin datos suficientes para armar el podio: no hay responsables con unidades envasadas en el período.
      </p>
    );
  }
  return (
    <ol className="grid min-w-0 gap-3 sm:grid-cols-3 sm:items-end" data-testid="podium" aria-label="Podio de responsables por unidades envasadas">
      {podium.slice(0, 3).map((r, i) => {
        const pos = i + 1;
        const m = MEDAL[pos];
        return (
          <li
            key={r.key}
            className={`relative flex min-w-0 flex-col items-center justify-end gap-1 rounded-[var(--os-radius)] border p-4 text-center ${m.order} ${m.pedestal}`}
            style={{
              borderColor: `color-mix(in srgb, ${m.color} 55%, var(--os-border))`,
              background: `linear-gradient(180deg, color-mix(in srgb, ${m.color} 6%, var(--os-surface)) 0%, color-mix(in srgb, ${m.color} 20%, var(--os-surface)) 100%)`,
            }}
            data-testid={`podium-${pos}`}
            data-key={r.key}
          >
            <span className="flex size-9 items-center justify-center rounded-full text-sm font-bold text-black" style={{ background: m.color }} aria-hidden="true">
              {pos === 1 ? <Trophy className="size-5" /> : m.label}
            </span>
            <span className="sr-only">Puesto {m.label}</span>
            <p className="w-full min-w-0 break-words text-base font-bold leading-tight text-[var(--os-text)]" data-testid={`podium-${pos}-name`}>
              {r.name}
            </p>
            <p className="text-2xl font-bold tabular-nums text-[var(--os-text)]" data-testid={`podium-${pos}-units`}>
              {fmtInt(r.units)}
            </p>
            <p className="text-xs text-[var(--os-text-muted)]">
              unidades · <span data-testid={`podium-${pos}-share`}>{fmtPercent(r.share)}</span> del total
            </p>
          </li>
        );
      })}
    </ol>
  );
}
