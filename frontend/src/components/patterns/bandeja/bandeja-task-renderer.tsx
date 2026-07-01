import {
  LiberacionCard,
  LoteCard,
  OACard,
  OECard,
  PedidoCard,
  TaskCard,
} from "@/components/cards";
import { BandejaEntityType, type BandejaTaskPayload } from "@/types/bandeja/bandeja-task";
import type { EntityCardVariant } from "@/types/ui/entity-card";

export interface BandejaTaskRendererProps {
  payload: BandejaTaskPayload;
  variant?: EntityCardVariant;
}

export function BandejaTaskRenderer({
  payload,
  variant = "default",
}: BandejaTaskRendererProps) {
  switch (payload.entityType) {
    case BandejaEntityType.OE:
      return <OECard {...payload.data} variant={variant} />;
    case BandejaEntityType.OA:
      return <OACard {...payload.data} variant={variant} />;
    case BandejaEntityType.LOTE:
      return <LoteCard {...payload.data} variant={variant} />;
    case BandejaEntityType.LIBERACION:
      return <LiberacionCard {...payload.data} variant={variant} />;
    case BandejaEntityType.PEDIDO:
      return <PedidoCard {...payload.data} variant={variant} />;
    case BandejaEntityType.TASK:
      return <TaskCard {...payload.data} variant={variant} />;
  }
}
