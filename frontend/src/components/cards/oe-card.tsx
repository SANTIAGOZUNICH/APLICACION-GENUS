import { Factory } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

export interface OECardProps {
  oeId: string;
  productName: string;
  status: Status;
  loteGranel: string;
  batchSize: string;
  responsable: string;
  progressPercent: number;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  onClick?: () => void;
  href?: string;
  className?: string;
}

function ProgressUrgency({ percent }: { percent: number }) {
  const color =
    percent >= 80
      ? "var(--color-ok)"
      : percent >= 40
        ? "var(--color-attention)"
        : "var(--color-neutral)";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="font-medium"
        style={{ fontSize: "var(--text-caption)", color }}
      >
        {percent}% avance
      </span>
    </div>
  );
}

export function OECard({
  oeId,
  productName,
  status,
  loteGranel,
  batchSize,
  responsable,
  progressPercent,
  primaryAction,
  variant,
  onClick,
  href,
  className,
}: OECardProps) {
  return (
    <EntityCard
      entityId={oeId}
      title={productName}
      status={status}
      identityIcon={Factory}
      metadata={[
        { id: "lote", label: "Lote granel", value: loteGranel },
        { id: "size", label: "Tamaño", value: batchSize },
        { id: "resp", label: "Responsable", value: responsable },
      ]}
      urgency={<ProgressUrgency percent={progressPercent} />}
      primaryAction={primaryAction}
      variant={variant}
      onClick={onClick}
      href={href}
      className={className}
    />
  );
}

export { ProgressUrgency as OEProgressUrgency };
