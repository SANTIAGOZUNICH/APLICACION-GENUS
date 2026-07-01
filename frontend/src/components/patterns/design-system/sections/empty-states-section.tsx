import { CheckCircle2, Inbox } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function EmptyStatesSection() {
  return (
    <DesignSystemSection
      id="empty-states"
      title="EmptyState"
      description="Tono positivo cuando no hay trabajo pendiente."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <DesignSystemPanel>
          <EmptyState
            icon={Inbox}
            title="No tenés tareas pendientes"
            description="Cuando aparezca trabajo nuevo, lo verás acá primero."
            tone="positive"
          />
        </DesignSystemPanel>
        <DesignSystemPanel>
          <EmptyState
            icon={CheckCircle2}
            title="Sin resultados"
            description="Probá ajustar los filtros o buscar otro término."
            action={{ label: "Limpiar filtros", variant: "secondary" }}
          />
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}
