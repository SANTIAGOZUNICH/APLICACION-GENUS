"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { runActionPipeline } from "@/lib/actions/run-action-pipeline";
import { rehydrateEntityPage } from "@/lib/adapters/rehydrate-entity-page";
import {
  fetchEntityByKind,
  fetchLoteList,
  fetchOperationsState,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import { getEntityPageFromState, seedOperationsState } from "@/lib/operations/seed-operations-state";
import { mockUser } from "@/mocks/user.mock";
import type {
  ActionContext,
  ActionFlowData,
  ActionId,
  OperationsState,
  RoleId,
} from "@/types/actions";
import { entityPageKey } from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";

export type OperationsDataSource = "initial" | "drive" | "demo" | "sheets";

type OperationsAction =
  | { type: "SET_STATE"; state: OperationsState }
  | {
      type: "MERGE_ENTITY_PAGES";
      pages: OperationsState["entityPages"];
    }
  | {
      type: "HYDRATE_OPERATIONS";
      bandejaTasks: OperationsState["bandejaTasks"];
      workspaceTasks: OperationsState["workspaceTasks"];
      dayPulse: OperationsState["dayPulse"];
      workspacePanorama?: OperationsState["workspacePanorama"];
    }
  | {
      type: "EXECUTE_PIPELINE";
      context: ActionContext;
      flowData: ActionFlowData;
    };

interface OperationsStoreContextValue {
  state: OperationsState;
  roleId: RoleId;
  setRoleId: (roleId: RoleId) => void;
  userName: typeof mockUser.name;
  setState: (state: OperationsState) => void;
  executeAction: (
    actionId: ActionId,
    params: {
      entityKind: EntityPageKind;
      entityId: string;
      status: import("@/types/ui/status").Status;
      surface: ActionContext["surface"];
      flowData: ActionFlowData;
    }
  ) => Promise<import("@/types/actions").ActionResult>;
  dataMode: ReturnType<typeof getClientDataMode>;
  dataSource: OperationsDataSource;
  loading: boolean;
  error: string | null;
  hydrateOperations: () => Promise<void>;
  ensureEntityLoaded: (kind: EntityPageKind, entityId: string) => Promise<boolean>;
  /** @deprecated Use ensureEntityLoaded("lote", id) */
  hydrateLotes: () => Promise<void>;
  /** @deprecated Use ensureEntityLoaded("lote", id) */
  ensureLoteLoaded: (loteId: string) => Promise<boolean>;
}

const OperationsStoreContext = createContext<OperationsStoreContextValue | null>(
  null
);

function mergeEntityPages(
  state: OperationsState,
  pages: OperationsState["entityPages"]
): OperationsState {
  return {
    ...state,
    entityPages: {
      ...state.entityPages,
      ...pages,
    },
  };
}

function operationsReducer(
  state: OperationsState,
  action: OperationsAction
): OperationsState {
  switch (action.type) {
    case "SET_STATE":
      return action.state;
    case "MERGE_ENTITY_PAGES":
      return mergeEntityPages(state, action.pages);
    case "HYDRATE_OPERATIONS":
      return {
        ...state,
        bandejaTasks: action.bandejaTasks,
        workspaceTasks: action.workspaceTasks,
        dayPulse: action.dayPulse,
        workspacePanorama: action.workspacePanorama ?? state.workspacePanorama,
      };
    case "EXECUTE_PIPELINE": {
      const output = runActionPipeline(
        state,
        action.context,
        action.flowData
      );
      if (output.result.ok && output.nextState) {
        return output.nextState;
      }
      return state;
    }
    default:
      return state;
  }
}

export function OperationsStoreProvider({ children }: { children: ReactNode }) {
  const dataMode = getClientDataMode();
  const [state, dispatch] = useReducer(
    operationsReducer,
    undefined,
    seedOperationsState
  );
  const [roleId, setRoleId] = useState<RoleId>(mockUser.roleId);
  const [loading, setLoading] = useState(dataMode === "real");
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] =
    useState<OperationsDataSource>("initial");
  const hydratedRef = useRef(false);
  const inflightEntitiesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const driveLoadedRef = useRef<Set<string>>(new Set());

  const mergeEntityPageBundles = useCallback(
    (
      bundles: Array<{
        entityPage: Parameters<typeof rehydrateEntityPage>[0];
      }>
    ) => {
      const pages: OperationsState["entityPages"] = {};
      for (const bundle of bundles) {
        const model = rehydrateEntityPage(bundle.entityPage);
        pages[entityPageKey(model.kind, model.entityId)] = model;
      }
      dispatch({ type: "MERGE_ENTITY_PAGES", pages });
    },
    []
  );

  const hydrateOperations = useCallback(async () => {
    if (dataMode !== "real") {
      setLoading(false);
      setDataSource("demo");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [loteResponse, operationsResponse] = await Promise.all([
        fetchLoteList(),
        fetchOperationsState(),
      ]);

      mergeEntityPageBundles(loteResponse.lotes);
      dispatch({
        type: "HYDRATE_OPERATIONS",
        bandejaTasks: operationsResponse.bandejaTasks,
        workspaceTasks: operationsResponse.workspaceTasks,
        dayPulse: operationsResponse.dayPulse,
        workspacePanorama: operationsResponse.workspacePanorama,
      });

      setDataSource(
        loteResponse.source === "drive" || operationsResponse.source === "drive"
          ? "drive"
          : loteResponse.source
      );
    } catch (err) {
      const message =
        err instanceof OperationsApiError
          ? err.message
          : "No se pudieron cargar los datos operativos.";
      setError(message);
      setDataSource("demo");
    } finally {
      setLoading(false);
    }
  }, [dataMode, mergeEntityPageBundles]);

  const ensureEntityLoaded = useCallback(
    async (kind: EntityPageKind, entityId: string): Promise<boolean> => {
      if (dataMode === "demo") {
        return Boolean(getEntityPageFromState(state, kind, entityId));
      }

      const inflightKey = `${kind}:${entityId}`;

      if (driveLoadedRef.current.has(inflightKey)) {
        return Boolean(getEntityPageFromState(state, kind, entityId));
      }

      const inflight = inflightEntitiesRef.current.get(inflightKey);
      if (inflight) {
        return inflight;
      }

      const task = (async () => {
        try {
          setError(null);
          const response = await fetchEntityByKind(kind, entityId);
          const model = rehydrateEntityPage(response.entityPage);
          dispatch({
            type: "MERGE_ENTITY_PAGES",
            pages: {
              [entityPageKey(model.kind, model.entityId)]: model,
            },
          });
          driveLoadedRef.current.add(inflightKey);
          setDataSource(response.source);
          return true;
        } catch (err) {
          const seeded = seedOperationsState();
          if (getEntityPageFromState(seeded, kind, entityId)) {
            return true;
          }

          const message =
            err instanceof OperationsApiError
              ? err.message
              : `No se pudo cargar ${kind}.`;
          setError(message);
          return false;
        }
      })();

      inflightEntitiesRef.current.set(inflightKey, task);

      try {
        return await task;
      } finally {
        inflightEntitiesRef.current.delete(inflightKey);
      }
    },
    [dataMode, state]
  );

  const hydrateLotes = hydrateOperations;

  const ensureLoteLoaded = useCallback(
    (loteId: string) => ensureEntityLoaded("lote", loteId),
    [ensureEntityLoaded]
  );

  useEffect(() => {
    if (dataMode !== "real" || hydratedRef.current) {
      return;
    }

    hydratedRef.current = true;
    void hydrateOperations();
  }, [dataMode, hydrateOperations]);

  const executeAction = useCallback(
    async (
      actionId: ActionId,
      params: {
        entityKind: EntityPageKind;
        entityId: string;
        status: import("@/types/ui/status").Status;
        surface: ActionContext["surface"];
        flowData: ActionFlowData;
      }
    ) => {
      const context: ActionContext = {
        actionId,
        entityKind: params.entityKind,
        entityId: params.entityId,
        status: params.status,
        roleId,
        surface: params.surface,
        userName: mockUser.name,
      };

      const output = runActionPipeline(state, context, params.flowData);

      if (output.result.ok && output.nextState) {
        dispatch({ type: "SET_STATE", state: output.nextState });
      }

      return output.result;
    },
    [state, roleId]
  );

  const setState = useCallback((next: OperationsState) => {
    dispatch({ type: "SET_STATE", state: next });
  }, []);

  const value = useMemo(
    () => ({
      state,
      roleId,
      setRoleId,
      userName: mockUser.name,
      setState,
      executeAction,
      dataMode,
      dataSource,
      loading,
      error,
      hydrateOperations,
      ensureEntityLoaded,
      hydrateLotes,
      ensureLoteLoaded,
    }),
    [
      state,
      roleId,
      setState,
      executeAction,
      dataMode,
      dataSource,
      loading,
      error,
      hydrateOperations,
      ensureEntityLoaded,
      hydrateLotes,
      ensureLoteLoaded,
    ]
  );

  return (
    <OperationsStoreContext.Provider value={value}>
      {children}
    </OperationsStoreContext.Provider>
  );
}

export function useOperationsStore(): OperationsStoreContextValue {
  const ctx = useContext(OperationsStoreContext);
  if (!ctx) {
    throw new Error("useOperationsStore must be used within OperationsStoreProvider");
  }
  return ctx;
}
