import { QuickAction } from "../premium/quick-action";
import { EntityRef } from "./entity-ref";
import type { FocusBlockData } from "../../experience/v2-types";

interface FocusBlockProps {
  focus: FocusBlockData;
  onCta: () => void;
}

/** Hero v2 — acción primero, saludo periférico, ~2/3 aire (spec §2). */
export function FocusBlock({ focus, onCta }: FocusBlockProps) {
  const isCalm = Boolean(focus.calmState);

  return (
    <section
      className="relative min-h-[min(22rem,48vh)] rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-6 py-14 sm:px-10 sm:py-16 lg:px-14 lg:py-20"
      aria-label="Foco de trabajo"
    >
      <p className="text-sm text-[var(--os-text-muted)]">{focus.greetingContext}</p>

      {isCalm ? (
        <div className="mt-10 max-w-xl">
          <p className="text-xl font-medium tracking-tight text-[var(--os-text)] sm:text-2xl">
            {focus.calmState!.title}
          </p>
          <p className="mt-3 text-base leading-relaxed text-[var(--os-text-muted)]">
            {focus.calmState!.subtitle}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 max-w-2xl">
            {focus.reference && (
              <EntityRef className="block text-lg sm:text-xl">{focus.reference}</EntityRef>
            )}
            <p className="mt-4 text-xl font-medium leading-snug tracking-tight text-[var(--os-text)] sm:text-2xl lg:text-[1.75rem]">
              {focus.workLine}
            </p>
            {focus.metaLine && (
              <p className="mt-4 text-sm text-[var(--os-text-muted)] sm:text-base">
                {focus.metaLine}
              </p>
            )}
          </div>

          <div className="mt-12 flex justify-end sm:mt-14 lg:mt-16">
            <QuickAction label={focus.ctaLabel} onClick={onCta} variant="primary" />
          </div>
        </>
      )}
    </section>
  );
}
