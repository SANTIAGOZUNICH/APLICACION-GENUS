"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { GenusOsLogo } from "./genus-os-logo";
import {
  SESSION_BOOTSTRAP_STEPS,
  type SessionBootstrapStep,
} from "../lib/session-bootstrap-steps";

interface OsSessionBootstrapScreenProps {
  onComplete?: () => void;
}

/** Secuencia visual post-login — simulación UI (auth real en PR 4.5). */
export function OsSessionBootstrapScreen({ onComplete }: OsSessionBootstrapScreenProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedIds, setCompletedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let stepIndex = 0;

    const runStep = (step: SessionBootstrapStep, index: number) => {
      setActiveIndex(index);
      window.setTimeout(() => {
        if (cancelled) return;
        setCompletedIds((prev) => [...prev, step.id]);
        stepIndex += 1;
        if (stepIndex < SESSION_BOOTSTRAP_STEPS.length) {
          runStep(SESSION_BOOTSTRAP_STEPS[stepIndex], stepIndex);
        } else {
          window.setTimeout(() => {
            if (!cancelled) onComplete?.();
          }, 500);
        }
      }, step.durationMs);
    };

    runStep(SESSION_BOOTSTRAP_STEPS[0], 0);

    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--genus-neutral-900)]/92 px-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-bootstrap-title"
      aria-describedby="os-bootstrap-description"
    >
      <div className="os-slide-up w-full max-w-lg rounded-[var(--os-radius)] border border-white/10 bg-[var(--genus-neutral-900)] p-8 shadow-[var(--genus-shadow-lg)]">
        <div className="flex items-center gap-4">
          <GenusOsLogo className="size-12 text-[var(--os-teal)]" />
          <div>
            <h2 id="os-bootstrap-title" className="text-lg font-semibold text-[var(--genus-text-inverse)]">
              Preparando tu espacio de trabajo
            </h2>
            <p id="os-bootstrap-description" className="mt-1 text-sm text-[var(--genus-neutral-400)]">
              Estamos asegurando el contexto operativo de tu ingreso.
            </p>
          </div>
        </div>

        <ol className="mt-8 space-y-3" aria-live="polite" aria-atomic="false">
          {SESSION_BOOTSTRAP_STEPS.map((step, index) => {
            const isComplete = completedIds.includes(step.id);
            const isActive = index === activeIndex && !isComplete;

            return (
              <li
                key={step.id}
                className={`flex items-center gap-3 rounded-[var(--os-radius-sm)] px-3 py-2.5 transition-colors ${
                  isActive ? "bg-white/8" : ""
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full border ${
                    isComplete
                      ? "border-[var(--os-teal)] bg-[var(--os-teal)] text-white"
                      : isActive
                        ? "border-[var(--os-teal)]/40 text-[var(--os-teal)]"
                        : "border-white/15 text-[var(--genus-neutral-500)]"
                  }`}
                  aria-hidden="true"
                >
                  {isComplete ? (
                    <Check className="size-3.5" />
                  ) : isActive ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span
                  className={`text-sm ${
                    isComplete || isActive
                      ? "font-medium text-[var(--genus-text-inverse)]"
                      : "text-[var(--genus-neutral-500)]"
                  }`}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
