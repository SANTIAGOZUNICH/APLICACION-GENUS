import { getOeEntityPage } from "@/mocks/entity-pages/oe.mock";
import { getOaEntityPage } from "@/mocks/entity-pages/oa.mock";
import { getLoteEntityPage } from "@/mocks/entity-pages/lote.mock";
import { getPedidoEntityPage } from "@/mocks/entity-pages/pedido.mock";
import { getLiberacionEntityPage } from "@/mocks/entity-pages/liberacion.mock";
import { CROSS_LINK } from "@/mocks/entity-pages/cross-link";
import { bandejaTasks, dayPulse } from "@/mocks/bandeja";
import { produccionTasks } from "@/mocks/workspace/produccion.mock";
import { calidadTasks } from "@/mocks/workspace/calidad.mock";
import { comercialTasks } from "@/mocks/workspace/comercial.mock";
import { depositoTasks } from "@/mocks/workspace/deposito.mock";
import { direccionTasks } from "@/mocks/workspace/direccion.mock";
import { dtTasks } from "@/mocks/workspace/dt.mock";
import {
  entityPageKey,
  type OperationsState,
  type WorkspaceId,
} from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";

/** Deep clone JSON-safe mock data (strips functions like noop handlers). */
function cloneMockData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEmptyWorkspaceTasks(): Record<
  WorkspaceId,
  OperationsState["workspaceTasks"][WorkspaceId]
> {
  return {
    produccion: [],
    calidad: [],
    comercial: [],
    deposito: [],
    direccion: [],
    dt: [],
  };
}

/** Empty operational shell for real mode — no fictional demo data. */
export function createEmptyRealOperationsState(): OperationsState {
  return {
    entityPages: {},
    bandejaTasks: [],
    workspaceTasks: createEmptyWorkspaceTasks(),
    dayPulse: { completed: 0, pending: 0 },
    workspacePanorama: {},
  };
}

/** Seeds OperationsState from static mocks — used by MockAdapter / demo mode only. */
export function seedOperationsState(): OperationsState {
  const entityPages: OperationsState["entityPages"] = {};

  const seeds = [
    getOeEntityPage(CROSS_LINK.oeId),
    getOaEntityPage(CROSS_LINK.oaId),
    getLoteEntityPage(CROSS_LINK.loteGranel),
    getPedidoEntityPage(CROSS_LINK.pedidoId),
    getLiberacionEntityPage(CROSS_LINK.liberacionId),
  ];

  for (const model of seeds) {
    if (model) {
      entityPages[entityPageKey(model.kind, model.entityId)] = model;
    }
  }

  return {
    entityPages,
    bandejaTasks: cloneMockData(bandejaTasks),
    workspaceTasks: {
      produccion: cloneMockData(produccionTasks),
      calidad: cloneMockData(calidadTasks),
      comercial: cloneMockData(comercialTasks),
      deposito: cloneMockData(depositoTasks),
      direccion: cloneMockData(direccionTasks),
      dt: cloneMockData(dtTasks),
    },
    dayPulse: cloneMockData(dayPulse),
  };
}

export function getEntityPageFromState(
  state: OperationsState,
  kind: EntityPageKind,
  entityId: string
) {
  return state.entityPages[entityPageKey(kind, entityId)];
}
