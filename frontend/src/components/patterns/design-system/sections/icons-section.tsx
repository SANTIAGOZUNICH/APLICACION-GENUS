import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Factory,
  Info,
  Lock,
  Package,
  Play,
  Plus,
  Route,
  ScanBarcode,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { iconConcepts } from "@/lib/tokens/icons";
import { DesignSystemSection } from "@/components/patterns/design-system/design-system-section";

const iconMap = {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Ban,
  AlertOctagon,
  Play,
  Info,
  Plus,
  Lock,
  Truck,
  ScanBarcode,
  Route,
  Factory,
  ShieldCheck,
  Package,
} as const;

export function IconsSection() {
  return (
    <DesignSystemSection
      id="iconografia"
      title="Iconografía"
      description="Un ícono por concepto. Lucide React."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {iconConcepts.map(({ concept, icon }) => {
          const Icon = iconMap[icon as keyof typeof iconMap];
          return (
            <div
              key={concept}
              className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
            >
              {Icon && (
                <Icon className="size-5 shrink-0 text-[var(--muted-foreground)]" />
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[var(--foreground)]">
                  {concept}
                </p>
                <p className="text-[10px] text-[var(--muted-foreground)]">{icon}</p>
              </div>
            </div>
          );
        })}
      </div>
    </DesignSystemSection>
  );
}
