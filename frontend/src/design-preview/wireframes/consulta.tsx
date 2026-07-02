"use client";

import { Search } from "lucide-react";
import { OsShell } from "@/design-preview/components/os-shell";
import { CONSULTA_RESULTS } from "@/design-preview/mock-data";

export function WireframeConsulta() {
  return (
    <OsShell
      sectorLabel="Envasado Masivo"
      sectorEmail="emasivo@laboratoriogenus.com.ar"
      title="Consulta"
      activeNav="consulta"
      contentClassName="flex flex-col items-center pt-16"
    >
      <div className="w-full max-w-xl">
        <div className="relative">
          <Search className="absolute left-5 top-1/2 size-5 -translate-y-1/2 text-[var(--os-text-muted)]" />
          <input
            type="search"
            defaultValue="thelma"
            readOnly
            className="w-full rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] py-5 pl-14 pr-5 text-lg shadow-[var(--os-shadow)] outline-none ring-[var(--os-teal)] focus:ring-2"
            placeholder="Pedido, producto, cliente, lote, OE, OA…"
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)]">
          {CONSULTA_RESULTS.map((result, i) => (
            <button
              key={result.label}
              type="button"
              className={`flex w-full gap-4 px-5 py-4 text-left ${
                i === 0 ? "bg-[var(--os-teal-soft)]" : "hover:bg-[var(--os-bg)]"
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
      </div>
    </OsShell>
  );
}
