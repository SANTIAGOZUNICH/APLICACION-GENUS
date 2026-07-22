// @vitest-environment happy-dom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreamyChatProvider, useCreamyChat } from "./creamy-chat-context";
import type { CreamyChatMessage } from "./types";

const STORAGE_KEY = "genus_os_creamy_chat";
const OPEN_KEY = "genus_os_creamy_panel_open";
const MINIMIZED_KEY = "genus_os_creamy_panel_minimized";

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useCreamyChat>) => void }) {
  const api = useCreamyChat();
  onReady(api);
  return null;
}

async function flushHydration(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("CreamyChatProvider", () => {
  const storage = new Map<string, string>();
  let container: HTMLDivElement;
  let root: Root;
  let api: ReturnType<typeof useCreamyChat> | null = null;

  beforeEach(() => {
    storage.clear();
    api = null;
    const sessionStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    };
    vi.stubGlobal("sessionStorage", sessionStorageMock);
    vi.stubGlobal("window", {
      ...globalThis.window,
      sessionStorage: sessionStorageMock,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <CreamyChatProvider>
          <Probe
            onReady={(value) => {
              api = value;
            }}
          />
        </CreamyChatProvider>
      );
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("inicia con panel cerrado tras hidratar", async () => {
    await flushHydration();
    expect(api?.panelMode).toBe("closed");
  });

  it("openPanel, minimizePanel y closePanel cambian el modo del panel", async () => {
    await flushHydration();

    act(() => {
      api?.openPanel();
    });
    expect(api?.panelMode).toBe("open");
    expect(storage.get(OPEN_KEY)).toBe("1");
    expect(storage.get(MINIMIZED_KEY)).toBe("0");

    act(() => {
      api?.minimizePanel();
    });
    expect(api?.panelMode).toBe("minimized");
    expect(storage.get(MINIMIZED_KEY)).toBe("1");

    act(() => {
      api?.closePanel();
    });
    expect(api?.panelMode).toBe("closed");
    expect(storage.get(OPEN_KEY)).toBe("0");
    expect(storage.get(MINIMIZED_KEY)).toBe("0");
  });

  it("resetConversation restaura el mensaje de bienvenida", async () => {
    await flushHydration();

    act(() => {
      api?.setMessages([
        {
          id: "user-1",
          role: "user",
          content: "Consulta de prueba",
          createdAt: "2026-07-20T10:00:00.000Z",
        },
      ]);
    });
    expect(api?.messages).toHaveLength(1);

    act(() => {
      api?.resetConversation();
    });

    expect(api?.messages).toHaveLength(1);
    expect(api?.messages[0]?.id).toBe("creamy-welcome");
    expect(api?.messages[0]?.role).toBe("assistant");
    expect(api?.messages[0]?.content).toContain("Soy Creamy");
  });

  it("persiste mensajes en sessionStorage después de hidratar", async () => {
    const storedMessages: CreamyChatMessage[] = [
      {
        id: "stored-user",
        role: "user",
        content: "Persistido",
        createdAt: "2026-07-20T11:00:00.000Z",
      },
      {
        id: "stored-assistant",
        role: "assistant",
        content: "Respuesta persistida",
        createdAt: "2026-07-20T11:00:01.000Z",
      },
    ];
    storage.set(STORAGE_KEY, JSON.stringify(storedMessages));

    act(() => {
      root.unmount();
    });
    container.remove();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <CreamyChatProvider>
          <Probe
            onReady={(value) => {
              api = value;
            }}
          />
        </CreamyChatProvider>
      );
    });

    await flushHydration();
    expect(api?.messages).toEqual(storedMessages);

    act(() => {
      api?.setMessages((current) => [
        ...current,
        {
          id: "new-user",
          role: "user",
          content: "Nuevo mensaje",
          createdAt: "2026-07-20T12:00:00.000Z",
        },
      ]);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const persisted = JSON.parse(storage.get(STORAGE_KEY) ?? "[]") as CreamyChatMessage[];
    expect(persisted.some((message) => message.id === "new-user")).toBe(true);
    expect(persisted.some((message) => message.id === "stored-user")).toBe(true);
  });
});
