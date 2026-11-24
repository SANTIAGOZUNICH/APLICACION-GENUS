/**
 * Proveedor ALTERNATIVO de lectura de remitos: OpenAI (visión + salida JSON), Responses API.
 *
 * Se usa cuando Gemini no está disponible (503 / 429 / timeout / modelo caído) o su circuit breaker está abierto. Recibe LAS MISMAS «partes»
 * (texto + archivos en línea) que Gemini y devuelve texto JSON con el MISMO esquema: el saneamiento (`sanitizeExtraction`) es único.
 *
 * Credenciales: reutiliza las de GENUS OS para OpenAI. Orden: `INGRESO_REMITO_OPENAI_API_KEY` → `CREAMY_OPENAI_API_KEY` → `OPENAI_API_KEY`.
 * Modelo: `INGRESO_REMITO_OPENAI_MODEL` (por defecto `gpt-4o-mini`: económico, con visión y JSON). No activa facturación ni contrata nada:
 * si no hay clave el proveedor simplemente no está disponible. La clave nunca se registra ni se devuelve.
 */
import "server-only";

export type OpenAIFailureKind = "key" | "permission" | "region" | "model" | "limit" | "quota" | "overloaded" | "unavailable" | "bad_request" | "unsupported" | "timeout";
/** Campos del error que devuelve OpenAI, ya saneados (sin claves ni contenido): permiten saber QUÉ rechazó el pedido. */
export type OpenAIErrorInfo = { message: string; type: string | null; code: string | null; param: string | null; requestId: string | null };
export type OpenAIAttempt = { model: string; status: number | null; kind: "ok" | OpenAIFailureKind; error?: OpenAIErrorInfo };
export type OpenAIRun =
  | { ok: true; model: string; text: string; finishReason: string; attempts: OpenAIAttempt[]; calls: number; ms: number; tokens?: { prompt?: number; output?: number; total?: number } }
  | { ok: false; kind: OpenAIFailureKind; message: string; model: string | null; attempts: OpenAIAttempt[]; calls: number; ms: number; http: number | null; retryAfterMs: number | null; error?: OpenAIErrorInfo };

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_BASE = "https://api.openai.com";
const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/i;

export const redactOpenAI = (t: string) =>
  t
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[clave oculta]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, "$1[oculta]")
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{20,}/gi, "[archivo oculto]");

const clip = (v: unknown, n: number): string | null => (v == null || v === "" ? null : redactOpenAI(String(v)).slice(0, n));
/** Error de OpenAI saneado: mensaje (acotado), tipo, código, parámetro y request-id. Nunca cabeceras de autorización ni contenido del pedido. */
export function errorInfoOf(err: (OpenAIError & { param?: string | null }) | null | undefined, requestId: string | null): OpenAIErrorInfo {
  return { message: clip(err?.message, 400) ?? "", type: clip(err?.type, 60), code: clip(err?.code, 60), param: clip(err?.param, 80), requestId: clip(requestId, 80) };
}

export function openaiKey(env: Partial<NodeJS.ProcessEnv>): string {
  return (env.INGRESO_REMITO_OPENAI_API_KEY ?? env.CREAMY_OPENAI_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
}
export const openaiModel = (env: Partial<NodeJS.ProcessEnv>) => (env.INGRESO_REMITO_OPENAI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL;
/** Qué variable aporta la clave (solo el NOMBRE, nunca el valor): sirve para diagnosticar la configuración. */
export function openaiKeySource(env: Partial<NodeJS.ProcessEnv>): string | null {
  for (const k of ["INGRESO_REMITO_OPENAI_API_KEY", "CREAMY_OPENAI_API_KEY", "OPENAI_API_KEY"] as const) if (env[k]?.trim()) return k;
  return null;
}

/** Base de la API: solo se acepta otra distinta de OpenAI para pruebas locales (localhost) y nunca en Vercel. */
function baseUrl(env: Partial<NodeJS.ProcessEnv>): string {
  const raw = (env.INGRESO_REMITO_OPENAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (raw && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(raw) && env.VERCEL !== "1") return raw;
  return DEFAULT_BASE;
}

type Part = Record<string, unknown>;

/** Convierte las partes (formato Gemini) al formato de entrada de OpenAI. Los formatos que OpenAI no entiende (HEIC) se omiten. */
export function toOpenAIContent(parts: Part[]): { content: Array<Record<string, unknown>>; skipped: number; files: number } {
  const content: Array<Record<string, unknown>> = [];
  let skipped = 0;
  let files = 0;
  for (const p of parts) {
    if (typeof p.text === "string") {
      content.push({ type: "input_text", text: p.text });
      continue;
    }
    const inl = p.inline_data as { mime_type?: string; data?: string } | undefined;
    if (!inl?.data || !inl.mime_type) continue;
    if (IMAGE_TYPES.test(inl.mime_type)) {
      content.push({ type: "input_image", image_url: `data:${inl.mime_type};base64,${inl.data}`, detail: "high" });
      files += 1;
    } else if (/^application\/pdf$/i.test(inl.mime_type)) {
      content.push({ type: "input_file", filename: `remito-${files + 1}.pdf`, file_data: `data:application/pdf;base64,${inl.data}` });
      files += 1;
    } else skipped += 1;
  }
  return { content, skipped, files };
}

type OpenAIError = { type?: string; code?: string | null; message?: string; param?: string | null };

/** Clasifica el rechazo de OpenAI: cuota agotada y límite por minuto son cosas distintas; nada se disfraza de «permiso». */
export function classifyOpenAI(status: number, err: OpenAIError | null | undefined): OpenAIFailureKind {
  const code = String(err?.code ?? err?.type ?? "").toLowerCase();
  const msg = String(err?.message ?? "");
  if (/insufficient_quota|billing_hard_limit|exceeded your current quota/.test(code + " " + msg.toLowerCase())) return "quota";
  if (status === 401 || /invalid_api_key|incorrect api key/.test(code + " " + msg.toLowerCase())) return "key";
  if (/unsupported_country|region|territory/.test(code)) return "region";
  if (status === 429 || code === "rate_limit_exceeded") return "limit";
  if (status === 404 || code === "model_not_found") return "model";
  if (status === 403) return "permission";
  if (status === 503 || status === 502 || /overloaded|server_error|engine_overloaded/.test(code)) return "overloaded";
  if (status >= 500) return "unavailable";
  if (status === 400) return "bad_request";
  return "unavailable";
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runOpenAI(parts: Part[], env: Partial<NodeJS.ProcessEnv>, doFetch: typeof fetch, opts: { maxOutputTokens?: number; /** false = respuesta de texto libre (prueba de configuración). Por defecto JSON. */ json?: boolean; /** Prueba de configuración: permite un pedido sin imágenes. */ textOnly?: boolean } = {}): Promise<OpenAIRun> {
  const t0 = Date.now();
  const model = openaiModel(env);
  const key = openaiKey(env);
  const attempts: OpenAIAttempt[] = [];
  let lastError: OpenAIErrorInfo | undefined;
  const fail = (kind: OpenAIFailureKind, message: string, http: number | null, retryAfterMs: number | null = null): OpenAIRun => ({ ok: false, kind, message, model, attempts, calls: attempts.length, ms: Date.now() - t0, http, retryAfterMs, error: lastError });
  if (!key) return fail("key", "OpenAI no está configurado (falta CREAMY_OPENAI_API_KEY u OPENAI_API_KEY).", null);
  const { content, skipped, files } = toOpenAIContent(parts);
  if (files === 0 && !(opts.textOnly && content.length > 0)) return fail("unsupported", skipped ? "Los archivos (HEIC) no son compatibles con el proveedor alternativo." : "No hay imágenes para leer.", null);
  const budget = Math.max(50, Number(env.INGRESO_REMITO_BUDGET_MS ?? 38_000) || 38_000);
  const attemptCap = Math.max(20, Number(env.INGRESO_REMITO_ATTEMPT_MS ?? 30_000) || 30_000);
  const maxCalls = Math.max(2, Math.min(3, Number(env.INGRESO_REMITO_OPENAI_MAX_ATTEMPTS ?? 2) || 2));
  const base = Math.max(0, Number(env.INGRESO_REMITO_RETRY_BASE_MS ?? 700) || 0);
  const deadline = t0 + budget;
  const wantJson = opts.json !== false;
  // `json_object` EXIGE que la palabra «JSON» figure en la entrada (si no, OpenAI responde 400): se garantiza sin tocar el pedido original.
  const hasJsonWord = content.some((c) => c.type === "input_text" && /json/i.test(String(c.text ?? "")));
  const input = wantJson && !hasJsonWord ? [...content, { type: "input_text", text: "Respondé únicamente con un objeto JSON válido." }] : content;
  const reqBody: Record<string, unknown> = { model, input: [{ role: "user", content: input }], max_output_tokens: Math.max(16, opts.maxOutputTokens ?? 8192), store: false };
  if (wantJson) reqBody.text = { format: { type: "json_object" } };
  let body = JSON.stringify(reqBody);
  let droppedFormat = false;
  let lastKind: OpenAIFailureKind = "unavailable";
  let lastHttp: number | null = null;
  let lastRetryAfter: number | null = null;
  for (let n = 0; n < maxCalls; n++) {
    const left = deadline - Date.now();
    if (left < 1_500 && n > 0) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1, Math.min(attemptCap, left)));
    let res: Response;
    let raw: string;
    try {
      res = await doFetch(`${baseUrl(env)}/v1/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body, signal: ctl.signal });
      raw = await res.text(); // se lee completa DENTRO del tope
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      attempts.push({ model, status: null, kind: aborted ? "timeout" : "unavailable" });
      lastKind = aborted ? "timeout" : "unavailable";
      lastHttp = null;
      console.warn(`[ingreso-remito] OpenAI sin respuesta (${aborted ? "timeout" : "red"}) · modelo ${model}`);
      if (aborted && n + 1 < maxCalls && deadline - Date.now() > 9_000) continue; // un intento colgado: una segunda oportunidad si queda tiempo
      if (!aborted && n + 1 < maxCalls) { await sleep(Math.min(deadline - Date.now() - 1_000, Math.round(base * (0.5 + Math.random() * 0.5)))); continue; }
      break;
    } finally {
      clearTimeout(timer);
    }
    let data: { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; status?: string; incomplete_details?: { reason?: string }; error?: OpenAIError; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } } | null = null;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (res.ok && data && !data.error) {
      const text = (data.output_text ?? (data.output ?? []).flatMap((o) => (o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "")).join("")).toString();
      attempts.push({ model, status: res.status, kind: "ok" });
      const finishReason = data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens" ? "MAX_TOKENS" : "STOP";
      return { ok: true, model, text, finishReason, attempts, calls: attempts.length, ms: Date.now() - t0, tokens: data.usage ? { prompt: data.usage.input_tokens, output: data.usage.output_tokens, total: data.usage.total_tokens } : undefined };
    }
    const kind = res.ok ? "unavailable" : classifyOpenAI(res.status, data?.error);
    lastError = errorInfoOf(data?.error ?? (data ? null : { message: raw.slice(0, 200) }), res.headers.get("x-request-id"));
    attempts.push({ model, status: res.status, kind, error: lastError });
    lastKind = kind;
    lastHttp = res.status;
    const ra = Number(res.headers.get("retry-after"));
    lastRetryAfter = Number.isFinite(ra) && ra > 0 ? Math.round(ra * 1000) : null;
    console.warn(`[ingreso-remito] OpenAI falló (${kind} · HTTP ${res.status}) · modelo ${model} · tipo ${lastError.type ?? "-"} · código ${lastError.code ?? "-"} · param ${lastError.param ?? "-"} · req ${lastError.requestId ?? "-"}: ${lastError.message.slice(0, 200)}`);
    // Un 400 por el formato de salida estructurada (param «text.format…») se reintenta UNA vez sin él: el pedido ya exige JSON en el texto.
    if (kind === "bad_request" && wantJson && !droppedFormat && (/^text/.test(lastError.param ?? "") || /json_object|text\.format|response_format/i.test(lastError.message)) && n + 1 < Math.max(maxCalls, 2)) {
      droppedFormat = true;
      delete reqBody.text;
      body = JSON.stringify(reqBody);
      lastKind = kind;
      continue;
    }
    // Solo lo transitorio se reintenta (una vez, rápido); clave, cuota, permisos, modelo o pedido inválido no.
    const transient = kind === "overloaded" || kind === "unavailable" || kind === "limit";
    if (!transient || n + 1 >= maxCalls) break;
    const room = deadline - Date.now() - 4_000;
    if (room <= 0) break;
    await sleep(Math.min(room, lastRetryAfter ?? Math.round(base * 2 * (0.5 + Math.random() * 0.5)), 4_000));
  }
  const why = lastError ? ` · ${[lastError.type, lastError.code, lastError.param ? `param ${lastError.param}` : ""].filter(Boolean).join("/")}: ${lastError.message.slice(0, 200)}${lastError.requestId ? ` [req ${lastError.requestId}]` : ""}` : "";
  return fail(lastKind, `OpenAI no disponible (${lastKind}${lastHttp ? ` · HTTP ${lastHttp}` : ""}${why}).`, lastHttp, lastRetryAfter);
}
