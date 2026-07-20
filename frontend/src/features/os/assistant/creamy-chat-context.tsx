"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CreamyChatMessage } from "./types";

const STORAGE_KEY = "genus_os_creamy_chat";
const OPEN_KEY = "genus_os_creamy_panel_open";
const MINIMIZED_KEY = "genus_os_creamy_panel_minimized";

export type CreamyPanelMode = "closed" | "open" | "minimized";

function welcomeMessage(): CreamyChatMessage {
  return {
    id: "creamy-welcome",
    role: "assistant",
    content:
      "¡Hola! Soy Creamy, el asistente de Genus OS. Puedo ayudarte a consultar trabajos, productos, lotes, órdenes, materia prima, entregas y procesos del laboratorio. No apruebo, no elimino ni modifico datos.",
    createdAt: new Date().toISOString(),
  };
}

function safeStoredMessages(value: string | null): CreamyChatMessage[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item): item is CreamyChatMessage => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        (record.role === "user" || record.role === "assistant") &&
        typeof record.content === "string" &&
        typeof record.createdAt === "string"
      );
    });
    return messages.length ? messages : null;
  } catch {
    return null;
  }
}

interface CreamyChatContextValue {
  messages: CreamyChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<CreamyChatMessage[]>>;
  resetConversation: () => void;
  panelMode: CreamyPanelMode;
  openPanel: () => void;
  closePanel: () => void;
  minimizePanel: () => void;
  togglePanel: () => void;
}

const CreamyChatContext = createContext<CreamyChatContextValue | null>(null);

export function CreamyChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<CreamyChatMessage[]>(() => [welcomeMessage()]);
  const [panelMode, setPanelMode] = useState<CreamyPanelMode>("closed");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = safeStoredMessages(window.sessionStorage.getItem(STORAGE_KEY));
    const open = window.sessionStorage.getItem(OPEN_KEY) === "1";
    const minimized = window.sessionStorage.getItem(MINIMIZED_KEY) === "1";
    const nextMode: CreamyPanelMode = open && minimized ? "minimized" : open ? "open" : "closed";
    const timer = window.setTimeout(() => {
      if (stored) setMessages(stored);
      setPanelMode(nextMode);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.sessionStorage.setItem(OPEN_KEY, panelMode === "closed" ? "0" : "1");
    window.sessionStorage.setItem(MINIMIZED_KEY, panelMode === "minimized" ? "1" : "0");
  }, [panelMode, hydrated]);

  const resetConversation = useCallback(() => {
    setMessages([welcomeMessage()]);
  }, []);

  const openPanel = useCallback(() => setPanelMode("open"), []);
  const closePanel = useCallback(() => setPanelMode("closed"), []);
  const minimizePanel = useCallback(() => setPanelMode("minimized"), []);
  const togglePanel = useCallback(() => {
    setPanelMode((prev) => (prev === "open" ? "minimized" : "open"));
  }, []);

  const value = useMemo(
    () => ({
      messages,
      setMessages,
      resetConversation,
      panelMode,
      openPanel,
      closePanel,
      minimizePanel,
      togglePanel,
    }),
    [
      messages,
      resetConversation,
      panelMode,
      openPanel,
      closePanel,
      minimizePanel,
      togglePanel,
    ]
  );

  return <CreamyChatContext.Provider value={value}>{children}</CreamyChatContext.Provider>;
}

export function useCreamyChat(): CreamyChatContextValue {
  const ctx = useContext(CreamyChatContext);
  if (!ctx) {
    throw new Error("useCreamyChat debe usarse dentro de CreamyChatProvider");
  }
  return ctx;
}
