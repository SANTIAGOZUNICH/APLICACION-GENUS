/** Banner TEMP — Access Preview, no autenticación real. */
export function OsAuthMockBanner() {
  return (
    <div
      role="status"
      className="border-b border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)] px-4 py-2 text-center text-[0.6875rem] tracking-wide text-[var(--os-text-muted)]"
    >
      Vista previa de acceso · credenciales mock internas · sin autenticación real
    </div>
  );
}
