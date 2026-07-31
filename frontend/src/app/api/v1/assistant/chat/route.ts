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
import { sanitizeCreamyReply } from "@/lib/creamy-memory/sanitize";
import { getCreamyMemoryService } from "@/lib/creamy-memory/get-creamy-memory-service";
import {
  resolveOrdersActor,
} from "@/lib/orders/actor";
import { OrdersForbiddenError, OrdersValidationError } from "@/lib/orders/types";
import { findMockUserByEmail } from "@/features/os/auth/lib/mock-preview-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 12;
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
  let actor;
  try {
    actor = resolveOrdersActor(request);
  } catch (error) {
    if (error instanceof OrdersValidationError) {
      return NextResponse.json(
        { error: "Sesión requerida.", code: "ACTOR_EMAIL_REQUIRED", message: "Sesión requerida." },
        { status: 401 }
      );
    }
    if (error instanceof OrdersForbiddenError) {
      return NextResponse.json(
        { error: "Acceso denegado.", code: "ACTOR_FORBIDDEN", message: "Acceso denegado." },
        { status: 403 }
      );
    }
    throw error;
  }

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

  // Sector and email always come from the authenticated session — never from free-form body email.
  const payload = validation.value;
  if (payload.actorSectorId !== actor.sector) {
    return NextResponse.json(
      {
        error: "El sector de sesión no coincide con el actor autenticado.",
        code: "ACTOR_SECTOR_MISMATCH",
        message: "El sector de sesión no coincide con el actor autenticado.",
      },
      { status: 403 }
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
  const messages: ModelMessage[] = payload.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  }));

  const mockUser = findMockUserByEmail(actor.email);
  let userMemoryHints: string[] = [];
  try {
    const memories = await getCreamyMemoryService().listUserMemories(
      { email: actor.email, sector: actor.sector },
      actor.email,
      5
    );
    userMemoryHints = memories.map((m) => m.content).filter(Boolean);
  } catch {
    userMemoryHints = [];
  }

  const uiContext = {
    ...payload.uiContext,
    email: actor.email,
  };

  const systemPrompt = buildCreamySystemPrompt({
    actor: {
      email: actor.email,
      displayName: actor.displayName,
      sector: actor.sector,
      sectorLabel: mockUser?.sectorLabel,
      jobTitle: mockUser?.jobTitle,
    },
    snapshot: payload.snapshot,
    uiContext,
    userMemoryHints,
  });
  const tools = createCreamyTools({
    actorSectorId: actor.sector,
    snapshot: payload.snapshot,
    availableNav: uiContext.availableNav,
    actorEmail: actor.email,
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
      "No pude responder con la información disponible. Probá reformular.";
    // Fallback is invisible to the user — never mention provider/model.
    void usedFallback;
    const reply = sanitizeCreamyReply(baseReply);

    const navActions = collectNavActions(result.toolResults);
    const safeSources = collectSources(result.toolResults).filter(
      (source) => !/^TEST_/i.test(source.id) && !/^TEST_/i.test(source.label)
    );

    const response: AssistantChatResponse = {
      reply,
      sources: safeSources,
      // Never expose internal tool names to the client UI.
      usedTools: [],
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
