"use client";

import { EmptyState } from "@/features/work/components/empty-state";
import { TwinShell } from "@/features/os/shell/twin-shell";
import { usePreviewContext } from "@/features/os/session/preview-context";

/** Vistas auxiliares del sidebar — simuladas en F9.6. */
export function TwinStubView({ title, message }: { title: string; message: string }) {
  return (
    <TwinShell title={title}>
      <EmptyState title={title} message={message} />
    </TwinShell>
  );
}

export function TwinInsumosView() {
  return (
    <TwinStubView
      title="Insumos"
      message="Preparación de envases, tapas y etiquetas. En F10 se conectará con el flujo de Depósito."
    />
  );
}

export function TwinConfigView() {
  return (
    <TwinStubView
      title="Configuración"
      message="Preferencias del puesto. Acciones simuladas en el Digital Twin."
    />
  );
}

