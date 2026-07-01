import {
  LiberacionCard,
  LoteCard,
  OACard,
  OECard,
  PedidoCard,
} from "@/components/cards";
import {
  sampleLiberacionCard,
  sampleLoteCard,
  sampleOACard,
  sampleOECard,
  samplePedidoCard,
} from "@/mocks/design-system-samples";
import {
  DesignSystemPanel,
  DesignSystemSection,
} from "@/components/patterns/design-system/design-system-section";

export function EntityCardsSection() {
  return (
    <DesignSystemSection
      id="entity-cards"
      title="Cards GMP (EntityCard)"
      description="Jerarquía: EntityCard → OECard, OACard, LoteCard, LiberacionCard, PedidoCard. Reutilizables en Bandeja y Object Pages."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">OECard</p>
          <OECard {...sampleOECard} />
        </DesignSystemPanel>
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">OACard</p>
          <OACard {...sampleOACard} />
        </DesignSystemPanel>
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">LoteCard</p>
          <LoteCard {...sampleLoteCard} />
        </DesignSystemPanel>
        <DesignSystemPanel>
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">LiberacionCard</p>
          <LiberacionCard {...sampleLiberacionCard} />
        </DesignSystemPanel>
        <DesignSystemPanel className="lg:col-span-2">
          <p className="mb-3 text-xs font-medium text-[var(--muted-foreground)]">PedidoCard</p>
          <PedidoCard {...samplePedidoCard} />
        </DesignSystemPanel>
      </div>
    </DesignSystemSection>
  );
}
