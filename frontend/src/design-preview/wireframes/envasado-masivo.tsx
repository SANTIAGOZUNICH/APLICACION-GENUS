"use client";

import { OsShell } from "@/design-preview/components/os-shell";
import { SectionLabel, WorkOrderDivider } from "@/design-preview/components/section-label";
import { WorkOrderBlock } from "@/design-preview/components/work-order-block";
import { ENVASADO_MASIVO_BLOCKS } from "@/design-preview/mock-data";

export function WireframeEnvasadoMasivo() {
  const hoy = ENVASADO_MASIVO_BLOCKS.filter(
    (b) => b.delivery === "Hoy" && b.status !== "bloqueado"
  );
  const semana = ENVASADO_MASIVO_BLOCKS.filter(
    (b) => b.delivery !== "Hoy" && b.status !== "bloqueado"
  );
  const bloqueados = ENVASADO_MASIVO_BLOCKS.filter((b) => b.status === "bloqueado");
  const conOa = ENVASADO_MASIVO_BLOCKS.filter((b) => b.oaRef);

  return (
    <OsShell
      sectorLabel="Envasado Masivo"
      sectorEmail="emasivo@laboratoriogenus.com.ar"
    >
      <p className="mb-[var(--os-space-section)] text-3xl font-semibold tracking-tight">
        Hola Envasado Masivo
      </p>

      <SectionLabel>Hoy</SectionLabel>
      <div className="flex flex-col gap-[var(--os-space-block)]">
        {hoy.map((block) => (
          <WorkOrderBlock key={block.id} block={block} />
        ))}
      </div>

      <WorkOrderDivider />

      <SectionLabel>Esta semana</SectionLabel>
      <div className="flex flex-col gap-[var(--os-space-block)]">
        {semana.map((block) => (
          <WorkOrderBlock key={block.id} block={block} />
        ))}
      </div>

      {conOa.length > 0 && (
        <>
          <WorkOrderDivider />
          <SectionLabel>Mis OA</SectionLabel>
          <div className="flex flex-col gap-[var(--os-space-block)]">
            {conOa.map((block) => (
              <WorkOrderBlock key={`oa-${block.id}`} block={block} primaryAction="Abrir OA" />
            ))}
          </div>
        </>
      )}

      {bloqueados.length > 0 && (
        <>
          <WorkOrderDivider />
          <SectionLabel>Bloqueados</SectionLabel>
          <div className="flex flex-col gap-[var(--os-space-block)]">
            {bloqueados.map((block) => (
              <WorkOrderBlock key={block.id} block={block} />
            ))}
          </div>
        </>
      )}

      <div className="mt-12">
        <button
          type="button"
          className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] px-5 py-2.5 text-sm font-medium text-[var(--os-text)]"
        >
          Crear OA
        </button>
      </div>
    </OsShell>
  );
}
