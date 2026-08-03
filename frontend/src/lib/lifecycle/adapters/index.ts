/**
 * Inventario lifecycle por módulo (contrato + adapters).
 * La ejecución vive en cada service; la decisión en @/lib/lifecycle.
 */
export {
  canAnnul,
  canArchive,
  canDelete,
  canHardDelete,
  canRestore,
  matchesVisibilityFilter,
  resolvePrimaryLifecycleAction,
} from "../policy";
export { orderLifecycleActions, orderToLifecycleState } from "./orders";
export {
  deliveryLifecycleActions,
  formulaLifecycleActions,
  mpIngresoToLifecycleState,
  remitoLifecycleActions,
  remitoToLifecycleState,
  plantillaLifecycleActions,
  metricaLifecycleActions,
  avisoLifecycleActions,
  mpStockLifecycleActions,
  mpControlLifecycleActions,
  mpControlToLifecycleState,
} from "./common";
