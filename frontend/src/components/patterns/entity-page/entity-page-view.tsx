import { EntityActivityLog } from "@/components/patterns/entity-page/entity-activity-log";
import { EntityHeader } from "@/components/patterns/entity-page/entity-header";
import { EntityPageLayout } from "@/components/patterns/entity-page/entity-page-layout";
import { EntityPageSections } from "@/components/patterns/entity-page/entity-page-sections";
import { EntityRelatedObjects } from "@/components/patterns/entity-page/entity-related-objects";
import { EntityStatusFlow } from "@/components/patterns/entity-page/entity-status-flow";
import type { EntityPageModel } from "@/types/entity-page";

interface EntityPageViewProps {
  model: EntityPageModel;
  backHref?: string;
  backLabel?: string;
}

/**
 * EntityPageView — generic shell for all entity pages.
 * Every entity (OE, Lote, OA, Pedido, Liberación, …) renders through here.
 */
export function EntityPageView({
  model,
  backHref,
  backLabel,
}: EntityPageViewProps) {
  return (
    <EntityPageLayout
      backHref={backHref}
      backLabel={backLabel}
      sidebar={
        <>
          <EntityActivityLog entries={model.activityLog} />
          <EntityRelatedObjects objects={model.relatedObjects} />
        </>
      }
    >
      <EntityStatusFlow
        flujo={model.statusFlow}
        etapaActual={model.currentStageId}
      />

      <EntityHeader
        entityId={model.entityId}
        title={model.title}
        subtitle={model.subtitle}
        status={model.status}
        identityIcon={model.identityIcon}
        primaryAction={model.primaryAction}
        secondaryActions={model.secondaryActions}
      />

      <EntityPageSections sections={model.sections} />
    </EntityPageLayout>
  );
}
