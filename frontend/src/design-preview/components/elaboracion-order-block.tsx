import type { ElaboracionBlockMock } from "@/design-preview/mock-data";

const STATUS: Record<ElaboracionBlockMock["status"], string> = {
  pendiente: "🟡 Pendiente",
  en_curso: "🔵 En proceso",
  completo: "🟢 Terminado",
};

/** F9.1 — Home Elaboración: kg + OE al centro, layout distinto a Envasado. */
export function ElaboracionOrderBlock({ block }: { block: ElaboracionBlockMock }) {
  return (
    <article className="flex flex-col gap-8 rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-8 lg:flex-row lg:items-center lg:gap-12">
      <div className="shrink-0 text-center lg:w-40 lg:text-left">
        <p className="text-5xl font-light tabular-nums text-[var(--os-teal)]">{block.kg}</p>
        <p className="mt-1 text-sm font-medium uppercase tracking-widest text-[var(--os-text-muted)]">
          kg
        </p>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">
          {block.client}
        </p>
        <h3 className="mt-2 text-2xl font-semibold uppercase tracking-tight text-[var(--os-text)]">
          {block.product}
        </h3>
        <div className="mt-6 flex flex-wrap gap-8">
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">OE</p>
            <p className="mt-1 font-mono text-lg text-[var(--os-teal)]">{block.oe}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">
              Responsable
            </p>
            <p className="mt-1 text-lg">{block.responsable}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-[var(--os-text-muted)]">Estado</p>
            <p className="mt-1 text-lg font-medium">{STATUS[block.status]}</p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 lg:w-48">
        <button
          type="button"
          className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-4 py-3 text-sm font-semibold text-white"
        >
          Abrir OE
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" readOnly />
          Iniciar
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" readOnly />
          Finalizar
        </label>
        <button type="button" className="text-left text-sm text-[var(--os-text-muted)]">
          Observaciones
        </button>
      </div>
    </article>
  );
}
