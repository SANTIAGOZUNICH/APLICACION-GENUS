import type { Metadata } from "next";
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
import { PageHeader } from "@/components/layouts/page-header";
import { Button } from "@/components/ui/button";
import { semanticColors } from "@/lib/tokens/colors";
import { iconConcepts } from "@/lib/tokens/icons";
import { typographyScale } from "@/lib/tokens/typography";

export const metadata: Metadata = {
  title: "Design System",
};

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

export default function DesignSystemPage() {
  return (
    <>
      <PageHeader
        title="Design System"
        description="Tokens, tipografía e iconografía de Genus OS. Referencia interna del equipo."
      />

      {/* Colors */}
      <section className="mb-12">
        <h2
          className="mb-4 font-semibold text-[var(--foreground)]"
          style={{ fontSize: "var(--text-section)" }}
        >
          Colores semánticos
        </h2>
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">
          Un significado = un color. Nunca decorativo.
        </p>
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
      </section>

      {/* Typography */}
      <section className="mb-12">
        <h2
          className="mb-4 font-semibold text-[var(--foreground)]"
          style={{ fontSize: "var(--text-section)" }}
        >
          Tipografía — Inter
        </h2>
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
                style={{
                  fontSize: row.size,
                  fontWeight: row.weight,
                }}
                className="text-[var(--foreground)]"
              >
                {row.sample}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Buttons preview */}
      <section className="mb-12">
        <h2
          className="mb-4 font-semibold text-[var(--foreground)]"
          style={{ fontSize: "var(--text-section)" }}
        >
          Botones
        </h2>
        <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <Button variant="primary">Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="tertiary">Terciario</Button>
          <Button variant="destructive">Destructivo</Button>
          <Button variant="primary" size="lg">
            Grande (planta)
          </Button>
        </div>
      </section>

      {/* Iconography */}
      <section>
        <h2
          className="mb-4 font-semibold text-[var(--foreground)]"
          style={{ fontSize: "var(--text-section)" }}
        >
          Iconografía
        </h2>
        <p className="mb-6 text-sm text-[var(--muted-foreground)]">
          Un ícono por concepto. Lucide React.
        </p>
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
      </section>
    </>
  );
}
