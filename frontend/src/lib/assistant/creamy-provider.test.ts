import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  isFallbackEnabled,
  resolveCreamyFallbackProvider,
  resolveCreamyProvider,
  shouldAttemptFallback,
} from "./creamy-provider";
import { createCreamyTools, createCreamyToolRuntime } from "@/features/os/assistant/tools";
import type { CreamyLocalSnapshot } from "@/features/os/assistant/types";

describe("resolveCreamyProvider", () => {
  it("auto prefers Gemini when GEMINI_API_KEY is set", () => {
    const result = resolveCreamyProvider({ GEMINI_API_KEY: "gk-test" });
    expect(result.provider).toBe("gemini");
    expect(result.configured).toBe(true);
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.missingKey).toBeUndefined();
  });

  it("defaults to gemini-2.5-flash when CREAMY_GEMINI_MODEL is unset", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.5-flash");
    const withKey = resolveCreamyProvider({
      CREAMY_AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gk-test",
    });
    expect(withKey.model).toBe("gemini-2.5-flash");

    const withoutKey = resolveCreamyProvider({ CREAMY_AI_PROVIDER: "gemini" });
    expect(withoutKey.model).toBe("gemini-2.5-flash");

    const autoUnconfigured = resolveCreamyProvider({});
    expect(autoUnconfigured.model).toBe("gemini-2.5-flash");
  });

  it("CREAMY_GEMINI_MODEL override still wins over the default", () => {
    const result = resolveCreamyProvider({
      GEMINI_API_KEY: "gk-test",
      CREAMY_GEMINI_MODEL: "gemini-2.0-flash",
    });
    expect(result.model).toBe("gemini-2.0-flash");
  });

  it("gemini-2.5-flash default supports the Creamy tools flow", () => {
    const resolved = resolveCreamyProvider({
      CREAMY_AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "gk-test",
    });
    expect(resolved.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolved.model).toBe("gemini-2.5-flash");

    const snapshot: CreamyLocalSnapshot = {
      capturedAt: "2026-07-20T10:00:00.000Z",
      source: "local_browser",
      actorSectorId: "PRODUCCION",
      limits: {
        workItems: 10,
        lots: 10,
        rawMaterials: 10,
        orders: 10,
        qualityPending: 10,
        deliveries: 10,
      },
      workItems: [],
      lots: [],
      rawMaterials: [],
      orders: [],
      qualityPending: [],
      deliveries: [],
      notes: [],
    };

    const tools = createCreamyTools({
      actorSectorId: "PRODUCCION",
      snapshot,
    });
    const toolNames = Object.keys(tools);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "searchWorkItems",
        "getApplicationHelp",
        "searchDeliveries",
        "getPendingDeliveries",
        "getElaborationWork",
        "getElaborationWorkByOperator",
        "getProductFormulaOrBOM",
        "checkRawMaterialAvailability",
        "searchApprovedSubstitutions",
        "getElaborationOrder",
      ])
    );

    const runtime = createCreamyToolRuntime({
      actorSectorId: "PRODUCCION",
      snapshot,
    });
    const help = runtime.getApplicationHelp({ query: "entrega" });
    expect(help.localOnly).toBe(true);
    expect(Array.isArray(help.results)).toBe(true);
    expect(help.results.length).toBeGreaterThan(0);

    const substitutions = runtime.searchApprovedSubstitutions({});
    expect(substitutions.localOnly).toBe(true);
    expect(Array.isArray(substitutions.results)).toBe(true);
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
