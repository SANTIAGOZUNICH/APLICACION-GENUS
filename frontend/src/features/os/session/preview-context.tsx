"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WorkItem, WorkItemStatus } from "@/types/operational/work-item";
import type { SectorId } from "@/types/operational/sector";
import { clearAuthSession, getCurrentAuthSession } from "@/features/os/auth/lib/auth-session-helpers";
import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";
import { resolveSectorHome } from "@/lib/role-engine";
import type { SidebarItemId } from "@/lib/role-engine/types";
import { SECTOR_EMAILS } from "@/features/sectors/config/sector-emails";
import {
  isDetailView,
  SIDEBAR_TO_TWIN_VIEW,
  twinViewToSidebarId,
  type TwinNavEntry,
} from "../navigation/twin-nav";

export interface PreviewSession {
  sectorId: SectorId;
  email: string;
  ownerPerson?: string | null;
}

export interface CreamyTeaser {
  headline: string;
  hint: string;
}

export interface ActionToast {
  id: string;
  message: string;
  type: "success" | "info";
}

interface PreviewContextValue {
  session: PreviewSession | null;
  navStack: TwinNavEntry[];
  currentNav: TwinNavEntry;
  activeSidebarId: SidebarItemId;
  simulatedStatuses: Record<string, WorkItemStatus>;
  creamyOpen: boolean;
  creamyTeaser: CreamyTeaser | null;
  toast: ActionToast | null;
  completingIds: Set<string>;
  login: (sectorId: SectorId, options?: { email?: string; ownerPerson?: string | null }) => void;
  logout: () => void;
  navigateSidebar: (itemId: SidebarItemId) => void;
  navigateTo: (entry: TwinNavEntry) => void;
  goBack: () => void;
  openWorkItem: (workItemId: string) => void;
  openOa: (oaRef: string, workItemId?: string) => void;
  openOe: (oeRef: string, workItemId?: string) => void;
  openClient: (clientName: string) => void;
  openConsulta: (query?: string) => void;
  markWorkDone: (workItem: WorkItem) => void;
  getEffectiveStatus: (item: WorkItem) => WorkItemStatus;
  applyEffectiveStatus: (items: WorkItem[]) => WorkItem[];
  openCreamy: () => void;
  closeCreamy: () => void;
  setCreamyTeaser: (teaser: CreamyTeaser | null) => void;
  dismissToast: () => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

const DEFAULT_INITIAL_NAV: TwinNavEntry = { view: "mi-trabajo" };

function readAuthPreviewSession(): PreviewSession | null {
  if (typeof window === "undefined") return null;
  const authSession = getCurrentAuthSession();
  if (!authSession) return null;
  const mockUser = findMockUserByEmail(authSession.user.email);
  return {
    sectorId: authSession.sector.id,
    email: authSession.user.email,
    ownerPerson: mockUser?.ownerPerson ?? null,
  };
}

function nextUnblocksMessage(workItem: WorkItem): string {
  if (workItem.sector === "ENVASADO_MASIVO" || workItem.sector === "ENVASADO_PREMIUM") {
    return "Perfecto. Ahora Codificado ya puede continuar.";
  }
  if (workItem.sector === "ELABORACION") {
    return "Elaboración cerrada. Envasado puede tomar el lote.";
  }
  if (workItem.unblocks?.length) {
    return `Listo. ${workItem.unblocks.join(", ")} puede continuar.`;
  }
  return "Trabajo marcado como terminado. El flujo sigue en el siguiente sector.";
}

export function PreviewProvider({
  children,
  initialNav = DEFAULT_INITIAL_NAV,
}: {
  children: ReactNode;
  initialNav?: TwinNavEntry;
}) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [navStack, setNavStack] = useState<TwinNavEntry[]>([initialNav]);
  const [simulatedStatuses, setSimulatedStatuses] = useState<Record<string, WorkItemStatus>>({});
  const [creamyOpen, setCreamyOpen] = useState(false);
  const [creamyTeaser, setCreamyTeaserState] = useState<CreamyTeaser | null>(null);
  const [toast, setToast] = useState<ActionToast | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  useLayoutEffect(() => {
    if (session) return;
    const authSession = readAuthPreviewSession();
    if (authSession) setSession(authSession);
  }, [session]);

  const currentNav = navStack[navStack.length - 1] ?? initialNav;

  const activeSidebarId = useMemo(() => {
    if (isDetailView(currentNav.view)) {
      return twinViewToSidebarId(navStack[0]?.view ?? "mi-trabajo") ?? "mi_trabajo";
    }
    return twinViewToSidebarId(currentNav.view) ?? "mi_trabajo";
  }, [currentNav.view, navStack]);

  const login = useCallback(
    (sectorId: SectorId, options?: { email?: string; ownerPerson?: string | null }) => {
      setSession({
        sectorId,
        email: options?.email ?? SECTOR_EMAILS[sectorId],
        ownerPerson: options?.ownerPerson ?? null,
      });
      setNavStack([initialNav]);
      setSimulatedStatuses({});
      setCreamyOpen(false);
      setCreamyTeaserState(null);
      setToast(null);
      setCompletingIds(new Set());
    },
    [initialNav]
  );

  const logout = useCallback(() => {
    clearAuthSession();
    setSession(null);
    setNavStack([initialNav]);
    setSimulatedStatuses({});
    setCreamyOpen(false);
    setCreamyTeaserState(null);
    setToast(null);
    setCompletingIds(new Set());
  }, [initialNav]);

  const navigateTo = useCallback((entry: TwinNavEntry) => {
    setNavStack((stack) => {
      if (!isDetailView(entry.view)) {
        return [entry];
      }
      return [...stack, entry];
    });
    setCreamyOpen(false);
  }, []);

  const navigateSidebar = useCallback(
    (itemId: SidebarItemId) => {
      const view = SIDEBAR_TO_TWIN_VIEW[itemId];
      navigateTo({ view });
    },
    [navigateTo]
  );

  const goBack = useCallback(() => {
    setNavStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
    setCreamyOpen(false);
  }, []);

  const openWorkItem = useCallback(
    (workItemId: string) => navigateTo({ view: "work-detail", workItemId }),
    [navigateTo]
  );

  const openOa = useCallback(
    (oaRef: string, workItemId?: string) =>
      navigateTo({ view: "oa-detail", oaRef, workItemId }),
    [navigateTo]
  );

  const openOe = useCallback(
    (oeRef: string, workItemId?: string) =>
      navigateTo({ view: "oe-detail", oeRef, workItemId }),
    [navigateTo]
  );

  const openClient = useCallback(
    (clientName: string) => navigateTo({ view: "client-detail", clientName }),
    [navigateTo]
  );

  const openConsulta = useCallback(
    (query?: string) => navigateTo({ view: "consulta", query }),
    [navigateTo]
  );

  const getEffectiveStatus = useCallback(
    (item: WorkItem): WorkItemStatus => simulatedStatuses[item.id] ?? item.status,
    [simulatedStatuses]
  );

  const applyEffectiveStatus = useCallback(
    (items: WorkItem[]): WorkItem[] =>
      items.map((item) => ({
        ...item,
        status: getEffectiveStatus(item),
      })),
    [getEffectiveStatus]
  );

  const markWorkDone = useCallback((workItem: WorkItem) => {
    setCompletingIds((prev) => new Set(prev).add(workItem.id));

    window.setTimeout(() => {
      setSimulatedStatuses((prev) => ({ ...prev, [workItem.id]: "completo" }));
      setCompletingIds((prev) => {
        const next = new Set(prev);
        next.delete(workItem.id);
        return next;
      });

      const message = nextUnblocksMessage(workItem);
      setToast({
        id: `${workItem.id}-${Date.now()}`,
        message: "Trabajo terminado",
        type: "success",
      });
      setCreamyTeaserState({
        headline: "Trabajo cerrado",
        hint: message,
      });
      setCreamyOpen(true);
    }, 480);
  }, []);

  const openCreamy = useCallback(() => setCreamyOpen(true), []);
  const closeCreamy = useCallback(() => setCreamyOpen(false), []);
  const setCreamyTeaser = useCallback((teaser: CreamyTeaser | null) => {
    setCreamyTeaserState(teaser);
  }, []);
  const dismissToast = useCallback(() => setToast(null), []);

  const value = useMemo<PreviewContextValue>(
    () => ({
      session,
      navStack,
      currentNav,
      activeSidebarId,
      simulatedStatuses,
      creamyOpen,
      creamyTeaser,
      toast,
      completingIds,
      login,
      logout,
      navigateSidebar,
      navigateTo,
      goBack,
      openWorkItem,
      openOa,
      openOe,
      openClient,
      openConsulta,
      markWorkDone,
      getEffectiveStatus,
      applyEffectiveStatus,
      openCreamy,
      closeCreamy,
      setCreamyTeaser,
      dismissToast,
    }),
    [
      session,
      navStack,
      currentNav,
      activeSidebarId,
      simulatedStatuses,
      creamyOpen,
      creamyTeaser,
      toast,
      completingIds,
      login,
      logout,
      navigateSidebar,
      navigateTo,
      goBack,
      openWorkItem,
      openOa,
      openOe,
      openClient,
      openConsulta,
      markWorkDone,
      getEffectiveStatus,
      applyEffectiveStatus,
      openCreamy,
      closeCreamy,
      setCreamyTeaser,
      dismissToast,
    ]
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewContext(): PreviewContextValue {
  const ctx = useContext(PreviewContext);
  if (!ctx) {
    throw new Error("usePreviewContext debe usarse dentro de PreviewProvider");
  }
  return ctx;
}

export function usePreviewSession(): PreviewSession {
  const { session } = usePreviewContext();
  if (!session) {
    throw new Error("No hay sesión activa en el Digital Twin");
  }
  return session;
}

export function useResolvedHome() {
  const { sectorId } = usePreviewSession();
  return useMemo(() => resolveSectorHome(sectorId), [sectorId]);
}
