import type { Metadata } from "next";
import { PageHeader } from "@/components/layouts/page-header";
import {
  DesignSystemCatalog,
  designSystemNav,
} from "@/components/patterns/design-system/design-system-catalog";

export const metadata: Metadata = {
  title: "Design System",
};

export default function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="Design System"
        description="Documentación visual oficial de Genus OS. Tokens, componentes y patrones reutilizables."
      />

      <nav
        aria-label="Secciones del design system"
        className="mb-8 flex flex-wrap gap-2"
      >
        {designSystemNav.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:border-[var(--color-action)]/30 hover:text-[var(--foreground)]"
          >
            {label}
          </a>
        ))}
      </nav>

      <DesignSystemCatalog />
    </>
  );
}
