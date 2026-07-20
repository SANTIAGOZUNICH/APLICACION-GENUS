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
  SourceCitation,
} from "@/features/os/assistant/types";
import {
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

function notConfiguredMessage(mode: string): string {
  if (mode === "gemini") {
    return "Falta GEMINI_API_KEY en el servidor. Configurala en Vercel → Settings → Environment Variables.";
  }
  if (mode === "openai") {
    return "Falta CREAMY_OPENAI_API_KEY o OPENAI_API_KEY en el servidor. Configurala en Vercel → Settings → Environment Variables.";
  }
  return (
    "Creamy AI no está configurado. Para activarlo necesitás al menos una de estas variables: " +
    "GEMINI_API_KEY (proveedor Gemini) o CREAMY_OPENAI_API_KEY / OPENAI_API_KEY (proveedor OpenAI). " +
    "Configurá CREAMY_AI_PROVIDER=gemini|openai|auto según el proveedor a usar."
  );
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
  const providerMode = process.env.CREAMY_AI_PROVIDER?.trim() ?? "auto";

  if (!resolved.configured) {
    return NextResponse.json(
      {
        error: "Creamy AI no está configurado.",
        code: "CREAMY_NOT_CONFIGURED",
        message: notConfiguredMessage(providerMode),
      },
      { status: 503 }
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
  });
  const tools = createCreamyTools({
    actorSectorId: payload.actorSectorId,
    snapshot: payload.snapshot,
  });

  let usedFallback = false;
  let activeProvider = resolved;

  try {
    let result: Awaited<ReturnType<typeof callProvider>>;

    try {
      result = await callProvider(resolved, messages, systemPrompt, tools, signal);
    } catch (primaryError) {
      const fallback = resolveCreamyFallbackProvider(resolved.provider);
      if (fallback && shouldAttemptFallback(primaryError)) {
        console.log(
          `[Creamy] Primary provider ${resolved.provider} failed (${primaryError instanceof Error ? primaryError.constructor.name : "unknown"}), attempting fallback to ${fallback.provider} at ${new Date().toISOString()}`
        );
        activeProvider = fallback;
        usedFallback = true;
        result = await callProvider(fallback, messages, systemPrompt, tools, signal);
      } else {
        throw primaryError;
      }
    }

    const baseReply =
      result.text.trim() ||
      "No pude generar una respuesta con la información disponible. Probá reformular la consulta.";
    const reply = usedFallback
      ? `${baseReply}\n\n_(Respuesta generada con proveedor alternativo.)_`
      : baseReply;

    const response: AssistantChatResponse = {
      reply,
      sources: collectSources(result.toolResults),
      usedTools: collectUsedTools(result.toolResults),
      provider: activeProvider.provider,
      model: activeProvider.model,
    };
    return NextResponse.json(response);
  } catch (error) {
    if (signal.aborted) {
      return NextResponse.json(
        { error: "La respuesta de Creamy fue cancelada o excedió el tiempo máximo.", code: "CREAMY_ABORTED" },
        { status: 499 }
      );
    }
    console.log(
      `[Creamy] Provider ${activeProvider.provider} error: ${error instanceof Error ? error.constructor.name : "unknown"} at ${new Date().toISOString()}`
    );
    return NextResponse.json(
      {
        error: "No se pudo consultar Creamy AI.",
        code: "CREAMY_AI_FAILED",
        message: error instanceof Error ? error.message : "Error desconocido.",
      },
      { status: 502 }
    );
  } finally {
    cleanup();
  }
}
