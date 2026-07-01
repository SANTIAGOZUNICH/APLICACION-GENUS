import { StatusBadge } from "@/components/ui/status-badge";
import { EntityAuditTableView } from "@/components/patterns/entity-page/entity-audit-table";
import { EntityKeyValueList } from "@/components/patterns/entity-page/entity-key-value-list";
import { EntityPageSection } from "@/components/patterns/entity-page/entity-page-section";
import type {
  EntityPageSectionContent,
  EntityPageSectionData,
  EntitySectionCard,
} from "@/types/entity-page";

function EntitySectionCards({ cards }: { cards: readonly EntitySectionCard[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <article
          key={card.id}
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--background)] p-4"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <h4
              className="font-medium text-[var(--foreground)]"
              style={{ fontSize: "var(--text-card-title)" }}
            >
              {card.title}
            </h4>
            {card.status && <StatusBadge status={card.status} size="sm" />}
          </div>
          {card.description && (
            <p
              className="mb-3 text-[var(--muted-foreground)]"
              style={{ fontSize: "var(--text-meta)" }}
            >
              {card.description}
            </p>
          )}
          <EntityKeyValueList items={card.items} columns={1} />
        </article>
      ))}
    </div>
  );
}

function renderSectionContent(content: EntityPageSectionContent) {
  switch (content.type) {
    case "key-values":
      return <EntityKeyValueList items={content.items} />;
    case "cards":
      return <EntitySectionCards cards={content.cards} />;
    case "audit-table":
      return <EntityAuditTableView table={content.table} />;
    default:
      return null;
  }
}

interface EntityPageSectionsProps {
  sections: readonly EntityPageSectionData[];
}

/** EntityPageSections — renders all content sections from structured data. */
export function EntityPageSections({ sections }: EntityPageSectionsProps) {
  return (
    <>
      {sections.map((section) => (
        <EntityPageSection
          key={section.id}
          title={section.title}
          description={section.description}
        >
          {renderSectionContent(section.content)}
        </EntityPageSection>
      ))}
    </>
  );
}
