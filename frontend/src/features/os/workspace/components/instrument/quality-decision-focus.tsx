import type { QualityDecisionFocus } from "../../experience/v2-types";
import { EntityRef } from "./entity-ref";

interface QualityDecisionFocusProps {
  focus: QualityDecisionFocus;
  onContextLink: (id: string, label: string) => void;
  onDecision: (id: "reject" | "release", label: string) => void;
}

/** Calidad — decisión deliberada, acciones simétricas (spec §11.2). */
export function QualityDecisionFocusBlock({
  focus,
  onContextLink,
  onDecision,
}: QualityDecisionFocusProps) {
  return (
    <section
      className="min-h-[min(24rem,50vh)] rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-6 py-14 sm:px-10 sm:py-16 lg:px-14 lg:py-20"
      aria-label="Decisión de calidad"
    >
      <p className="text-sm text-[var(--os-text-muted)]">{focus.greetingContext}</p>

      <div className="mt-8 max-w-2xl">
        <EntityRef className="block text-lg sm:text-xl">{focus.reference}</EntityRef>
        <p className="mt-4 text-xl font-medium tracking-tight text-[var(--os-text)] sm:text-2xl">
          {focus.workLine}
        </p>
        {focus.metaLine && (
          <p className="mt-3 text-sm text-[var(--os-text-muted)]">{focus.metaLine}</p>
        )}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        {focus.contextLinks.map((link) => (
          <button
            key={link.id}
            type="button"
            onClick={() => onContextLink(link.id, link.label)}
            className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface)] px-4 py-2.5 text-sm font-medium text-[var(--os-text)] transition-colors duration-200 hover:border-[var(--os-teal)]/40"
          >
            {link.label}
          </button>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:gap-4">
        {focus.decisions.map((decision) => (
          <button
            key={decision.id}
            type="button"
            onClick={() => onDecision(decision.id, decision.label)}
            className="min-h-[3rem] flex-1 rounded-[12px] border border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-3 text-base font-semibold text-[var(--os-text)] transition-all duration-200 hover:border-[var(--os-teal)]/35 hover:shadow-[var(--os-shadow-sm)] sm:min-h-[3.25rem]"
          >
            {decision.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-[var(--os-text-muted)]">
        Mismo peso visual — el sistema no sugiere cuál elegir.
      </p>
    </section>
  );
}
