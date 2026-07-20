/**
 * Dual AI provider resolution for Creamy — Gemini + OpenAI.
 * Pure module: no server-only import so it can be used in tests and shared code.
 */

export type CreamyAiProviderId = "gemini" | "openai";
export type CreamyAiProviderMode = "auto" | "gemini" | "openai";

export interface CreamyResolvedProvider {
  provider: CreamyAiProviderId;
  model: string;
  configured: boolean;
  reason: string;
  missingKey?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

function getEnv(env: Partial<NodeJS.ProcessEnv> | undefined, key: string): string | undefined {
  return (env ?? process.env)[key]?.trim() || undefined;
}

function resolveGemini(env: Partial<NodeJS.ProcessEnv> | undefined): CreamyResolvedProvider {
  const key = getEnv(env, "GEMINI_API_KEY");
  const model = getEnv(env, "CREAMY_GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
  if (!key) {
    return {
      provider: "gemini",
      model,
      configured: false,
      reason: "GEMINI_API_KEY no está configurada.",
      missingKey: true,
      errorCode: "MISSING_GEMINI_KEY",
    };
  }
  return { provider: "gemini", model, configured: true, reason: "GEMINI_API_KEY disponible." };
}

function resolveOpenAI(env: Partial<NodeJS.ProcessEnv> | undefined): CreamyResolvedProvider {
  const key = getEnv(env, "CREAMY_OPENAI_API_KEY") ?? getEnv(env, "OPENAI_API_KEY");
  const model = getEnv(env, "CREAMY_OPENAI_MODEL") ?? DEFAULT_OPENAI_MODEL;
  if (!key) {
    return {
      provider: "openai",
      model,
      configured: false,
      reason: "Falta CREAMY_OPENAI_API_KEY o OPENAI_API_KEY.",
      missingKey: true,
      errorCode: "MISSING_OPENAI_KEY",
    };
  }
  return { provider: "openai", model, configured: true, reason: "Clave OpenAI disponible." };
}

export function resolveCreamyProvider(env?: Partial<NodeJS.ProcessEnv>): CreamyResolvedProvider {
  const mode = (getEnv(env, "CREAMY_AI_PROVIDER") ?? "auto") as CreamyAiProviderMode;

  if (mode === "gemini") return resolveGemini(env);
  if (mode === "openai") return resolveOpenAI(env);

  // auto: prefer Gemini if key exists, else OpenAI
  const geminiKey = getEnv(env, "GEMINI_API_KEY");
  if (geminiKey) {
    return {
      ...resolveGemini(env),
      reason: "auto: GEMINI_API_KEY disponible, usando Gemini.",
    };
  }
  const openaiKey = getEnv(env, "CREAMY_OPENAI_API_KEY") ?? getEnv(env, "OPENAI_API_KEY");
  if (openaiKey) {
    return {
      ...resolveOpenAI(env),
      reason: "auto: GEMINI_API_KEY no disponible, usando OpenAI.",
    };
  }
  return {
    provider: "gemini",
    model: DEFAULT_GEMINI_MODEL,
    configured: false,
    reason:
      "auto: ningún proveedor configurado. Necesitás GEMINI_API_KEY (Gemini) o CREAMY_OPENAI_API_KEY / OPENAI_API_KEY (OpenAI).",
    missingKey: true,
    errorCode: "NO_PROVIDER_CONFIGURED",
  };
}

export function resolveCreamyFallbackProvider(
  primary: CreamyAiProviderId,
  env?: Partial<NodeJS.ProcessEnv>
): CreamyResolvedProvider | null {
  if (!isFallbackEnabled(env)) return null;
  const fallbackId: CreamyAiProviderId = primary === "gemini" ? "openai" : "gemini";
  const resolved = fallbackId === "gemini" ? resolveGemini(env) : resolveOpenAI(env);
  if (!resolved.configured) return null;
  return { ...resolved, reason: `Fallback desde ${primary}: ${resolved.reason}` };
}

export function isFallbackEnabled(env?: Partial<NodeJS.ProcessEnv>): boolean {
  return getEnv(env, "CREAMY_AI_FALLBACK") === "true";
}

export function shouldAttemptFallback(error: unknown, statusHint?: number): boolean {
  // Never fallback on auth/missing key errors
  if (statusHint === 401 || statusHint === 403) return false;

  // Rate limit → retry with fallback
  if (statusHint === 429) return true;

  // Server/gateway errors and timeouts → retry with fallback
  if (statusHint != null && statusHint >= 500) return true;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("rate limit") ||
      msg.includes("rate_limit") ||
      msg.includes("quota") ||
      msg.includes("resource_exhausted") ||
      msg.includes("unavailable") ||
      msg.includes("503") ||
      msg.includes("502")
    ) {
      return true;
    }
    // Aborted by timeout
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  }

  return false;
}
