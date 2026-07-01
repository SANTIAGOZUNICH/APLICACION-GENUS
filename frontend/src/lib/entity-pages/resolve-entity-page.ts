import type { EntityPageKind, EntityPageModel } from "@/types/entity-page";
import { getLiberacionEntityPage } from "@/mocks/entity-pages/liberacion.mock";
import { getLoteEntityPage } from "@/mocks/entity-pages/lote.mock";
import { getOaEntityPage } from "@/mocks/entity-pages/oa.mock";
import { getOeEntityPage } from "@/mocks/entity-pages/oe.mock";
import { getPedidoEntityPage } from "@/mocks/entity-pages/pedido.mock";

const resolvers: Record<
  EntityPageKind,
  (id: string) => EntityPageModel | undefined
> = {
  oe: getOeEntityPage,
  oa: getOaEntityPage,
  lote: getLoteEntityPage,
  pedido: getPedidoEntityPage,
  liberacion: getLiberacionEntityPage,
};

export function resolveEntityPage(
  kind: EntityPageKind,
  id: string
): EntityPageModel | undefined {
  return resolvers[kind](decodeURIComponent(id));
}
