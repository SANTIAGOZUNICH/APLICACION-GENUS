import type { WorkBlockMock } from "@/design-preview/mock-data";

const STATUS_LABEL: Record<WorkBlockMock["status"], { emoji: string; label: string }> = {
  pendiente: { emoji: "🟡", label: "Pendiente" },
  en_curso: { emoji: "🔵", label: "En proceso" },
  completo: { emoji: "🟢", label: "Terminado" },
  bloqueado: { emoji: "🔴", label: "Bloqueado" },
};

/** F9.1 — Orden de Trabajo (Envasado). Evolución SEMANAS, no fila ERP. */
export function WorkOrderBlock({
  block,
  primaryAction = "Abrir OA",
}: {
  block: WorkBlockMock;
  primaryAction?: string;
}) {
  const status = STATUS_LABEL[block.status];
  const deliveryUpper = block.delivery.toUpperCase();

  return (
    <article className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-8 py-10">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--os-teal)]">
        {block.line}
      </p>

      <h3 className="mt-6 text-2xl font-semibold tracking-tight text-[var(--os-text)]">
        {block.client}
      </h3>
      <p className="mt-2 text-xl font-medium uppercase tracking-wide text-[var(--os-text)]">
        {block.product}
      </p>
      <p className="mt-4 text-3xl font-light tabular-nums text-[var(--os-text)]">
        {block.presentation}
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">Entrega</p>
          <p
            className={`mt-1 text-lg font-semibold ${
              block.delivery === "Hoy" ? "text-amber-700" : "text-[var(--os-text)]"
            }`}
          >
            {deliveryUpper}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">Estado</p>
          <p className="mt-1 text-lg font-semibold">
            {status.emoji} {status.label}
          </p>
        </div>
        {block.oaRef && (
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">OA</p>
            <p className="mt-1 font-mono text-lg text-[var(--os-teal)]">{block.oaRef}</p>
          </div>
        )}
        {block.priority && (
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">
              Prioridad
            </p>
            <p className="mt-1 text-lg font-semibold">{block.priority}</p>
          </div>
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-6 py-3 text-sm font-semibold text-white"
        >
          {primaryAction}
        </button>
        {block.status !== "completo" && (
          <label className="flex cursor-pointer items-center gap-3 text-base text-[var(--os-text)]">
            <input type="checkbox" className="size-5 rounded border-[var(--os-border)]" readOnly />
            Trabajo terminado
          </label>
        )}
        <button type="button" className="text-sm text-[var(--os-text-muted)] hover:text-[var(--os-teal)]">
          Reportar problema
        </button>
      </div>
    </article>
  );
}
