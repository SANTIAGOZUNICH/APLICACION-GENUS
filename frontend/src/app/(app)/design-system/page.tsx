import type { Metadata } from "next";
import { GenusDesignSystemGuide } from "@/design-system/guide/genus-design-system-guide";
import { genusDesignSystemNav } from "@/design-system/guide/nav";

export const metadata: Metadata = {
  title: "Genus Design System",
  description: "Manual visual oficial de Genus OS — tokens, reglas e identidad F9.5.",
};

export default function DesignSystemPage() {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-6 py-8 lg:px-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-accent,#1fa39a)]">
          F9.5 · Genus OS
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Design System oficial
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Base visual de todo Genus OS. Tokens centralizados en{" "}
          <code className="rounded bg-[var(--border)]/30 px-1.5 py-0.5 font-mono text-xs">
            src/design-system/
          </code>
          . A partir de F10, ninguna pantalla nueva puede romper estas reglas.
        </p>

        <nav aria-label="Secciones del design system" className="mt-6 flex flex-wrap gap-2">
          {genusDesignSystemNav.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--color-accent,#1fa39a)]/40 hover:text-[var(--foreground)]"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
        <GenusDesignSystemGuide />
      </main>
    </div>
  );
}
