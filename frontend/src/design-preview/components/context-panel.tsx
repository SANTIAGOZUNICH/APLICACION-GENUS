import { AlertCircle, CalendarClock, Sparkles } from "lucide-react";

interface DeliveryItem {
  client: string;
  product: string;
  when: string;
}

interface ContextPanelProps {
  upcomingDeliveries: DeliveryItem[];
  problems: string[];
  creamyHint?: string;
}

/** Panel lateral — entregas, problemas y Creamy contextual. */
export function ContextPanel({
  upcomingDeliveries,
  problems,
  creamyHint = "¿Necesitás ayuda con el trabajo de hoy?",
}: ContextPanelProps) {
  return (
    <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
      <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-[var(--os-teal)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Próximas entregas</h2>
        </div>
        {upcomingDeliveries.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--os-text-muted)]">Sin entregas próximas</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcomingDeliveries.map((item) => (
              <li
                key={`${item.client}-${item.product}`}
                className="rounded-[var(--os-radius-sm)] bg-[var(--os-bg)] px-3 py-3"
              >
                <p className="text-sm font-medium text-[var(--os-text)]">{item.client}</p>
                <p className="mt-0.5 text-xs text-[var(--os-text-muted)]">{item.product}</p>
                <p className="mt-1.5 text-xs font-semibold text-amber-700">{item.when}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <AlertCircle className="size-4 text-rose-500" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Problemas / faltantes</h2>
        </div>
        {problems.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--os-text-muted)]">Sin problemas reportados</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {problems.map((problem) => (
              <li
                key={problem}
                className="rounded-[var(--os-radius-sm)] border border-rose-100 bg-rose-50/80 px-3 py-2.5 text-sm text-rose-900"
              >
                {problem}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[var(--os-radius)] border border-[var(--os-teal-muted)] bg-gradient-to-br from-[var(--os-teal-soft)] to-[var(--os-surface)] p-5 shadow-[var(--os-shadow-sm)]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[var(--os-teal)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--os-text)]">Creamy AI</h2>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--os-text-muted)]">{creamyHint}</p>
        <button
          type="button"
          className="mt-4 w-full rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Abrir asistente
        </button>
      </section>
    </aside>
  );
}
