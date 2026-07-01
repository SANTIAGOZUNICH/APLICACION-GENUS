import { semanticColors } from "@/lib/tokens/colors";
import { DesignSystemSection } from "@/components/patterns/design-system/design-system-section";

export function ColorsSection() {
  return (
    <DesignSystemSection
      id="colores"
      title="Colores semánticos"
      description="Un significado = un color. Nunca decorativo."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(semanticColors).map(([key, { hex, label }]) => (
          <div
            key={key}
            className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="h-16" style={{ backgroundColor: hex }} />
            <div className="p-4">
              <p className="font-mono text-xs text-[var(--muted-foreground)]">{hex}</p>
              <p className="mt-1 text-sm font-medium text-[var(--foreground)]">{label}</p>
              <p className="text-xs text-[var(--muted-foreground)]">--color-{key}</p>
            </div>
          </div>
        ))}
      </div>
    </DesignSystemSection>
  );
}
