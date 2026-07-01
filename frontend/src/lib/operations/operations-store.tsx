"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { runActionPipeline } from "@/lib/actions/run-action-pipeline";
import { seedOperationsState } from "@/lib/operations/seed-operations-state";
import { mockUser } from "@/mocks/user.mock";
import type {
  ActionContext,
  ActionFlowData,
  ActionId,
  OperationsState,
  RoleId,
} from "@/types/actions";
import type { EntityPageKind } from "@/types/entity-page";
import type { Status } from "@/types/ui/status";

type OperationsAction =
  | { type: "SET_STATE"; state: OperationsState }
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
}

const OperationsStoreContext = createContext<OperationsStoreContextValue | null>(
  null
);

function operationsReducer(
  state: OperationsState,
  action: OperationsAction
): OperationsState {
  switch (action.type) {
    case "SET_STATE":
      return action.state;
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
  const [state, dispatch] = useReducer(
    operationsReducer,
    undefined,
    seedOperationsState
  );
  const [roleId, setRoleId] = useState<RoleId>(mockUser.roleId);

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
    }),
    [state, roleId, setState, executeAction]
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
