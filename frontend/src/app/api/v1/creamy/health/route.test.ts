import { describe, expect, it, vi, beforeEach } from "vitest";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (model: string) => ({ provider: "google", model }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ provider: "openai", model }),
}));

describe("creamy health route", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("requires x-genus-actor-email", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/v1/creamy/health"));
    expect(response.status).toBe(401);
  });

  it("returns configured=false when provider is missing", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/v1/creamy/health", {
        headers: { "x-genus-actor-email": "prod@example.com" },
      })
    );
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
    const response = await GET(
      new Request("http://localhost/api/v1/creamy/health", {
        headers: { "x-genus-actor-email": "prod@example.com" },
      })
    );
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
    const response = await GET(
      new Request("http://localhost/api/v1/creamy/health", {
        headers: { "x-genus-actor-email": "prod@example.com" },
      })
    );
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(body.reachable).toBe(false);
    expect(body.latencyMs).not.toBeNull();
  });
});
