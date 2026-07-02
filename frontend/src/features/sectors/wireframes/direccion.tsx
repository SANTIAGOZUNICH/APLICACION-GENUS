"use client";

import { TwinShell } from "@/features/os/shell/twin-shell";
import { DIRECCION_SIGNALS } from "../mock-data/mock-data";

/** Panorama ejecutivo — señales, no operación. */
export function WireframeDireccion() {
  return (
    <TwinShell title="Dirección">
      <p className="mb-12 text-3xl font-semibold tracking-tight">Hola Dirección</p>

      <div className="grid max-w-3xl gap-8">
        {DIRECCION_SIGNALS.map((item) => (
          <div
            key={item.area}
            className="border-b border-[var(--os-border-subtle)] pb-8 last:border-0"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
              {item.area}
            </p>
            <p className="mt-2 text-2xl font-light text-[var(--os-text)]">{item.signal}</p>
          </div>
        ))}
      </div>
    </TwinShell>
  );
}
