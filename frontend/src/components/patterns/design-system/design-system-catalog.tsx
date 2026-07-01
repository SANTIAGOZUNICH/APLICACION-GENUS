import { ColorsSection } from "@/components/patterns/design-system/sections/colors-section";
import { TypographySection } from "@/components/patterns/design-system/sections/typography-section";
import { ButtonsSection } from "@/components/patterns/design-system/sections/buttons-section";
import { IconsSection } from "@/components/patterns/design-system/sections/icons-section";
import { StatusBadgesSection } from "@/components/patterns/design-system/sections/status-badges-section";
import { CardsSection } from "@/components/patterns/design-system/sections/cards-section";
import { TaskCardsSection } from "@/components/patterns/design-system/sections/task-cards-section";
import { ChipsSection } from "@/components/patterns/design-system/sections/chips-section";
import { AlertsSection } from "@/components/patterns/design-system/sections/alerts-section";
import { EmptyStatesSection } from "@/components/patterns/design-system/sections/empty-states-section";
import { TablesSection } from "@/components/patterns/design-system/sections/tables-section";
import { FormsSection } from "@/components/patterns/design-system/sections/forms-section";
import { EntityCardsSection } from "@/components/patterns/design-system/sections/entity-cards-section";

export const designSystemNav = [
  { id: "colores", label: "Colores" },
  { id: "tipografia", label: "Tipografía" },
  { id: "botones", label: "Botones" },
  { id: "iconografia", label: "Iconografía" },
  { id: "estados", label: "Estados" },
  { id: "cards", label: "Card base" },
  { id: "task-cards", label: "TaskCard" },
  { id: "chips", label: "Chips" },
  { id: "alertas", label: "Alertas" },
  { id: "empty-states", label: "Empty states" },
  { id: "tablas", label: "Tablas" },
  { id: "formularios", label: "Formularios" },
  { id: "entity-cards", label: "Cards GMP" },
] as const;

export function DesignSystemCatalog() {
  return (
    <>
      <ColorsSection />
      <TypographySection />
      <ButtonsSection />
      <IconsSection />
      <StatusBadgesSection />
      <CardsSection />
      <TaskCardsSection />
      <ChipsSection />
      <AlertsSection />
      <EmptyStatesSection />
      <TablesSection />
      <FormsSection />
      <EntityCardsSection />
    </>
  );
}
