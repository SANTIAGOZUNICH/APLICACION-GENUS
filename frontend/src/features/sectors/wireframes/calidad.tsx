"use client";

import { TwinShell } from "@/design-preview/components/twin-shell";
import { SectionLabel } from "@/design-preview/components/section-label";
import { CALIDAD_ROWS } from "../mock-data/mock-data";

const SECTIONS = [
  { key: "pendientes" as const, label: "Pendientes" },
  { key: "resultados" as const, label: "Resultados" },
  { key: "liberaciones" as const, label: "Liberaciones" },
  { key: "bloqueados" as const, label: "Bloqueados" },
];

function LabSampleCard({
  row,
}: {
  row: (typeof CALIDAD_ROWS)[number];
}) {
  return (
    <article className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-lg font-semibold text-[var(--os-teal)]">{row.lote}</p>
          <p className="mt-2 text-xl font-medium">{row.product}</p>
          <p className="mt-1 text-sm text-[var(--os-text-muted)]">{row.client}</p>
        </div>
        <p className="text-sm font-medium">{row.result}</p>
      </div>

      <div className="mt-6 flex flex-wrap gap-6 text-sm">
        <span>
          <span className="text-[var(--os-text-muted)]">OE </span>
          {row.oe}
        </span>
        <span>
          <span className="text-[var(--os-text-muted)]">OA </span>
          {row.oa}
        </span>
        {row.liberation && (
          <span>
            <span className="text-[var(--os-text-muted)]">Liberación </span>
            {row.liberation}
          </span>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-6 border-t border-[var(--os-border-subtle)] pt-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4" readOnly />
          Aprobar
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4" readOnly />
          Rechazar
        </label>
        <button type="button" className="text-sm text-[var(--os-text-muted)]">
          Observación
        </button>
      </div>
    </article>
  );
}

/** Mesa de laboratorio — cards amplias, no grid ERP. */
export function WireframeCalidad() {
  return (
    <TwinShell title="Calidad">
      <p className="mb-[var(--os-space-section)] text-3xl font-semibold tracking-tight">
        Hola Calidad
      </p>

      {SECTIONS.map(({ key, label }) => {
        const rows = CALIDAD_ROWS.filter((r) => r.section === key);
        if (rows.length === 0) return null;
        return (
          <section key={key} className="mb-[var(--os-space-section)]">
            <SectionLabel>{label}</SectionLabel>
            <div className="flex flex-col gap-4">
              {rows.map((row) => (
                <LabSampleCard key={row.id} row={row} />
              ))}
            </div>
          </section>
        );
      })}
    </TwinShell>
  );
}
