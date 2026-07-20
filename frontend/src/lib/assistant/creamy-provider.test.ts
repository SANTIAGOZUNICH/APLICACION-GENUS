import { describe, expect, it } from "vitest";
import {
  isFallbackEnabled,
  resolveCreamyFallbackProvider,
  resolveCreamyProvider,
  shouldAttemptFallback,
} from "./creamy-provider";

describe("resolveCreamyProvider", () => {
  it("auto prefers Gemini when GEMINI_API_KEY is set", () => {
    const result = resolveCreamyProvider({ GEMINI_API_KEY: "gk-test" });
    expect(result.provider).toBe("gemini");
    expect(result.configured).toBe(true);
    expect(result.model).toBe("gemini-2.0-flash");
    expect(result.missingKey).toBeUndefined();
  });

  it("auto falls back to OpenAI when no Gemini key", () => {
    const result = resolveCreamyProvider({ OPENAI_API_KEY: "sk-test" });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(true);
  });

  it("auto uses CREAMY_OPENAI_API_KEY as OpenAI fallback variable", () => {
    const result = resolveCreamyProvider({ CREAMY_OPENAI_API_KEY: "sk-creamy-test" });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(true);
  });

  it("auto returns not configured when no keys present", () => {
    const result = resolveCreamyProvider({});
    expect(result.configured).toBe(false);
    expect(result.missingKey).toBe(true);
    expect(result.errorCode).toBe("NO_PROVIDER_CONFIGURED");
  });

  it("explicit gemini provider uses GEMINI_API_KEY", () => {
    const result = resolveCreamyProvider({
      CREAMY_AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gk-test",
    });
    expect(result.provider).toBe("gemini");
    expect(result.configured).toBe(true);
  });

  it("explicit gemini provider fails when key missing", () => {
    const result = resolveCreamyProvider({ CREAMY_AI_PROVIDER: "gemini" });
    expect(result.provider).toBe("gemini");
    expect(result.configured).toBe(false);
    expect(result.missingKey).toBe(true);
    expect(result.errorCode).toBe("MISSING_GEMINI_KEY");
  });

  it("explicit openai provider uses OPENAI_API_KEY", () => {
    const result = resolveCreamyProvider({
      CREAMY_AI_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
    });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(true);
  });

  it("explicit openai prefers CREAMY_OPENAI_API_KEY over OPENAI_API_KEY", () => {
    const result = resolveCreamyProvider({
      CREAMY_AI_PROVIDER: "openai",
      CREAMY_OPENAI_API_KEY: "sk-creamy",
      OPENAI_API_KEY: "sk-fallback",
    });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(true);
  });

  it("explicit openai fails when key missing", () => {
    const result = resolveCreamyProvider({ CREAMY_AI_PROVIDER: "openai" });
    expect(result.provider).toBe("openai");
    expect(result.configured).toBe(false);
    expect(result.missingKey).toBe(true);
    expect(result.errorCode).toBe("MISSING_OPENAI_KEY");
  });

  it("uses CREAMY_GEMINI_MODEL override", () => {
    const result = resolveCreamyProvider({
      GEMINI_API_KEY: "gk-test",
      CREAMY_GEMINI_MODEL: "gemini-1.5-pro",
    });
    expect(result.model).toBe("gemini-1.5-pro");
  });

  it("uses CREAMY_OPENAI_MODEL override", () => {
    const result = resolveCreamyProvider({
      OPENAI_API_KEY: "sk-test",
      CREAMY_OPENAI_MODEL: "gpt-4o",
    });
    expect(result.model).toBe("gpt-4o");
  });

  it("never exposes API keys in return value", () => {
    const result = resolveCreamyProvider({
      GEMINI_API_KEY: "gk-secret-key",
      OPENAI_API_KEY: "sk-secret-key",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("gk-secret-key");
    expect(serialized).not.toContain("sk-secret-key");
  });
});

describe("resolveCreamyFallbackProvider", () => {
  it("returns null when fallback is disabled", () => {
    const result = resolveCreamyFallbackProvider("gemini", {
      OPENAI_API_KEY: "sk-test",
    });
    expect(result).toBeNull();
  });

  it("returns OpenAI when primary is gemini and fallback enabled", () => {
    const result = resolveCreamyFallbackProvider("gemini", {
      CREAMY_AI_FALLBACK: "true",
      OPENAI_API_KEY: "sk-test",
    });
    expect(result?.provider).toBe("openai");
    expect(result?.configured).toBe(true);
  });

  it("returns Gemini when primary is openai and fallback enabled", () => {
    const result = resolveCreamyFallbackProvider("openai", {
      CREAMY_AI_FALLBACK: "true",
      GEMINI_API_KEY: "gk-test",
    });
    expect(result?.provider).toBe("gemini");
    expect(result?.configured).toBe(true);
  });

  it("returns null when fallback provider is also not configured", () => {
    const result = resolveCreamyFallbackProvider("gemini", {
      CREAMY_AI_FALLBACK: "true",
    });
    expect(result).toBeNull();
  });
});

describe("isFallbackEnabled", () => {
  it("returns true when CREAMY_AI_FALLBACK=true", () => {
    expect(isFallbackEnabled({ CREAMY_AI_FALLBACK: "true" })).toBe(true);
  });

  it("returns false when not set", () => {
    expect(isFallbackEnabled({})).toBe(false);
  });

  it("returns false for other values", () => {
    expect(isFallbackEnabled({ CREAMY_AI_FALLBACK: "1" })).toBe(false);
  });
});

describe("shouldAttemptFallback", () => {
  it("returns true for 429 status", () => {
    expect(shouldAttemptFallback(new Error("rate limited"), 429)).toBe(true);
  });

  it("returns true for 5xx status", () => {
    expect(shouldAttemptFallback(new Error("server error"), 500)).toBe(true);
    expect(shouldAttemptFallback(new Error("bad gateway"), 502)).toBe(true);
    expect(shouldAttemptFallback(new Error("unavailable"), 503)).toBe(true);
  });

  it("returns true for timeout error message", () => {
    expect(shouldAttemptFallback(new Error("Request timeout exceeded"))).toBe(true);
    expect(shouldAttemptFallback(new Error("timed out waiting for response"))).toBe(true);
  });

  it("returns true for quota/rate limit error message", () => {
    expect(shouldAttemptFallback(new Error("quota exceeded"))).toBe(true);
    expect(shouldAttemptFallback(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
  });

  it("returns true for AbortError name", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(shouldAttemptFallback(err)).toBe(true);
  });

  it("returns false for 401 (auth error)", () => {
    expect(shouldAttemptFallback(new Error("unauthorized"), 401)).toBe(false);
  });

  it("returns false for 403 (forbidden)", () => {
    expect(shouldAttemptFallback(new Error("forbidden"), 403)).toBe(false);
  });

  it("returns false for unknown errors without status", () => {
    expect(shouldAttemptFallback(new Error("generic error"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(shouldAttemptFallback("string error")).toBe(false);
    expect(shouldAttemptFallback(null)).toBe(false);
  });
});
