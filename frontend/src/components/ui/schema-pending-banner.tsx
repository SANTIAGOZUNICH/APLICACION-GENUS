"use client";

/** Banner cuando migración 0005 no está aplicada. */
export function SchemaPendingBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="alert"
      data-testid="schema-pending-banner"
    >
      Base de datos pendiente de actualización. Los cambios están deshabilitados.
    </div>
  );
}
