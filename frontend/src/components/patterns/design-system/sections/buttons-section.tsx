import { Button } from "@/components/ui/button";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function ButtonsSection() {
  return (
    <DesignSystemSection
      id="botones"
      title="Botones"
      description="Un primario por pantalla. Destructivo solo para acciones irreversibles."
    >
      <DesignSystemPanel>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="tertiary">Terciario</Button>
          <Button variant="destructive">Destructivo</Button>
          <Button variant="primary" size="lg">
            Grande (planta)
          </Button>
        </div>
      </DesignSystemPanel>
    </DesignSystemSection>
  );
}
