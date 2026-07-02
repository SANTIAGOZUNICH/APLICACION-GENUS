"use client";

import { useState } from "react";
import Link from "next/link";
import { DesignPreviewCanvas, PREVIEW_SCREENS } from "@/design-preview/design-preview-canvas";
import type { PreviewScreenId } from "@/design-preview/config";

export function DesignPreviewApp() {
  const [activeScreen, setActiveScreen] = useState<PreviewScreenId>("envasado-masivo");

  return (
    <div className="design-preview-root flex min-h-dvh flex-col bg-[var(--os-bg)]">
      <header className="border-b border-[var(--os-border)] bg-[var(--os-surface)] px-6 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <h1 className="text-base font-semibold">F9.1 · Design Preview</h1>
          <Link href="/mi-trabajo" className="text-sm text-[var(--os-text-muted)] hover:text-[var(--os-teal)]">
            App actual →
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1">
        <nav className="hidden w-56 shrink-0 border-r border-[var(--os-border)] p-4 lg:block" aria-label="Wireframes">
          <ul className="space-y-1">
            {PREVIEW_SCREENS.map((screen) => (
              <li key={screen.id}>
                <button
                  type="button"
                  onClick={() => setActiveScreen(screen.id)}
                  className={`w-full rounded-[var(--os-radius-sm)] px-3 py-2 text-left text-sm ${
                    activeScreen === screen.id
                      ? "bg-[var(--os-teal-soft)] font-medium text-[var(--os-teal)]"
                      : "text-[var(--os-text-muted)] hover:bg-[var(--os-border-subtle)]"
                  }`}
                >
                  {screen.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 p-4 lg:p-6">
          <select
            value={activeScreen}
            onChange={(e) => setActiveScreen(e.target.value as PreviewScreenId)}
            className="mb-4 w-full rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-sm lg:hidden"
            aria-label="Wireframe"
          >
            {PREVIEW_SCREENS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>

          <DesignPreviewCanvas screenId={activeScreen} />
        </div>
      </div>
    </div>
  );
}
