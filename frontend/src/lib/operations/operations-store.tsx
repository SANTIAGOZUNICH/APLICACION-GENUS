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
  fetchLoteById,
  fetchLoteList,
  OperationsApiError,
} from "@/lib/api/operations-client";
import { getClientDataMode } from "@/lib/config/data-mode";
import { seedOperationsState } from "@/lib/operations/seed-operations-state";
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
import type { Status } from "@/types/ui/status";

export type OperationsDataSource = "initial" | "sheets" | "demo";

type OperationsAction =
  | { type: "SET_STATE"; state: OperationsState }
  | {
      type: "MERGE_LOTE_PAGES";
      pages: OperationsState["entityPages"];
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
      status: Status;
      surface: ActionContext["surface"];
      flowData: ActionFlowData;
    }
  ) => Promise<import("@/types/actions").ActionResult>;
  dataMode: ReturnType<typeof getClientDataMode>;
  dataSource: OperationsDataSource;
  loading: boolean;
  error: string | null;
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
    case "MERGE_LOTE_PAGES":
      return mergeEntityPages(state, action.pages);
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
  const inflightLotesRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const mergeLotePages = useCallback(
    (bundles: Awaited<ReturnType<typeof fetchLoteList>>["lotes"]) => {
      const pages: OperationsState["entityPages"] = {};
      for (const bundle of bundles) {
        const model = rehydrateEntityPage(bundle.entityPage);
        pages[entityPageKey(model.kind, model.entityId)] = model;
      }
      dispatch({ type: "MERGE_LOTE_PAGES", pages });
    },
    []
  );

  const hydrateLotes = useCallback(async () => {
    if (dataMode !== "real") {
      setLoading(false);
      setDataSource("demo");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetchLoteList();
      mergeLotePages(response.lotes);
      setDataSource(response.source);
    } catch (err) {
      const message =
        err instanceof OperationsApiError
          ? err.message
          : "No se pudieron cargar los lotes.";
      setError(message);
      setDataSource("demo");
    } finally {
      setLoading(false);
    }
  }, [dataMode, mergeLotePages]);

  const ensureLoteLoaded = useCallback(
    async (loteId: string): Promise<boolean> => {
      const key = entityPageKey("lote", loteId);

      if (state.entityPages[key]) {
        return true;
      }

      if (dataMode === "demo") {
        return false;
      }

      const inflight = inflightLotesRef.current.get(loteId);
      if (inflight) {
        return inflight;
      }

      const task = (async () => {
        try {
          setError(null);
          const response = await fetchLoteById(loteId);
          const model = rehydrateEntityPage(response.entityPage);
          dispatch({
            type: "MERGE_LOTE_PAGES",
            pages: {
              [entityPageKey(model.kind, model.entityId)]: model,
            },
          });
          setDataSource(response.source);
          return true;
        } catch (err) {
          const message =
            err instanceof OperationsApiError
              ? err.message
              : "No se pudo cargar el lote.";
          setError(message);
          return false;
        }
      })();

      inflightLotesRef.current.set(loteId, task);

      try {
        return await task;
      } finally {
        inflightLotesRef.current.delete(loteId);
      }
    },
    [dataMode, state.entityPages]
  );

  useEffect(() => {
    if (dataMode !== "real" || hydratedRef.current) {
      return;
    }

    hydratedRef.current = true;
    void hydrateLotes();
  }, [dataMode, hydrateLotes]);

  const executeAction = useCallback(
    async (
      actionId: ActionId,
      params: {
        entityKind: EntityPageKind;
        entityId: string;
        status: Status;
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
