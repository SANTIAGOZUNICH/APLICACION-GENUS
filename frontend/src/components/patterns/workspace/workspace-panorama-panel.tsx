import { Card } from "@/components/ui/card";
import type { WorkspacePanoramaMetric } from "@/types/workspace/workspace-task";

const toneColor: Record<WorkspacePanoramaMetric["tone"], string> = {
  ok: "var(--color-ok)",
  attention: "var(--color-attention)",
  problem: "var(--color-problem)",
  neutral: "var(--color-neutral)",
};

export interface WorkspacePanoramaPanelProps {
  metrics: WorkspacePanoramaMetric[];
}

export function WorkspacePanoramaPanel({ metrics }: WorkspacePanoramaPanelProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.id} padding="md" variant="default">
          <p
            className="text-2xl font-semibold tabular-nums"
            style={{ color: toneColor[metric.tone] }}
          >
            {metric.value}
          </p>
          <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
            {metric.label}
          </p>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            {metric.hint}
          </p>
        </Card>
      ))}
    </div>
  );
}
