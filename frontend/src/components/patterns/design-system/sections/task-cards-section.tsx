import { TaskCard } from "@/components/cards/task-card";
import { sampleTaskCard } from "@/mocks/design-system-samples";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function TaskCardsSection() {
  return (
    <DesignSystemSection
      id="task-cards"
      title="TaskCard"
      description="Gramática fija de trabajo: identidad · título · badge · metadatos · urgencia · acción."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">Default</p>
          <TaskCard {...sampleTaskCard} />
        </DesignSystemPanel>
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">Featured (Foco)</p>
          <TaskCard {...sampleTaskCard} variant="featured" />
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}
