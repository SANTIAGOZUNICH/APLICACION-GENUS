import "server-only";

import { generateText, isStepCount, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import { OPERATIONAL_SECTOR_IDS, type SectorId } from "@/types/operational/sector";
import {
  createCreamyTools,
  type CreamyToolResult,
} from "@/features/os/assistant/tools";
import { buildCreamySystemPrompt } from "@/features/os/assistant/system-prompt";
import type {
  AssistantApiMessage,
  AssistantChatRequest,
  AssistantChatResponse,
  CreamyLocalSnapshot,
  CreamyNavAction,
  CreamyUiContext,
  SourceCitation,
} from "@/features/os/assistant/types";
import {
  classifyCreamyProviderError,
  getCreamyAlternateModel,
  mapCreamyErrorToClient,
  resolveCreamyProvider,
  resolveCreamyFallbackProvider,
  shouldAttemptFallback,
  type CreamyResolvedProvider,
} from "@/lib/assistant/creamy-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const FORBIDDEN_UI_CONTEXT_KEYS = /password|secret|token|apikey|api_key/i;

type ValidationResult =
  | { ok: true; value: AssistantChatRequest }
  | { ok: false; status: number; error: string; code: string };

function isSectorId(value: unknown): value is SectorId {
  return (
    typeof value === "string" &&
    OPERATIONAL_SECTOR_IDS.includes(value.trim().toUpperCase() as SectorId)
  );
}

function sanitizeMessage(raw: unknown): AssistantApiMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.role !== "user" && record.role !== "assistant") return null;
  if (typeof record.content !== "string") return null;
  return {
    role: record.role,
    content: record.content,
  };
}

export function sanitizeUiContext(raw: unknown): CreamyUiContext | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_UI_CONTEXT_KEYS.test(key)) return undefined;
  }

  const ctx: CreamyUiContext = {};

  if (typeof record.email === "string") {
    const email = record.email.trim().slice(0, 200);
    if (email) ctx.email = email;
  }
  if (typeof record.route === "string") {
    const route = record.route.trim().slice(0, 200);
    if (route) ctx.route = route;
  }
  if (typeof record.tab === "string") {
    const tab = record.tab.trim().slice(0, 200);
    if (tab) ctx.tab = tab;
  }
  if (typeof record.moduleName === "string") {
    const moduleName = record.moduleName.trim().slice(0, 200);
    if (moduleName) ctx.moduleName = moduleName;
  }
  if (typeof record.openItemSummary === "string") {
    const openItemSummary = record.openItemSummary.trim().slice(0, 500);
    if (openItemSummary) ctx.openItemSummary = openItemSummary;
  }
  if (Array.isArray(record.availableNav)) {
    const availableNav = record.availableNav
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (availableNav.length) ctx.availableNav = availableNav;
  }

  return Object.keys(ctx).length ? ctx : undefined;
}

export function validateChatRequestBody(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, status: 400, error: "Body JSON inválido.", code: "INVALID_BODY" };
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.actorSectorId !== "string" || !body.actorSectorId.trim()) {
    return {
      ok: false,
      status: 400,
      error: "actorSectorId es obligatorio.",
      code: "ACTOR_SECTOR_REQUIRED",
    };
  }
  if (!isSectorId(body.actorSectorId)) {
    return { ok: false, status: 400, error: "actorSectorId inválido.", code: "ACTOR_SECTOR_INVALID" };
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, status: 400, error: "messages debe incluir al menos un mensaje.", code: "MESSAGES_REQUIRED" };
  }

  const messages = body.messages.map(sanitizeMessage);
  if (messages.some((message) => message == null)) {
    return { ok: false, status: 400, error: "messages contiene roles o contenido inválidos.", code: "MESSAGES_INVALID" };
  }

  const sanitized = messages as AssistantApiMessage[];
  if (sanitized.some((message) => message.content.length > MAX_MESSAGE_LENGTH)) {
    return {
      ok: false,
      status: 400,
      error: `Cada mensaje debe tener como máximo ${MAX_MESSAGE_LENGTH} caracteres.`,
      code: "MESSAGE_TOO_LONG",
    };
  }

  const lastMessage = sanitized[sanitized.length - 1];
  if (!lastMessage || lastMessage.role !== "user" || !lastMessage.content.trim()) {
    return {
      ok: false,
      status: 400,
      error: "El último mensaje debe ser de usuario y no puede estar vacío.",
      code: "LAST_USER_MESSAGE_REQUIRED",
    };
  }

  return {
    ok: true,
    value: {
      actorSectorId: body.actorSectorId.trim().toUpperCase() as SectorId,
      messages: sanitized.slice(-MAX_HISTORY_MESSAGES),
      snapshot: body.snapshot as CreamyLocalSnapshot | undefined,
      uiContext: sanitizeUiContext(body.uiContext),
    },
  };
}

function timeoutSignal(parent: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Creamy AI timeout")), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

function collectSources(toolResults: unknown[]): SourceCitation[] {
  const sources: SourceCitation[] = [];
  for (const result of toolResults) {
    const output = (result as { output?: CreamyToolResult })?.output;
    if (Array.isArray(output?.sources)) sources.push(...output.sources);
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}:${source.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectUsedTools(toolResults: unknown[]): string[] {
  return Array.from(
    new Set(
      toolResults
        .map((result) => (result as { toolName?: unknown }).toolName)
        .filter((toolName): toolName is string => typeof toolName === "string")
    )
  );
}

function collectNavActions(toolResults: unknown[]): CreamyNavAction[] {
  const actions: CreamyNavAction[] = [];
  const seen = new Set<string>();
  for (const result of toolResults) {
    const output = (result as { output?: CreamyToolResult })?.output;
    if (!Array.isArray(output?.navActions)) continue;
    for (const action of output.navActions) {
      const key = `${action.sidebarId}:${action.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push(action);
    }
  }
  return actions;
}

function buildProviderModel(resolved: CreamyResolvedProvider) {
  if (resolved.provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY missing at runtime");
    const google = createGoogleGenerativeAI({ apiKey });
    return google(resolved.model);
  }
  const apiKey =
    process.env.CREAMY_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI API key missing at runtime");
  const openai = createOpenAI({ apiKey });
  return openai(resolved.model);
}

async function callProvider(
  resolved: CreamyResolvedProvider,
  messages: ModelMessage[],
  systemPrompt: string,
  tools: ReturnType<typeof createCreamyTools>,
  signal: AbortSignal
) {
  const model = buildProviderModel(resolved);
  return generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: isStepCount(4),
    abortSignal: signal,
    maxRetries: 1,
  });
}

function logProviderFailure(provider: string, error: unknown) {
  const classified = classifyCreamyProviderError(error);
  console.log(
    `[Creamy] Provider ${provider} failed (${error instanceof Error ? error.constructor.name : "unknown"}, kind=${classified.kind}) at ${new Date().toISOString()}`
  );
}

async function attemptWithRetries(
  primary: CreamyResolvedProvider,
  messages: ModelMessage[],
  systemPrompt: string,
  tools: ReturnType<typeof createCreamyTools>,
  signal: AbortSignal
): Promise<{ result: Awaited<ReturnType<typeof callProvider>>; activeProvider: CreamyResolvedProvider; usedFallback: boolean }> {
  let activeProvider = primary;
  let usedFallback = false;

  try {
    const result = await callProvider(primary, messages, systemPrompt, tools, signal);
    return { result, activeProvider, usedFallback };
  } catch (primaryError) {
    logProviderFailure(primary.provider, primaryError);
    const classified = classifyCreamyProviderError(primaryError);

    if (classified.kind === "model_unavailable") {
      const alternateModel = getCreamyAlternateModel(primary.provider, process.env, primary.model);
      if (alternateModel) {
        const alternateProvider: CreamyResolvedProvider = { ...primary, model: alternateModel };
        try {
          const result = await callProvider(alternateProvider, messages, systemPrompt, tools, signal);
          return { result, activeProvider: alternateProvider, usedFallback: false };
        } catch (alternateError) {
          logProviderFailure(primary.provider, alternateError);
        }
      }
    }

    const fallback = resolveCreamyFallbackProvider(primary.provider);
    if (fallback && shouldAttemptFallback(primaryError, classified.statusHint)) {
      console.log(
        `[Creamy] Attempting cross-provider fallback to ${fallback.provider} at ${new Date().toISOString()}`
      );
      activeProvider = fallback;
      usedFallback = true;
      const result = await callProvider(fallback, messages, systemPrompt, tools, signal);
      return { result, activeProvider, usedFallback };
    }

    throw primaryError;
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido.", code: "INVALID_JSON" }, { status: 400 });
  }

  const validation = validateChatRequestBody(body);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error, code: validation.code, message: validation.error },
      { status: validation.status }
    );
  }

  const resolved = resolveCreamyProvider();

  if (!resolved.configured) {
    const mapped = mapCreamyErrorToClient("not_configured");
    return NextResponse.json(
      {
        error: mapped.message,
        code: mapped.code,
        message: mapped.message,
      },
      { status: mapped.status }
    );
  }

  const { signal, cleanup } = timeoutSignal(request.signal);
  const payload = validation.value;
  const messages: ModelMessage[] = payload.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  }));
  const systemPrompt = buildCreamySystemPrompt({
    actorSectorId: payload.actorSectorId,
    snapshot: payload.snapshot,
    uiContext: payload.uiContext,
  });
  const tools = createCreamyTools({
    actorSectorId: payload.actorSectorId,
    snapshot: payload.snapshot,
    availableNav: payload.uiContext?.availableNav,
  });

  let activeProvider = resolved;

  try {
    const { result, activeProvider: usedProvider, usedFallback } = await attemptWithRetries(
      resolved,
      messages,
      systemPrompt,
      tools,
      signal
    );
    activeProvider = usedProvider;

    const baseReply =
      result.text.trim() ||
      "No pude generar una respuesta con la información disponible. Probá reformular la consulta.";
    const reply = usedFallback
      ? `${baseReply}\n\n_(Respuesta generada con proveedor alternativo.)_`
      : baseReply;

    const navActions = collectNavActions(result.toolResults);

    const response: AssistantChatResponse = {
      reply,
      sources: collectSources(result.toolResults),
      usedTools: collectUsedTools(result.toolResults),
      provider: activeProvider.provider,
      model: activeProvider.model,
      navActions: navActions.length ? navActions : undefined,
    };
    return NextResponse.json(response);
  } catch (error) {
    if (signal.aborted) {
      const mapped = mapCreamyErrorToClient("timeout");
      return NextResponse.json(
        { error: mapped.message, code: "CREAMY_ABORTED", message: "La respuesta de Creamy fue cancelada." },
        { status: 499 }
      );
    }
    logProviderFailure(activeProvider.provider, error);
    const classified = classifyCreamyProviderError(error);
    const mapped = mapCreamyErrorToClient(classified.kind);
    return NextResponse.json(
      {
        error: mapped.message,
        code: mapped.code,
        message: mapped.message,
      },
      { status: mapped.status }
    );
  } finally {
    cleanup();
  }
}
