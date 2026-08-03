import { describe, expect, it, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();
const resolveAuthenticatedActorMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (model: string) => ({ provider: "google", model }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ provider: "openai", model }),
}));

vi.mock("@/lib/auth/resolve-authenticated-actor", () => ({
  resolveAuthenticatedActor: (...args: unknown[]) =>
    resolveAuthenticatedActorMock(...args),
}));

vi.mock("@/lib/auth/types", async () => {
  class AuthUnauthorizedError extends Error {
    constructor(message = "unauthorized") {
      super(message);
      this.name = "AuthUnauthorizedError";
    }
  }
  return { AuthUnauthorizedError };
});

describe("creamy health route", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    resolveAuthenticatedActorMock.mockReset();
    resolveAuthenticatedActorMock.mockResolvedValue({
      email: "prod@example.com",
      sector: "PRODUCCION",
    });
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("requires authenticated session", async () => {
    const { AuthUnauthorizedError } = await import("@/lib/auth/types");
    resolveAuthenticatedActorMock.mockRejectedValue(new AuthUnauthorizedError());
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/v1/creamy/health"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("AUTH_UNAUTHORIZED");
  });

  it("returns configured=false when provider is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/v1/creamy/health"));
    const body = await response.json();
    expect(body).toEqual({
      configured: false,
      provider: null,
      modelConfigured: true,
      reachable: false,
      latencyMs: null,
    });
  });

  it("returns reachable=true on successful ping", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gk-test");
    vi.stubEnv("CREAMY_AI_PROVIDER", "gemini");
    generateTextMock.mockResolvedValue({ text: "OK" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/v1/creamy/health"));
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(body.provider).toBe("gemini");
    expect(body.modelConfigured).toBe(true);
    expect(body.reachable).toBe(true);
    expect(typeof body.latencyMs).toBe("number");
    expect(JSON.stringify(body)).not.toContain("gk-test");
  });

  it("returns reachable=false when ping fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "gk-test");
    vi.stubEnv("CREAMY_AI_PROVIDER", "gemini");
    generateTextMock.mockRejectedValue(new Error("model no longer available"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/v1/creamy/health"));
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(body.reachable).toBe(false);
    expect(body.latencyMs).not.toBeNull();
  });
});
