import type { PanoramaData } from "../../experience/v2-types";
import { Check } from "lucide-react";

interface DirectionPanoramaProps {
  greetingContext: string;
  panorama: PanoramaData;
  onActivityToggle?: () => void;
  activityExpanded?: boolean;
}

/** Dirección — calma y panorama, no dashboard financiero (spec §11.3). */
export function DirectionPanoramaBlock({
  greetingContext,
  panorama,
}: DirectionPanoramaProps) {
  return (
    <section className="space-y-12 lg:space-y-16">
      <div className="flex min-h-[min(20rem,42vh)] flex-col items-center justify-center px-6 py-16 text-center sm:py-20 lg:py-24">
        <p className="mb-12 self-start text-sm text-[var(--os-text-muted)] sm:mb-16">
          {greetingContext}
        </p>
        {panorama.calm && (
          <>
            <div className="mb-6 flex size-12 items-center justify-center rounded-full border border-[var(--os-border)] text-[var(--os-teal)]">
              <Check className="size-6" aria-hidden="true" />
            </div>
            <p className="max-w-md text-xl font-medium tracking-tight text-[var(--os-text)] sm:text-2xl">
              {panorama.calmTitle}
            </p>
            <p className="mt-3 max-w-lg text-base text-[var(--os-text-muted)]">
              {panorama.calmSubtitle}
            </p>
          </>
        )}
      </div>

      {panorama.metrics && panorama.metrics.length > 0 && (
        <div>
          <h3 className="mb-6 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
            Panorama de hoy
          </h3>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8">
            {panorama.metrics.map((metric) => (
              <div key={metric.label} className="text-center sm:text-left">
                <p className="font-mono text-3xl font-medium tracking-tight text-[var(--os-text)] sm:text-4xl">
                  {metric.value}
                </p>
                <p className="mt-2 text-sm text-[var(--os-text-muted)]">{metric.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
