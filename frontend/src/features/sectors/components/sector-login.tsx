"use client";

import { FlaskConical } from "lucide-react";
import { LAB_SECTOR_PREVIEW_ORDER } from "../config/lab-personas";
import { SECTOR_EMAILS } from "../config/sector-emails";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { resolveSectorHome } from "@/lib/role-engine";
import type { SectorId } from "@/types/operational/sector";
import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";

function SectorCard({
  sectorId,
  onSelect,
}: {
  sectorId: SectorId;
  onSelect: (id: SectorId) => void;
}) {
  const home = resolveSectorHome(sectorId);
  const email = SECTOR_EMAILS[sectorId];
  const mockUser = email ? findMockUserByEmail(email) : undefined;

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
        {mockUser?.displayName ?? home.definition.description}
      </span>
      {email && (
        <span className="mt-3 text-xs text-[var(--os-text-muted)]">{email}</span>
      )}
      <span className="mt-4 text-xs font-medium text-[var(--os-teal)] opacity-0 transition-opacity group-hover:opacity-100">
        Entrar al puesto →
      </span>
    </button>
  );
}

/** Acceso rápido por sector — credenciales demo de sector (no por persona). */
export function SectorLogin() {
  const { login } = usePreviewContext();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
      <header className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-8 lg:px-12">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <FlaskConical className="size-7 text-[var(--os-teal)]" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-teal)]">
              Beta Operativa · SEMANAS 2026
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--os-text)]">
              Genus OS — Acceso por sector
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12 lg:px-12">
        <div className="mb-10 max-w-xl">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
            Elegí el sector
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--os-text-muted)]">
            Cada acceso representa un sector de planta. Elaboración muestra las ramas Cristian y
            Nicolás en una sola vista.
          </p>
        </div>

        <section>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LAB_SECTOR_PREVIEW_ORDER.map((sectorId, index) => (
              <div
                key={sectorId}
                className="os-fade-in"
                style={{ animationDelay: `${index * 40}ms` }}
              >
                <SectorCard
                  sectorId={sectorId}
                  onSelect={(id) => {
                    const email = SECTOR_EMAILS[id];
                    const mock = email ? findMockUserByEmail(email) : undefined;
                    login(id, {
                      email,
                      ownerPerson: mock?.ownerPerson ?? null,
                    });
                  }}
                />
              </div>
            ))}
          </div>
        </section>

        <p className="mt-12 text-center text-xs text-[var(--os-text-muted)]">
          Fuentes: SEMANAS 2026 · PEDIDOS 2026 (enriquecimiento pendiente) · LOTES ·
          GENUS_DATA_MODE=real
        </p>
      </main>
    </div>
  );
}
