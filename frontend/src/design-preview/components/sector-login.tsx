"use client";

import { FlaskConical, User } from "lucide-react";
import { LAB_PERSONAS, LAB_SECTOR_PREVIEW_ORDER } from "@/design-preview/lib/lab-personas";
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

/** Login simulado F10.1 — personas de Elaboración + sectores con datos reales SEMANAS. */
export function SectorLogin() {
  const { login } = usePreviewContext();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
      <header className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <FlaskConical className="size-7 text-[var(--os-teal)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-teal)]">
              F10.1 · SEMANAS 2026
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--os-text)]">
              Genus OS — Validación con datos reales
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12">
        <div className="mb-10 max-w-xl">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
            Elegí quién sos
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--os-text-muted)]">
            Bloques visuales de SEMANAS 2026 — sin mocks. Si un dato no está en la planilla, verás
            &quot;Dato no disponible&quot;.
          </p>
        </div>

        <section className="mb-12">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Elaboración · por persona
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {LAB_PERSONAS.map((persona, index) => (
              <button
                key={persona.id}
                type="button"
                onClick={() =>
                  login(persona.sectorId, {
                    email: persona.email,
                    ownerPerson: persona.semanasLabel,
                  })
                }
                className="group os-fade-in flex items-start gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-6 text-left shadow-[var(--os-shadow-card)] transition-all hover:border-[var(--os-teal)]/40 hover:shadow-[var(--os-shadow-card-hover)]"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-[var(--os-teal-soft)]">
                  <User className="size-5 text-[var(--os-teal)]" />
                </div>
                <div>
                  <p className="text-xl font-semibold">{persona.name}</p>
                  <p className="mt-1 text-sm text-[var(--os-text-muted)]">{persona.email}</p>
                  <p className="mt-3 text-xs text-[var(--os-teal)]">Bloque SEMANAS · {persona.semanasLabel}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Sectores · planilla real
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LAB_SECTOR_PREVIEW_ORDER.map((sectorId, index) => (
              <div
                key={sectorId}
                className="os-fade-in"
                style={{ animationDelay: `${(index + 2) * 40}ms` }}
              >
                <SectorCard sectorId={sectorId} onSelect={(id) => login(id)} />
              </div>
            ))}
          </div>
        </section>

        <p className="mt-12 text-center text-xs text-[var(--os-text-muted)]">
          Fuentes: SEMANAS 2026 · PEDIDOS 2026 · ASIGNACIÓN DE LOTES · GENUS_DATA_MODE=real
        </p>
      </main>
    </div>
  );
}
