import type { LiberacionCardProps } from "@/components/cards/liberacion-card";
import type { LoteCardProps } from "@/components/cards/lote-card";
import type { OACardProps } from "@/components/cards/oa-card";
import type { OeIndexCardProps } from "@/components/cards/oe-index-card";
import type { OECardProps } from "@/components/cards/oe-card";
import type { PedidoCardProps } from "@/components/cards/pedido-card";
import type { TaskCardProps } from "@/types/ui/task-card";
import type { BandejaSectionId } from "@/types/bandeja/bandeja-section";

export const BandejaEntityType = {
  OE: "oe",
  OE_INDEX: "oe_index",
  OA: "oa",
  LOTE: "lote",
  LIBERACION: "liberacion",
  PEDIDO: "pedido",
  TASK: "task",
} as const;

export type BandejaEntityType =
  (typeof BandejaEntityType)[keyof typeof BandejaEntityType];

export type BandejaTaskPayload =
  | { entityType: typeof BandejaEntityType.OE; data: OECardProps }
  | { entityType: typeof BandejaEntityType.OE_INDEX; data: OeIndexCardProps }
  | { entityType: typeof BandejaEntityType.OA; data: OACardProps }
  | { entityType: typeof BandejaEntityType.LOTE; data: LoteCardProps }
  | {
      entityType: typeof BandejaEntityType.LIBERACION;
      data: LiberacionCardProps;
    }
  | { entityType: typeof BandejaEntityType.PEDIDO; data: PedidoCardProps }
  | { entityType: typeof BandejaEntityType.TASK; data: TaskCardProps };

export interface BandejaTask {
  id: string;
  sectionId: BandejaSectionId;
  /** Precalculated urgency — simulates /docs/09-bandeja-inteligente.md §4 */
  urgencyScore: number;
  payload: BandejaTaskPayload;
}

export interface BandejaDayPulse {
  completed: number;
  pending: number;
}
