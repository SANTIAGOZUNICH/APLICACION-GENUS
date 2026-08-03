import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GenusAuthAdapter,
  mapAuthenticatedUserToSession,
} from "../adapters/genus-auth-adapter";
import {
  GENUS_OS_AUTH_SESSION_KEY,
  clearAuthSessionStorages,
  readAuthSessionFromStorages,
  writeAuthSessionToStorages,
} from "../lib/auth-session-storage";
import { MOCK_PREVIEW_USERS } from "./mock-preview-users";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key) { return store.get(key) ?? null; },
    key(index) { return [...store.keys()][index] ?? null; },
    removeItem(key) { store.delete(key); },
    setItem(key, value) { store.set(key, value); },
  };
}

function installStorage(sessionStorage: Storage, localStorage: Storage) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { sessionStorage, localStorage },
  });
}

const authenticatedUser = {
  email: "produccion@laboratoriogenus.com.ar",
  displayName: "Agustina Zunich",
  sector: "PRODUCCION",
  role: "ROL-SU",
  roleLabel: "Supervisora",
  sectorLabel: "Producción",
  jobTitle: "Supervisora de Planta",
  redirectTo: "/mi-trabajo",
};

describe("GenusAuthAdapter", () => {
  let sessionStorage: Storage;
  let localStorage: Storage;

  beforeEach(() => {
    sessionStorage = createStorage();
    localStorage = createStorage();
    installStorage(sessionStorage, localStorage);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the login endpoint and stores only display cache", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ user: authenticatedUser }), { status: 200 })
    );

    const session = await new GenusAuthAdapter().signIn({
      email: authenticatedUser.email,
      password: "not-a-demo-secret",
      rememberMe: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
    expect(session?.sector.id).toBe("PRODUCCION");
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeTruthy();
  });

  it("clears cached identity when /me returns 401", async () => {
    writeAuthSessionToStorages(
      mapAuthenticatedUserToSession(authenticatedUser, true),
      sessionStorage,
      localStorage
    );
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));

    await expect(new GenusAuthAdapter().hydrateSession()).resolves.toBeNull();
    expect(localStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });

  it("clears local cache even if logout request fails", async () => {
    writeAuthSessionToStorages(
      mapAuthenticatedUserToSession(authenticatedUser, false),
      sessionStorage,
      localStorage
    );
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    await expect(new GenusAuthAdapter().signOut()).rejects.toThrow("offline");
    expect(sessionStorage.getItem(GENUS_OS_AUTH_SESSION_KEY)).toBeNull();
  });
});

describe("Auth session storage", () => {
  it("keeps credential material out of the client directory bundle", () => {
    const sensitiveField = ["pass", "word"].join("");
    expect(JSON.stringify(MOCK_PREVIEW_USERS)).not.toContain(sensitiveField);
    expect(MOCK_PREVIEW_USERS.every((user) => !Object.hasOwn(user, sensitiveField))).toBe(true);
  });

  it("round-trips non-authoritative display data", () => {
    const sessionStorage = createStorage();
    const localStorage = createStorage();
    const session = mapAuthenticatedUserToSession(authenticatedUser, true);

    writeAuthSessionToStorages(session, sessionStorage, localStorage);
    expect(readAuthSessionFromStorages(sessionStorage, localStorage)?.user.email).toBe(
      authenticatedUser.email
    );

    clearAuthSessionStorages(sessionStorage, localStorage);
    expect(readAuthSessionFromStorages(sessionStorage, localStorage)).toBeNull();
  });
});
