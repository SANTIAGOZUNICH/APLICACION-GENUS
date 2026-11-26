"use client";

import { useEffect, useState } from "react";
import { fetchMap } from "@/lib/ubicaciones/client";
import { fieldCls } from "./ubicaciones-dialogs";

/**
 * Selector OPCIONAL «Ubicación física» del formulario de INGRESO de ME. Solo lista posiciones activas (con su estado). Si el sector no puede
 * consultar el mapa o falla la carga, no se muestra y el ingreso se carga como siempre (la columna de texto UBICACIÓN no se toca).
 */
export function IngresoUbicacionSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    fetchMap()
      .then((m) => {
        if (!alive || !m.capabilities.write) return;
        setOptions(m.locations.filter((l) => l.active).map((l) => ({ id: l.id, label: `${l.code} · ${l.items.length ? `Ocupada (${[...new Set(l.items.map((i) => i.clientName))].join(", ")})` : "Libre"}` })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!options) return null;
  return (
    <label className="mt-3 flex flex-col gap-1 text-sm" data-testid="ingreso-ubicacion-fisica">
      <span>UBICACIÓN FÍSICA EN EL MAPA <span className="text-[var(--os-text-muted)]">(opcional)</span></span>
      <select className={`${fieldCls} !mt-0`} value={value} onChange={(e) => onChange(e.target.value)} data-testid="ingreso-ubicacion-select">
        <option value="">No asignar ahora</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <span className="text-xs text-[var(--os-text-muted)]">Se suma el total del ingreso a esa posición del mapa. No cambia el stock.</span>
    </label>
  );
}
