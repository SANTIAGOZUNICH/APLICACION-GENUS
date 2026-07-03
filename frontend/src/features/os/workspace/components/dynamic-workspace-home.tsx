"use client";

import { ArrowRight } from "lucide-react";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { SectionLabel } from "@/features/work/components/section-label";
import { usePreviewContext } from "@/features/os/session/preview-context";
import { useRequiredWorkspace, useWorkspaceUserInitials } from "../workspace-provider";
import type { WorkspaceAction, WorkspaceNavItem, WorkspaceWidget } from "../types";

function NavChip({
  item,
  onNavigate,
}: {
  item: WorkspaceNavItem;
  onNavigate: (item: WorkspaceNavItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(item)}
      className="rounded-full border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2 text-sm font-medium text-[var(--os-text)] transition-colors hover:border-[var(--os-teal)] hover:text-[var(--os-teal)]"
    >
      {item.label}
    </button>
  );
}

function ActionCard({
  action,
  onSelect,
}: {
  action: WorkspaceAction;
  onSelect: (action: WorkspaceAction) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(action)}
      className="group flex w-full items-start justify-between gap-4 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-5 text-left transition-shadow hover:shadow-[var(--os-shadow-card)]"
    >
      <div>
        <p className="text-base font-semibold text-[var(--os-text)]">{action.label}</p>
        {action.description && (
          <p className="mt-1 text-sm text-[var(--os-text-muted)]">{action.description}</p>
        )}
      </div>
      <ArrowRight
        className="mt-1 size-4 shrink-0 text-[var(--os-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--os-teal)]"
        aria-hidden="true"
      />
    </button>
  );
}

function WidgetCard({ widget }: { widget: WorkspaceWidget }) {
  return (
    <article className="rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)]/40 px-5 py-4">
      <p className="text-sm font-semibold text-[var(--os-text)]">{widget.label}</p>
      {widget.hint && <p className="mt-1 text-sm text-[var(--os-text-muted)]">{widget.hint}</p>}
      {widget.status && (
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--os-teal)]">
          {widget.status}
        </p>
      )}
    </article>
  );
}

/** Home dinámico — Trabajo → Estado → Acción → Datos. */
export function DynamicWorkspaceHome() {
  const workspace = useRequiredWorkspace();
  const userInitials = useWorkspaceUserInitials();
  const { navigateSidebar, openConsulta, openCreamy, setCreamyTeaser } = usePreviewContext();

  const handleNav = (item: WorkspaceNavItem) => {
    navigateSidebar(item.sidebarItemId);
  };

  const handleAction = (action: WorkspaceAction) => {
    if (action.id === "consult" || action.id === "view-analysis") {
      openConsulta("");
      return;
    }
    if (action.id === "operations" || action.id === "kpis" || action.id === "alerts") {
      navigateSidebar("produccion");
      return;
    }
    if (action.id === "plan" || action.id.includes("plan")) {
      navigateSidebar("plan_semanal");
      return;
    }

    setCreamyTeaser({
      headline: action.label,
      hint: action.description ?? "Acción simulada — datos reales en fases posteriores.",
    });
    openCreamy();
  };

  return (
    <TwinShell title="Mi trabajo" userInitials={userInitials}>
      <header className="mb-10 max-w-3xl">
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-[var(--os-text-muted)]">
          {workspace.sectorLabel}
        </p>
        <h2 className="mt-3 text-[2rem] font-semibold tracking-tight text-[var(--os-text)]">
          {workspace.title}
        </h2>
        <p className="mt-3 text-lg text-[var(--os-text-muted)]">{workspace.subtitle}</p>
      </header>

      <section className="mb-[var(--os-space-section)]">
        <SectionLabel>Estado</SectionLabel>
        <div className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-5">
          <p className="text-sm text-[var(--os-text-muted)]">
            {workspace.context.jobTitle || workspace.context.roleLabel} ·{" "}
            {workspace.context.sectorLabel}
          </p>
          <p className="mt-2 text-base font-medium text-[var(--os-text)]">{workspace.subtitle}</p>
        </div>
      </section>

      <section className="mb-[var(--os-space-section)]">
        <SectionLabel>Acción</SectionLabel>
        <div className="grid gap-3">
          {workspace.definition.primaryActions.map((action) => (
            <ActionCard key={action.id} action={action} onSelect={handleAction} />
          ))}
        </div>
      </section>

      <section className="mb-[var(--os-space-section)]">
        <SectionLabel>Navegación</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {workspace.definition.primaryNav.map((item) => (
            <NavChip key={item.id} item={item} onNavigate={handleNav} />
          ))}
        </div>
      </section>

      <section>
        <SectionLabel>Datos</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspace.definition.widgets.map((widget) => (
            <WidgetCard key={widget.id} widget={widget} />
          ))}
        </div>
      </section>
    </TwinShell>
  );
}
