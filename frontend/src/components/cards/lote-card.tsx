import { ScanBarcode } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Status } from "@/types/ui/status";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status as StatusType } from "@/types/ui/status";

export interface LoteCardProps {
  itemName: string;
  loteNumber: string;
  status: StatusType;
  tipoItem: string;
  saldo: string;
  vencimiento?: string;
  vencimientoProximo?: boolean;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  onClick?: () => void;
  href?: string;
  className?: string;
}

export function LoteCard({
  itemName,
  loteNumber,
  status,
  tipoItem,
  saldo,
  vencimiento,
  vencimientoProximo,
  primaryAction,
  variant,
  onClick,
  href,
  className,
}: LoteCardProps) {
  return (
    <EntityCard
      entityId={loteNumber}
      title={itemName}
      status={status}
      identityIcon={ScanBarcode}
      metadata={[
        { id: "tipo", label: "Tipo", value: tipoItem },
        { id: "saldo", label: "Saldo", value: saldo },
      ]}
      urgency={
        vencimiento ? (
          vencimientoProximo ? (
            <StatusBadge status={Status.POR_VENCER} size="sm" />
          ) : (
            <span
              className="text-[var(--muted-foreground)]"
              style={{ fontSize: "var(--text-caption)" }}
            >
              Vence {vencimiento}
            </span>
          )
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
