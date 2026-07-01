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
  type ApiDataSource,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import {
  createEmptyRealOperationsState,
  getEntityPageFromState,
  seedOperationsState,
} from "@/lib/operations/seed-operations-state";
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
import type { OperationsDiagnostics } from "@/types/operations/operations-diagnostics";

export type OperationsDataSource = "initial" | "drive" | "demo" | "sheets";

function createInitialOperationsState(): OperationsState {
  return getClientDataMode() === "real"
    ? createEmptyRealOperationsState()
    : seedOperationsState();
}

type OperationsAction =
  | { type: "SET_STATE"; state: OperationsState }
  | {
      type: "MERGE_ENTITY_PAGES";
      pages: OperationsState["entityPages"];
      sources?: Record<string, ApiDataSource>;
    }
  | {
      type: "HYDRATE_OPERATIONS";
      bandejaTasks: OperationsState["bandejaTasks"];
      workspaceTasks: OperationsState["workspaceTasks"];
      dayPulse: OperationsState["dayPulse"];
      workspacePanorama?: OperationsState["workspacePanorama"];
      entityPages?: OperationsState["entityPages"];
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
  dataMode: "demo" | "real";
  dataSource: OperationsDataSource;
  diagnostics: OperationsDiagnostics | null;
  entitySources: Record<string, ApiDataSource>;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  hydrateOperations: () => Promise<void>;
  ensureEntityLoaded: (kind: EntityPageKind, entityId: string) => Promise<boolean>;
  getEntitySource: (kind: EntityPageKind, entityId: string) => ApiDataSource | null;
  hydrateLotes: () => Promise<void>;
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
        entityPages: action.entityPages ?? state.entityPages,
        bandejaTasks: action.bandejaTasks,
        workspaceTasks: action.workspaceTasks,
        dayPulse: action.dayPulse,
        workspacePanorama: action.workspacePanorama ?? {},
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
  const clientDataMode = getClientDataMode();
  const [state, dispatch] = useReducer(
    operationsReducer,
    undefined,
    createInitialOperationsState
  );
  const [roleId, setRoleId] = useState<RoleId>(mockUser.roleId);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] =
    useState<OperationsDataSource>("initial");
  const [dataMode, setDataMode] = useState<"demo" | "real">(clientDataMode);
  const [diagnostics, setDiagnostics] = useState<OperationsDiagnostics | null>(
    null
  );
  const [entitySources, setEntitySources] = useState<
    Record<string, ApiDataSource>
  >({});
  const hydratedRef = useRef(false);
  const inflightEntitiesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const driveLoadedRef = useRef<Set<string>>(new Set());

  const hydrateOperations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [loteResponse, operationsResponse] = await Promise.all([
        fetchLoteList(),
        fetchOperationsState(),
      ]);

      const serverMode = operationsResponse.diagnostics?.dataMode ?? clientDataMode;
      setDataMode(serverMode);

      const entityPages: OperationsState["entityPages"] = {};
      const sources: Record<string, ApiDataSource> = {};

      if (serverMode === "real") {
        for (const bundle of loteResponse.lotes) {
          const model = rehydrateEntityPage(bundle.entityPage);
          const key = entityPageKey(model.kind, model.entityId);
          entityPages[key] = model;
          sources[key] = bundle.source;
        }
      }

      dispatch({
        type: "HYDRATE_OPERATIONS",
        bandejaTasks: operationsResponse.bandejaTasks,
        workspaceTasks: operationsResponse.workspaceTasks,
        dayPulse: operationsResponse.dayPulse,
        workspacePanorama: operationsResponse.workspacePanorama,
        entityPages: serverMode === "real" ? entityPages : undefined,
      });

      setEntitySources(sources);
      setDiagnostics(operationsResponse.diagnostics ?? null);

      const isDrive =
        operationsResponse.source === "drive" ||
        operationsResponse.source === "drive-partial" ||
        loteResponse.source === "drive";
      setDataSource(isDrive ? "drive" : "demo");
      setHydrated(true);
    } catch (err) {
      const message =
        err instanceof OperationsApiError
          ? err.message
          : "No se pudieron cargar los datos operativos.";

      setError(message);
      setDataSource("demo");

      if (clientDataMode === "real") {
        dispatch({
          type: "HYDRATE_OPERATIONS",
          bandejaTasks: [],
          workspaceTasks: createEmptyRealOperationsState().workspaceTasks,
          dayPulse: { completed: 0, pending: 0 },
          workspacePanorama: {},
          entityPages: {},
        });
        setDataMode("real");
        setDiagnostics({
          dataMode: "real",
          source: "demo",
          counts: {
            oe: 0,
            lotes: 0,
            pedidos: 0,
            oa: 0,
            liberaciones: 0,
          },
          fallbackUsed: {
            bandeja: false,
            workspaces: false,
            entityPages: false,
            panorama: false,
          },
          message,
        });
      } else {
        setDataMode("demo");
        setDiagnostics({
          dataMode: "demo",
          source: "demo",
          counts: {
            oe: 0,
            lotes: 0,
            pedidos: 0,
            oa: 0,
            liberaciones: 0,
          },
          fallbackUsed: {
            bandeja: false,
            workspaces: false,
            entityPages: false,
            panorama: false,
          },
          message,
        });
      }

      setHydrated(true);
    } finally {
      setLoading(false);
    }
  }, [clientDataMode]);

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
          const key = entityPageKey(model.kind, model.entityId);

          dispatch({
            type: "MERGE_ENTITY_PAGES",
            pages: { [key]: model },
          });

          setEntitySources((current) => ({
            ...current,
            [key]: response.source,
          }));

          driveLoadedRef.current.add(inflightKey);
          setDataSource(response.source === "drive" ? "drive" : "demo");
          return true;
        } catch (err) {
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

  const getEntitySource = useCallback(
    (kind: EntityPageKind, entityId: string) =>
      entitySources[entityPageKey(kind, entityId)] ?? null,
    [entitySources]
  );

  const hydrateLotes = hydrateOperations;

  const ensureLoteLoaded = useCallback(
    (loteId: string) => ensureEntityLoaded("lote", loteId),
    [ensureEntityLoaded]
  );

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }

    hydratedRef.current = true;
    void hydrateOperations();
  }, [hydrateOperations]);

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
      diagnostics,
      entitySources,
      hydrated,
      loading,
      error,
      hydrateOperations,
      ensureEntityLoaded,
      getEntitySource,
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
      diagnostics,
      entitySources,
      hydrated,
      loading,
      error,
      hydrateOperations,
      ensureEntityLoaded,
      getEntitySource,
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
