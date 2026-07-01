import { Package } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

export interface OACardProps {
  oaId: string;
  skuName: string;
  status: Status;
  lotePt: string;
  unidades: string;
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
    <span
      className="font-medium"
      style={{ fontSize: "var(--text-caption)", color }}
    >
      {percent}% avance
    </span>
  );
}

export function OACard({
  oaId,
  skuName,
  status,
  lotePt,
  unidades,
  responsable,
  progressPercent,
  primaryAction,
  variant,
  onClick,
  href,
  className,
}: OACardProps) {
  return (
    <EntityCard
      entityId={oaId}
      title={skuName}
      status={status}
      identityIcon={Package}
      metadata={[
        { id: "lote", label: "Lote PT", value: lotePt },
        { id: "units", label: "Unidades", value: unidades },
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
