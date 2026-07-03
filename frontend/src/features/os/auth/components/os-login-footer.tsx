/** Footer global login — información mínima. */
export function OsLoginFooter() {
  return (
    <footer className="flex shrink-0 flex-col gap-3 border-t border-[var(--os-border-subtle)] bg-[var(--os-surface)] px-6 py-4 text-[0.6875rem] text-[var(--os-text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-12">
      <div className="space-y-0.5">
        <p className="font-medium text-[var(--os-text)]">Genus OS</p>
        <p>Enterprise Preview</p>
        <p>© Laboratorio Genus</p>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <span className="tabular-nums text-[var(--os-text-muted)]">v0.9</span>
        <span
          className="rounded border border-[var(--os-border)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--os-text)]"
          aria-label="Idioma: Español"
        >
          ES
        </span>
      </div>
    </footer>
  );
}
