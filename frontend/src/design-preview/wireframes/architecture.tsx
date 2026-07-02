"use client";

export function WireframeArchitecture() {
  return (
    <div className="max-w-3xl rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-10">
      <h2 className="text-2xl font-semibold">F9.1 — Arquitectura visual</h2>

      <div className="mt-10 space-y-10">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Regla de oro
          </h3>
          <p className="mt-3 text-lg leading-relaxed">
            ¿Un operario entiende qué hacer en menos de 5 segundos? Si no → rediseñar.
          </p>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Sin dashboard operativo
          </h3>
          <p className="mt-3 text-[var(--os-text-muted)]">
            KPIs, gráficos y widgets solo en Producción y Dirección. Operarios ven trabajo.
          </p>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Orden de Trabajo
          </h3>
          <pre className="mt-3 overflow-x-auto rounded-[var(--os-radius-sm)] bg-[var(--os-bg)] p-6 text-sm leading-relaxed text-[var(--os-text)]">
{`LÍNEA 2
THELMA Y LOUISE
EXFOLIANTE ARROZ
3300 × 160 g
Entrega · HOY
Estado · Pendiente
[ Abrir OA ]
☐ Trabajo terminado`}
          </pre>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            Sectores = apps distintas
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-[var(--os-text-muted)]">
            <li>Envasado — bloques por línea</li>
            <li>Elaboración — kg + OE horizontal</li>
            <li>Calidad — mesa de laboratorio</li>
            <li>Depósito — checklist insumos</li>
            <li>Producción — problemas + barras</li>
            <li>Dirección — señales estratégicas</li>
          </ul>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
            SEMANAS 2026
          </h3>
          <p className="mt-3 text-[var(--os-text-muted)]">
            Misma lógica: línea · día · cliente · producto · cantidad. Nueva estética.
          </p>
        </section>
      </div>
    </div>
  );
}
