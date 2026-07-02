"use client";

import { EmptyState } from "@/design-preview/components/empty-state";
import { TwinShell } from "@/design-preview/components/twin-shell";
import { usePreviewContext } from "@/design-preview/lib/preview-context";

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

export function TwinCalidadNavView() {
  const { navigateSidebar } = usePreviewContext();
  return (
    <TwinShell title="Calidad">
      <EmptyState
        title="Mesa de Calidad"
        message="Accedé al sector Calidad desde el login para la experiencia completa de laboratorio."
        action={
          <button
            type="button"
            onClick={() => navigateSidebar("mi_trabajo")}
            className="rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Volver a mi trabajo
          </button>
        }
      />
    </TwinShell>
  );
}
