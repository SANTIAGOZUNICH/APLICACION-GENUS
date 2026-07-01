import { Truck } from "lucide-react";
import { EntityCard } from "@/components/cards/entity-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Status } from "@/types/ui/status";
import type { EntityCardAction, EntityCardVariant } from "@/types/ui/entity-card";
import type { Status as StatusType } from "@/types/ui/status";

export interface PedidoCardProps {
  pedidoId: string;
  cliente: string;
  status: StatusType;
  compromiso: string;
  avanceDespacho: string;
  compromisoPorVencer?: boolean;
  primaryAction?: EntityCardAction;
  variant?: EntityCardVariant;
  onClick?: () => void;
  href?: string;
  className?: string;
}

export function PedidoCard({
  pedidoId,
  cliente,
  status,
  compromiso,
  avanceDespacho,
  compromisoPorVencer,
  primaryAction,
  variant,
  onClick,
  href,
  className,
}: PedidoCardProps) {
  return (
    <EntityCard
      entityId={pedidoId}
      title={cliente}
      status={status}
      identityIcon={Truck}
      metadata={[
        { id: "compromiso", label: "Compromiso", value: compromiso },
        { id: "avance", label: "Avance despacho", value: avanceDespacho },
      ]}
      urgency={
        compromisoPorVencer ? (
          <StatusBadge status={Status.POR_VENCER} size="sm" />
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
