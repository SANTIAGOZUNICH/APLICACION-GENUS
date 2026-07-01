import {
  liberacionPageHref,
  lotePageHref,
  oaPageHref,
  oePageHref,
  pedidoPageHref,
} from "@/config/entity-pages";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";

/** Hrefs for cross-linked entities — use in bandeja/workspace mocks. */
export const entityMockHrefs = {
  oe: oePageHref(CROSS_LINK.oeId),
  oa: oaPageHref(CROSS_LINK.oaId),
  lote: lotePageHref(CROSS_LINK.loteGranel),
  pedido: pedidoPageHref(CROSS_LINK.pedidoId),
  liberacion: liberacionPageHref(CROSS_LINK.liberacionId),
} as const;
