"use client";

import { OsShell } from "@/design-preview/components/os-shell";
import { SectionLabel, WorkOrderDivider } from "@/design-preview/components/section-label";
import { WorkOrderBlock } from "@/design-preview/components/work-order-block";
import { ENVASADO_PREMIUM_BLOCKS } from "@/design-preview/mock-data";

export function WireframeEnvasadoPremium() {
  const hoy = ENVASADO_PREMIUM_BLOCKS.filter((b) => b.delivery === "Hoy");
  const semana = ENVASADO_PREMIUM_BLOCKS.filter((b) => b.delivery !== "Hoy");

  return (
    <OsShell
      sectorLabel="Envasado Premium"
      sectorEmail="epremium@laboratoriogenus.com.ar"
    >
      <p className="mb-[var(--os-space-section)] text-3xl font-semibold tracking-tight">
        Hola Envasado Premium
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
    </OsShell>
  );
}
