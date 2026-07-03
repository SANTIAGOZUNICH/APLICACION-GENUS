import { beforeEach, describe, expect, it } from "vitest";
import { MockAuthAdapter, mapMockUserToSession } from "../adapters/mock-auth-adapter";
import {
  GENUS_OS_AUTH_SESSION_KEY,
  GENUS_OS_PREVIEW_USER_KEY,
  clearAuthSessionStorages,
  readAuthSessionFromStorages,
  writeAuthSessionToStorages,
} from "../lib/auth-session-storage";
import {
  clearAuthSession,
  getAuthSector,
  getCurrentAuthSession,
  isAuthenticatedPreview,
} from "../lib/auth-session-helpers";
import { MOCK_PREVIEW_USERS } from "../lib/mock-preview-users";
import type { OsAuthSession } from "../contracts";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function installBrowserStorages(sessionStorage: Storage, localStorage: Storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage, localStorage },
  });
}

describe("Auth contracts — MockAuthAdapter", () => {
  let sessionStorage: Storage;
  let localStorage: Storage;
  let adapter: MockAuthAdapter;

  beforeEach(() => {
    sessionStorage = createMemoryStorage();
    localStorage = createMemoryStorage();
    installBrowserStorages(sessionStorage, localStorage);
    adapter = new MockAuthAdapter();
  });

  it("autentica credenciales mock válidas y persiste sesión contractual", async () => {
    const session = await adapter.signIn({
      email: "produccion@laboratoriogenus.com.ar",
      password: "produccion123",
      rememberMe: false,
    });

    expect(session).not.toBeNull();
    expect(session?.status).toBe("preview");
    expect(session?.mode).toBe("preview");
    expect(session?.user.displayName).toBe("María Producción");
    expect(session?.sector.id).toBe("PRODUCCION");
    expect(session?.role.id).toBe("ROL-SU");
    expect(session?.redirectTo).toBe("/mi-trabajo");

    const raw = sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY);
    expect(raw).toBeTruthy();
    expect(localStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });

  it("rechaza credenciales inválidas sin persistir", async () => {
    const session = await adapter.signIn({
      email: "produccion@laboratoriogenus.com.ar",
      password: "wrong",
      rememberMe: false,
    });

    expect(session).toBeNull();
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });

  it("usa localStorage cuando remember me está activo", async () => {
    await adapter.signIn({
      email: "calidad@laboratoriogenus.com.ar",
      password: "calidad123",
      rememberMe: true,
    });

    expect(localStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeTruthy();
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });

  it("signOut limpia la sesión persistida", async () => {
    await adapter.signIn({
      email: "deposito@laboratoriogenus.com.ar",
      password: "deposito123",
      rememberMe: false,
    });

    await adapter.signOut();

    expect(adapter.getSession()).toBeNull();
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });
});

describe("Auth session storage — migración legacy", () => {
  let sessionStorage: Storage;
  let localStorage: Storage;

  beforeEach(() => {
    sessionStorage = createMemoryStorage();
    localStorage = createMemoryStorage();
    installBrowserStorages(sessionStorage, localStorage);
  });

  it("migra genus_os_preview_user al contrato OsAuthSession", () => {
    sessionStorage.setItem(
      GENUS_OS_PREVIEW_USER_KEY,
      JSON.stringify({
        email: "direccion@laboratoriogenus.com.ar",
        sector: "DIRECCION",
        displayName: "Santiago Dirección",
        role: "ROL-DI",
        roleLabel: "Dirección",
        sectorLabel: "Dirección",
        jobTitle: "Director General",
        redirectTo: "/mi-trabajo",
        storedAt: "2026-07-01T10:00:00.000Z",
      })
    );

    const session = readAuthSessionFromStorages(sessionStorage, localStorage);

    expect(session?.status).toBe("preview");
    expect(session?.user.email).toBe("direccion@laboratoriogenus.com.ar");
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeTruthy();
    expect(sessionStorage.getItem(GENUS_OS_PREVIEW_USER_KEY)).toBeNull();
  });
});

describe("Auth session helpers", () => {
  let sessionStorage: Storage;
  let localStorage: Storage;

  beforeEach(() => {
    sessionStorage = createMemoryStorage();
    localStorage = createMemoryStorage();
    installBrowserStorages(sessionStorage, localStorage);
  });

  it("expone helpers de sesión preview", () => {
    const session: OsAuthSession = mapMockUserToSession(MOCK_PREVIEW_USERS[0], false);
    writeAuthSessionToStorages(session, sessionStorage, localStorage);

    expect(isAuthenticatedPreview()).toBe(true);
    expect(getCurrentAuthSession()?.user.email).toBe(MOCK_PREVIEW_USERS[0].email);
    expect(getAuthSector()?.id).toBe("PRODUCCION");

    clearAuthSession();

    expect(isAuthenticatedPreview()).toBe(false);
    expect(getAuthSector()).toBeNull();
    expect(getCurrentAuthSession()).toBeNull();
  });

  it("clearAuthSessionStorages elimina claves canónicas y legacy", () => {
    sessionStorage.setItem(GENUS_OS_AUTH_SESSION_KEY, "{}");
    localStorage.setItem(GENUS_OS_PREVIEW_USER_KEY, "{}");

    clearAuthSessionStorages(sessionStorage, localStorage);

    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(GENUS_OS_PREVIEW_USER_KEY)).toBeNull();
  });
});
