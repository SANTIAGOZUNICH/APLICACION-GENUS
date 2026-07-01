import type { Metadata } from "next";
import { Clock, Inbox } from "lucide-react";
import { PageHeader } from "@/components/layouts/page-header";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Mi Trabajo",
};

export default function BandejaPage() {
  return (
    <>
      <PageHeader
        title="Mi Trabajo"
        description={siteConfig.tagline}
      />

      {/* Foco placeholder — Entrega 3 */}
      <section
        className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-sm"
        aria-label="Próxima tarea"
      >
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-[var(--sidebar-item-active-bg)]">
            <Inbox className="size-7 text-[var(--color-action)]" strokeWidth={1.75} />
          </div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-action)]">
            Tu foco
          </p>
          <h2
            className="mb-3 max-w-md font-semibold text-[var(--foreground)]"
            style={{ fontSize: "var(--text-section)" }}
          >
            Acá aparecerá lo próximo que tenés que hacer
          </h2>
          <p
            className="mb-8 max-w-sm text-[var(--muted-foreground)]"
            style={{ fontSize: "var(--text-body)" }}
          >
            Sin navegar módulos. Sin buscar en tablas. El sistema te dirá qué sigue.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--badge-neutral-bg)] px-3 py-1 text-xs font-medium text-[var(--badge-neutral-text)]">
              <Clock className="size-3.5" />
              Entrega 3 · Bandeja completa
            </span>
          </div>
        </div>
      </section>

      {/* Guía de las 4 preguntas — principios de producto */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Principios de la bandeja">
        {[
          { q: "¿Qué tengo que hacer?", hint: "El Foco — una tarea clara" },
          { q: "¿Qué es urgente?", hint: "Problemas — arriba, siempre visible" },
          { q: "¿Qué puede esperar?", hint: "En cola — ordenado por prioridad" },
          { q: "¿Cuál es el siguiente paso?", hint: "Una acción primaria por card" },
        ].map((item) => (
          <div
            key={item.q}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-4"
          >
            <p className="mb-1 text-sm font-medium text-[var(--foreground)]">{item.q}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{item.hint}</p>
          </div>
        ))}
      </section>
    </>
  );
}
