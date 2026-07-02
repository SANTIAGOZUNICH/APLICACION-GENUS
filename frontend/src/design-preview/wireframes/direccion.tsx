"use client";

import { OsShell } from "@/design-preview/components/os-shell";
import { DIRECCION_SIGNALS } from "@/design-preview/mock-data";

/** Panorama ejecutivo — señales, no operación. */
export function WireframeDireccion() {
  return (
    <OsShell
      sectorLabel="Dirección"
      sectorEmail="direccion@laboratoriogenus.com.ar"
      title="Dirección"
      showRestricted
      activeNav="direccion"
    >
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
    </OsShell>
  );
}
