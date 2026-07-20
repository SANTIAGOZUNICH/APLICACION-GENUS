import "server-only";

import { generateText, isStepCount, type ModelMessage } from "ai";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 20;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "gpt-4o-mini";

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

function getOpenAIApiKey(): string | null {
  return process.env.CREAMY_OPENAI_API_KEY || process.env.OPENAI_API_KEY || null;
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

  const apiKey = getOpenAIApiKey();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Creamy AI no está configurado.",
        code: "CREAMY_NOT_CONFIGURED",
        message:
          "Falta OPENAI_API_KEY o CREAMY_OPENAI_API_KEY en el servidor. Configurala en Vercel → Settings → Environment Variables (Preview/Production).",
      },
      { status: 503 }
    );
  }

  const { signal, cleanup } = timeoutSignal(request.signal);
  const payload = validation.value;
  const openai = createOpenAI({ apiKey });
  const modelName = process.env.CREAMY_OPENAI_MODEL || DEFAULT_MODEL;
  const messages: ModelMessage[] = payload.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  }));

  try {
    const result = await generateText({
      model: openai(modelName),
      system: buildCreamySystemPrompt({
        actorSectorId: payload.actorSectorId,
        snapshot: payload.snapshot,
      }),
      messages,
      tools: createCreamyTools({
        actorSectorId: payload.actorSectorId,
        snapshot: payload.snapshot,
      }),
      stopWhen: isStepCount(4),
      abortSignal: signal,
      maxRetries: 1,
    });

    const response: AssistantChatResponse = {
      reply:
        result.text.trim() ||
        "No pude generar una respuesta con la información disponible. Probá reformular la consulta.",
      sources: collectSources(result.toolResults),
      usedTools: collectUsedTools(result.toolResults),
    };
    return NextResponse.json(response);
  } catch (error) {
    if (signal.aborted) {
      return NextResponse.json(
        { error: "La respuesta de Creamy fue cancelada o excedió el tiempo máximo.", code: "CREAMY_ABORTED" },
        { status: 499 }
      );
    }
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
