import { ShieldCheck } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status } from "@/types/ui/status";

export interface LiberacionCardProps {
  loteNumber: string;
  ordenRef: string;
  status: Status;
  evidencia: string;
  diasCuarentena: number;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  onClick?: () => void;
  href?: string;
  className?: string;
}

export function LiberacionCard({
  loteNumber,
  ordenRef,
  status,
  evidencia,
  diasCuarentena,
  primaryAction,
  variant,
  onClick,
  href,
  className,
}: LiberacionCardProps) {
  return (
    <EntityCard
      entityId={loteNumber}
      title={`Liberación ${ordenRef}`}
      status={status}
      identityIcon={ShieldCheck}
      metadata={[
        { id: "evidencia", label: "Evidencia", value: evidencia },
        {
          id: "cuarentena",
          label: "Días en cuarentena",
          value: `${diasCuarentena} días`,
        },
      ]}
      urgency={
        diasCuarentena >= 7 ? (
          <span
            className="font-medium text-[var(--color-attention)]"
            style={{ fontSize: "var(--text-caption)" }}
          >
            {diasCuarentena} días en cuarentena
          </span>
        ) : undefined
      }
      primaryAction={primaryAction}
      variant={variant}
      onClick={onClick}
      href={href}
      className={className}
    />
  );
}
