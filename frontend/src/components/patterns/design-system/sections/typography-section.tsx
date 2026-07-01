import { typographyScale } from "@/lib/tokens/typography";
import { DesignSystemSection } from "@/components/patterns/design-system/design-system-section";

export function TypographySection() {
  return (
    <DesignSystemSection
      id="tipografia"
      title="Tipografía — Inter"
      description="Jerarquía por tamaño y peso. El color es semántico, no decorativo."
    >
      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        {typographyScale.map((row, i) => (
          <div
            key={row.role}
            className={`flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-baseline sm:gap-8 ${
              i > 0 ? "border-t border-[var(--border-subtle)]" : ""
            }`}
          >
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">{row.role}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {row.size} · {row.weight}
              </p>
            </div>
            <p
              style={{ fontSize: row.size, fontWeight: row.weight }}
              className="text-[var(--foreground)]"
            >
              {row.sample}
            </p>
          </div>
        ))}
      </div>
    </DesignSystemSection>
  );
}
