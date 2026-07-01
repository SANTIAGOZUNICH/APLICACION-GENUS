"use client";

import { EntityPageContainer } from "@/components/patterns/actions/entity-page-container";
import { EntityPageNotFound } from "@/components/patterns/entity-page/entity-page-not-found";
import { MockRoleSwitcher } from "@/components/patterns/actions/mock-role-switcher";
import { useOperationsStore } from "@/lib/operations/operations-store";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";

interface EntityPageClientProps {
  kind: EntityPageKind;
  entityId: string;
}

export function EntityPageClient({ kind, entityId }: EntityPageClientProps) {
  const { state } = useOperationsStore();
  const exists = Boolean(state.entityPages[entityPageKey(kind, entityId)]);

  if (!exists) {
    return (
      <EntityPageNotFound
        entityLabel={kind.toUpperCase()}
        entityId={entityId}
      />
    );
  }

  return (
    <>
      <MockRoleSwitcher />
      <EntityPageContainer kind={kind} entityId={entityId} />
    </>
  );
}
