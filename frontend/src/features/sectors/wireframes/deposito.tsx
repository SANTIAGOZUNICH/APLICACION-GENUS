"use client";

import { TwinShell } from "@/design-preview/components/twin-shell";
import { SectionLabel } from "@/design-preview/components/section-label";
import { DEPOSITO_ORDERS } from "../mock-data/mock-data";

/** Checklist de preparación — layout único Depósito. */
export function WireframeDeposito() {
  return (
    <TwinShell title="Preparación" contentClassName="max-w-2xl">
      <p className="mb-[var(--os-space-section)] text-3xl font-semibold tracking-tight">
        Hola Depósito
      </p>

      <SectionLabel>Preparar</SectionLabel>

      <div className="flex flex-col gap-10">
        {DEPOSITO_ORDERS.map((order) => (
          <article
            key={order.id}
            className="rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] p-8"
          >
            <h3 className="text-xl font-semibold">{order.client}</h3>
            <p className="mt-1 text-lg">{order.product}</p>
            <p className="mt-2 text-2xl font-light tabular-nums text-[var(--os-teal)]">
              {order.quantity}
            </p>

            <div className="mt-8 space-y-5">
              {(
                [
                  ["Envases", order.envases],
                  ["Tapas", order.tapas],
                  ["Etiquetas", order.etiquetas],
                  ["Cajas", order.cajas],
                ] as const
              ).map(([label, needed]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-[var(--os-border-subtle)] pb-4 last:border-0"
                >
                  <div>
                    <p className="font-medium">{label}</p>
                    <p className="text-sm text-[var(--os-text-muted)]">
                      Necesarios {needed.toLocaleString()}
                    </p>
                  </div>
                  <input
                    type="number"
                    placeholder="0"
                    className="w-28 rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-3 py-2 text-right text-lg tabular-nums"
                    readOnly
                  />
                </div>
              ))}
            </div>

            <label className="mt-8 flex items-center gap-3 text-base">
              <input type="checkbox" className="size-5" readOnly />
              Listo
            </label>
          </article>
        ))}
      </div>
    </TwinShell>
  );
}
