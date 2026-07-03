"use client";

import { useEffect, useState } from "react";
import { GenusOsLogo } from "./genus-os-logo";
import { SESSION_BOOTSTRAP_STEPS } from "../lib/session-bootstrap-steps";

interface OsSessionBootstrapScreenProps {
  visible?: boolean;
  onComplete?: () => void;
}

/** Secuencia premium de inicialización — Access Preview UI. */
export function OsSessionBootstrapScreen({
  visible = true,
  onComplete,
}: OsSessionBootstrapScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [fadeLabel, setFadeLabel] = useState(true);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    let index = 0;

    const advance = () => {
      if (cancelled) return;

      const step = SESSION_BOOTSTRAP_STEPS[index];
      if (!step) {
        window.setTimeout(() => {
          if (!cancelled) onComplete?.();
        }, 400);
        return;
      }

      setFadeLabel(false);
      window.setTimeout(() => {
        if (cancelled) return;
        setStepIndex(index);
        setFadeLabel(true);
      }, 120);

      window.setTimeout(() => {
        if (cancelled) return;
        index += 1;
        advance();
      }, step.durationMs);
    };

    advance();

    return () => {
      cancelled = true;
    };
  }, [visible, onComplete]);

  const currentLabel = SESSION_BOOTSTRAP_STEPS[stepIndex]?.label ?? "Sistema listo.";
  const progress = Math.min(
    100,
    ((stepIndex + 1) / SESSION_BOOTSTRAP_STEPS.length) * 100
  );

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[var(--genus-neutral-900)]/88 px-6 backdrop-blur-sm transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-bootstrap-title"
      aria-live="polite"
    >
      <div className="w-full max-w-md text-center">
        <GenusOsLogo className="mx-auto size-11 text-[var(--os-teal)]" />
        <h2
          id="os-bootstrap-title"
          className={`mt-8 text-lg font-medium tracking-tight text-[var(--genus-text-inverse)] transition-opacity duration-200 ${
            fadeLabel ? "opacity-100" : "opacity-0"
          }`}
        >
          {currentLabel}
        </h2>
        <div className="mx-auto mt-10 h-0.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[var(--os-teal)] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-6 text-xs text-[var(--genus-neutral-500)]">
          Vista previa de acceso · inicialización simulada
        </p>
      </div>
    </div>
  );
}
