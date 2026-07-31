/**
 * Dual AI provider resolution for Creamy — Gemini + OpenAI.
 * Pure module: no server-only import so it can be used in tests and shared code.
 */

export type CreamyAiProviderId = "gemini" | "openai";
export type CreamyAiProviderMode = "auto" | "gemini" | "openai";

export type CreamyProviderErrorKind =
  | "auth"
  | "model_unavailable"
  | "timeout"
  | "rate_limit"
  | "network"
  | "unknown";

export interface CreamyClassifiedError {
  kind: CreamyProviderErrorKind;
  statusHint?: number;
}

export interface CreamyClientError {
  code: string;
  message: string;
  status: number;
}

export interface CreamyResolvedProvider {
  provider: CreamyAiProviderId;
  model: string;
  configured: boolean;
  reason: string;
  missingKey?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

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

export function getCreamyAlternateModel(
  provider: CreamyAiProviderId,
  env?: Partial<NodeJS.ProcessEnv>,
  primaryModel?: string
): string | null {
  const envKey =
    provider === "gemini" ? "CREAMY_GEMINI_MODEL_FALLBACK" : "CREAMY_OPENAI_MODEL_FALLBACK";
  const fromEnv = getEnv(env, envKey);
  const defaultModel = provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL;
  const alternate = fromEnv || (primaryModel && primaryModel !== defaultModel ? defaultModel : null);
  if (!alternate) return null;
  if (primaryModel && alternate === primaryModel) return null;
  return alternate;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

export function classifyCreamyProviderError(error: unknown): CreamyClassifiedError {
  const msg = errorMessage(error);
  const lower = msg.toLowerCase();

  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return { kind: "timeout" };
    }
  }

  if (
    includesAny(lower, [
      "no longer available",
      "not found",
      "model_not_found",
      "does not exist",
      "is not supported",
    ]) ||
    lower.includes("404")
  ) {
    return { kind: "model_unavailable", statusHint: 502 };
  }

  if (
    includesAny(lower, [
      "api key not valid",
      "invalid api key",
      "unauthorized",
      "permission denied",
    ])
  ) {
    return { kind: "auth", statusHint: 401 };
  }

  if (includesAny(lower, ["timeout", "timed out"])) {
    return { kind: "timeout", statusHint: 504 };
  }

  if (
    includesAny(lower, ["rate limit", "rate_limit", "quota", "resource_exhausted"]) ||
    lower.includes("429")
  ) {
    return { kind: "rate_limit", statusHint: 429 };
  }

  if (
    includesAny(lower, [
      "fetch failed",
      "econnreset",
      "enotfound",
      "network",
      "socket hang up",
      "connection refused",
    ])
  ) {
    return { kind: "network", statusHint: 502 };
  }

  const statusMatch = /(?:status|code)\s*[:\s]?\s*(401|403|429|502|503|504)/i.exec(msg);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 401 || status === 403) return { kind: "auth", statusHint: status };
    if (status === 429) return { kind: "rate_limit", statusHint: status };
    if (status === 504) return { kind: "timeout", statusHint: status };
    if (status >= 500) return { kind: "network", statusHint: status };
  }

  return { kind: "unknown" };
}

export function mapCreamyErrorToClient(
  kind: CreamyProviderErrorKind | "not_configured"
): CreamyClientError {
  switch (kind) {
    case "not_configured":
      return {
        code: "CREAMY_NOT_CONFIGURED",
        message: "Creamy no está configurado en este entorno.",
        status: 503,
      };
    case "auth":
      return {
        code: "CREAMY_AUTH_REJECTED",
        message: "El proveedor rechazó la credencial.",
        status: 502,
      };
    case "model_unavailable":
      return {
        code: "CREAMY_MODEL_UNAVAILABLE",
        message: "El modelo configurado no está disponible.",
        status: 502,
      };
    case "timeout":
      return {
        code: "CREAMY_TIMEOUT",
        message: "La respuesta tardó demasiado.",
        status: 504,
      };
    case "rate_limit":
      return {
        code: "CREAMY_RATE_LIMIT",
        message: "Se alcanzó el límite de uso del proveedor. Esperá un momento e intentá de nuevo.",
        status: 429,
      };
    case "network":
    case "unknown":
    default:
      return {
        code: "CREAMY_PROVIDER_UNREACHABLE",
        message: "No pudimos contactar al proveedor. Reintentar.",
        status: 502,
      };
  }
}

export function shouldAttemptFallback(error: unknown, statusHint?: number): boolean {
  const classified = classifyCreamyProviderError(error);
  const hint = statusHint ?? classified.statusHint;

  if (classified.kind === "auth" || hint === 401 || hint === 403) return false;

  if (classified.kind === "model_unavailable") return true;

  if (hint === 429 || classified.kind === "rate_limit") return true;

  if (hint != null && hint >= 500) return true;

  if (classified.kind === "timeout") return true;

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
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  }

  return false;
}
