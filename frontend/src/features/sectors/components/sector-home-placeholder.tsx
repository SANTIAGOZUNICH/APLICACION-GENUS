"use client";

import type { ResolvedSectorHome } from "@/lib/role-engine";
import { TwinShell } from "@/features/os/shell/twin-shell";

interface SectorHomePlaceholderProps {
  home: ResolvedSectorHome;
}

/** Home placeholder — sectores registrados con shell del Digital Twin. */
export function SectorHomePlaceholder({ home }: SectorHomePlaceholderProps) {
  const { definition, panels, quickActions, creamyContext } = home;

  return (
    <TwinShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--os-text)]">
            Hola, {definition.title}
          </h2>
          <p className="mt-2 text-base text-[var(--os-text-muted)]">{definition.description}</p>
        </header>

        <div className="rounded-[var(--os-radius)] border border-dashed border-[var(--os-border)] bg-[var(--os-surface-muted)] px-8 py-12 text-center">
          <p className="text-lg font-medium text-[var(--os-text)]">{home.emptyState.title}</p>
          <p className="mt-2 text-sm text-[var(--os-text-muted)]">{home.emptyState.message}</p>
          <p className="mt-6 text-xs uppercase tracking-wide text-[var(--os-text-muted)]">
            Layout · {home.layout} · {home.dataMode}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--os-text)]">Paneles</h3>
            <ul className="mt-3 space-y-1 text-sm text-[var(--os-text-muted)]">
              {panels.map((panel) => (
                <li key={panel}>{panel.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </section>
          <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--os-text)]">Acciones</h3>
            <ul className="mt-3 space-y-1 text-sm text-[var(--os-text-muted)]">
              {quickActions.map((action) => (
                <li key={action}>{action.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="rounded-[var(--os-radius)] border border-[var(--os-teal-muted)] bg-[var(--os-teal-soft)] p-5">
          <h3 className="text-sm font-semibold text-[var(--os-text)]">
            Creamy · {creamyContext.role}
          </h3>
          <p className="mt-2 text-sm text-[var(--os-text-muted)]">{creamyContext.defaultHint}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {creamyContext.baseSuggestions.map((suggestion) => (
              <span
                key={suggestion}
                className="rounded-full border border-[var(--os-teal-muted)] bg-white/80 px-3 py-1 text-xs font-medium"
              >
                {suggestion}
              </span>
            ))}
          </div>
        </section>
      </div>
    </TwinShell>
  );
}
