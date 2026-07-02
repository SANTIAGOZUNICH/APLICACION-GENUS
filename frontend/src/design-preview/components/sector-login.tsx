"use client";

import { FlaskConical } from "lucide-react";
import { LOGIN_SECTOR_ORDER } from "@/design-preview/lib/sector-emails";
import { usePreviewContext } from "@/design-preview/lib/preview-context";
import { resolveSectorHome } from "@/lib/role-engine";
import type { SectorId } from "@/types/operational/sector";

function SectorCard({
  sectorId,
  onSelect,
}: {
  sectorId: SectorId;
  onSelect: (id: SectorId) => void;
}) {
  const home = resolveSectorHome(sectorId);

  return (
    <button
      type="button"
      onClick={() => onSelect(sectorId)}
      className="group os-fade-in flex flex-col rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-6 text-left shadow-[var(--os-shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--os-teal)]/40 hover:shadow-[var(--os-shadow-card-hover)]"
    >
      <span className="text-xs font-semibold uppercase tracking-widest text-[var(--os-teal)]">
        {sectorId.replace(/_/g, " ")}
      </span>
      <span className="mt-3 text-xl font-semibold tracking-tight text-[var(--os-text)]">
        {home.definition.title}
      </span>
      <span className="mt-2 flex-1 text-sm leading-relaxed text-[var(--os-text-muted)]">
        {home.definition.description}
      </span>
      <span className="mt-6 text-xs font-medium text-[var(--os-teal)] opacity-0 transition-opacity group-hover:opacity-100">
        Entrar al puesto →
      </span>
    </button>
  );
}

/** Login simulado F9.6 — elige sector, sin autenticación. */
export function SectorLogin() {
  const { login } = usePreviewContext();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
      <header className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <FlaskConical className="size-7 text-[var(--os-teal)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-teal)]">
              F9.6 · Digital Twin
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--os-text)]">
              Genus OS — Laboratorio Genus
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12">
        <div className="mb-10 max-w-xl">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
            Elegí tu sector
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--os-text-muted)]">
            Prototipo navegable del laboratorio. Sin autenticación real — simula el puesto de
            trabajo de cada sector.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LOGIN_SECTOR_ORDER.map((sectorId, index) => (
            <div
              key={sectorId}
              className="os-fade-in"
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <SectorCard sectorId={sectorId} onSelect={login} />
            </div>
          ))}
        </div>

        <p className="mt-12 text-center text-xs text-[var(--os-text-muted)]">
          Digital Twin · F9.6 · Acciones simuladas · Datos reales cuando Drive está configurado
        </p>
      </main>
    </div>
  );
}
