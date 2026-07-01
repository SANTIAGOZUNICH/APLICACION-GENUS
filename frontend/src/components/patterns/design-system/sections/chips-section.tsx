"use client";

import { Chip } from "@/components/ui/chip";
import { sampleChips } from "@/mocks/design-system-samples";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function ChipsSection() {
  return (
    <DesignSystemSection
      id="chips"
      title="Chip"
      description="Metadato o filtro. Neutro por defecto — no usar para estado (eso es StatusBadge)."
    >
      <DesignSystemPanel>
        <div className="flex flex-wrap gap-2">
          {sampleChips.map((label) => (
            <Chip key={label}>{label}</Chip>
          ))}
          <Chip variant="selected">Seleccionado</Chip>
          <Chip variant="outline">Outline</Chip>
          <Chip removable onRemove={() => undefined}>
            Removible
          </Chip>
        </div>
      </DesignSystemPanel>
    </DesignSystemSection>
  );
}
