/** Credencial institucional — sobria, sin sombras fuertes. */
export function OsInstitutionalCredential() {
  return (
    <div className="mt-14 max-w-sm border border-white/[0.08] bg-white/[0.03] px-6 py-5">
      <p className="text-[0.9375rem] font-medium leading-snug tracking-tight text-[var(--os-sidebar-text)]">
        Manufacturing Operating System
      </p>
      <p className="mt-2 text-[0.8125rem] text-[var(--os-sidebar-muted)]">Enterprise Edition</p>
      <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-[var(--os-teal)]/80">
        v0.9 Preview
      </p>
    </div>
  );
}
