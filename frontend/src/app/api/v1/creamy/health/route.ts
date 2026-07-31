import "server-only";

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import {
  classifyCreamyProviderError,
  resolveCreamyProvider,
  type CreamyResolvedProvider,
} from "@/lib/assistant/creamy-provider";
import { ACTOR_EMAIL_HEADER } from "@/lib/planning/actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_TIMEOUT_MS = 8_000;

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

/** Health ping — no expone secretos ni nombres de env. */
export async function GET(request: Request) {
  const email = request.headers.get(ACTOR_EMAIL_HEADER)?.trim();
  if (!email) {
    return NextResponse.json(
      { error: "Sesión requerida.", code: "ACTOR_EMAIL_REQUIRED" },
      { status: 401 }
    );
  }

  const resolved = resolveCreamyProvider();
  const modelConfigured = Boolean(resolved.model?.trim());

  if (!resolved.configured) {
    return NextResponse.json({
      configured: false,
      provider: null,
      modelConfigured,
      reachable: false,
      latencyMs: null,
    });
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Health ping timeout")), HEALTH_TIMEOUT_MS);

  try {
    const model = buildProviderModel(resolved);
    await generateText({
      model,
      prompt: "OK",
      maxOutputTokens: 4,
      abortSignal: controller.signal,
      maxRetries: 0,
    });
    return NextResponse.json({
      configured: true,
      provider: resolved.provider,
      modelConfigured,
      reachable: true,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    const classified = classifyCreamyProviderError(error);
    console.log(
      `[Creamy health] ping failed (${error instanceof Error ? error.constructor.name : "unknown"}, kind=${classified.kind}) at ${new Date().toISOString()}`
    );
    return NextResponse.json({
      configured: true,
      provider: resolved.provider,
      modelConfigured,
      reachable: false,
      latencyMs: Date.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
}
