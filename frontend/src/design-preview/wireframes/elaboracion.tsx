"use client";

import { TwinShell } from "@/design-preview/components/twin-shell";
import { ElaboracionOrderBlock } from "@/design-preview/components/elaboracion-order-block";
import { SectionLabel } from "@/design-preview/components/section-label";
import { ELABORACION_BLOCKS } from "@/design-preview/mock-data";

/** Layout horizontal kg-first — distinto a Envasado. */
export function WireframeElaboracion() {
  const hoy = ELABORACION_BLOCKS;

  return (
    <TwinShell contentClassName="max-w-4xl">
      <p className="mb-[var(--os-space-section)] text-3xl font-semibold tracking-tight">
        Hola Elaboración
      </p>

      <SectionLabel>Hoy</SectionLabel>
      <div className="flex flex-col gap-6">
        {hoy.map((block) => (
          <ElaboracionOrderBlock key={block.id} block={block} />
        ))}
      </div>
    </TwinShell>
  );
}
