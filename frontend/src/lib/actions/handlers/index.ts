import { ActionIds, type ActionId } from "@/types/actions";
import {
  handleOeCerrar,
  handleOeRegistrarConsumo,
  handleOeRegistrarControl,
} from "./oe.handlers";
import {
  handleOaCerrar,
  handleOaRegistrarConsumo,
} from "./oa.handlers";
import {
  handleLiberacionFirmar,
  handleLiberacionPrepararDisposicion,
  handleLoteCargarAnalisis,
  handlePedidoDespachar,
} from "./lote-pedido.handlers";
import type { PureHandler } from "./helpers";

export const ACTION_HANDLERS: Record<ActionId, PureHandler> = {
  [ActionIds.OE_REGISTRAR_CONSUMO]: handleOeRegistrarConsumo,
  [ActionIds.OE_REGISTRAR_CONTROL]: handleOeRegistrarControl,
  [ActionIds.OE_CERRAR]: handleOeCerrar,
  [ActionIds.OA_REGISTRAR_CONSUMO]: handleOaRegistrarConsumo,
  [ActionIds.OA_CERRAR]: handleOaCerrar,
  [ActionIds.LOTE_CARGAR_ANALISIS]: handleLoteCargarAnalisis,
  [ActionIds.LIBERACION_PREPARAR_DISPOSICION]: handleLiberacionPrepararDisposicion,
  [ActionIds.LIBERACION_FIRMAR]: handleLiberacionFirmar,
  [ActionIds.PEDIDO_DESPACHAR]: handlePedidoDespachar,
};

export function getActionHandler(actionId: ActionId): PureHandler | undefined {
  return ACTION_HANDLERS[actionId];
}
