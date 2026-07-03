import { QuickAction } from "./quick-action";

interface WorkspaceHeroProps {
  sectorLabel: string;
  title: string;
  subtitle: string;
  roleLine?: string;
  ctaLabel: string;
  onCta: () => void;
}

export function WorkspaceHero({
  sectorLabel,
  title,
  subtitle,
  roleLine,
  ctaLabel,
  onCta,
}: WorkspaceHeroProps) {
  return (
    <section className="rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-6 py-8 transition-shadow duration-200 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-[var(--os-text-muted)]">
        {sectorLabel}
      </p>
      <h2 className="mt-4 text-[1.75rem] font-semibold tracking-tight text-[var(--os-text)] sm:text-[2rem] lg:text-[2.25rem]">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-[var(--os-text-muted)] sm:text-lg">
        {subtitle}
      </p>
      {roleLine && (
        <p className="mt-2 text-sm text-[var(--os-text-muted)]">{roleLine}</p>
      )}
      <div className="mt-8">
        <QuickAction label={ctaLabel} onClick={onCta} variant="primary" />
      </div>
    </section>
  );
}
