/**
 * Lectura automática de remitos (visión) con Gemini — SOLO sugerencia: nunca confirma ni mueve stock.
 *
 * Reutiliza la clave de Gemini de GENUS OS (`GEMINI_API_KEY`, la misma de Creamy; no se toca ni se registra), pero NO se activa solo
 * por existir esa clave: enviar remitos reales a un servicio externo exige autorización explícita → `INGRESO_REMITO_EXTRACTION=gemini`.
 *
 * MODELO. Google retira modelos con frecuencia (2.0 ya se retiró y hay fechas para 2.5), así que NO se confía en un nombre fijo ni se
 * hereda a ciegas el de Creamy (que tiene su propio respaldo y por eso «funciona» aunque su modelo ya no exista):
 *   1) si `INGRESO_REMITO_GEMINI_MODEL` está definida se prueba primero;
 *   2) si ese nombre no existe (404) —o no hay ninguno definido— se le pregunta a Google qué modelos tiene la clave (ListModels), se
 *      elige el mejor estable con entrada de imágenes y se reintenta; el que funciona queda en memoria 6 h.
 * Las fallas se clasifican (modelo inexistente / clave inválida / permisos / región / límite de uso) con un mensaje distinto cada una.
 */
import "server-only";

import { importantMissing, mergeExtractions, sanitizeExtraction, type ExtractedRemito } from "@/lib/inventory/receipt-rules";
import { enhanceReceiptImages } from "@/lib/inventory/receipt-image-enhance";
import { openaiKey, openaiKeySource, openaiModel, runOpenAI } from "@/lib/inventory/receipt-openai";
import { isProviderOpen, memoryHealth, type ProviderHealthStore, type ProviderId } from "@/lib/inventory/receipt-provider-health";
import { PROBE_IMAGE_BASE64, PROBE_IMAGE_MIME } from "@/lib/inventory/receipt-probe-image";

export type ExtractionConfig = {
  available: boolean;
  /** Proveedor principal (el primero configurado). */
  provider: "gemini" | "openai" | null;
  /** Proveedores con credenciales, en orden de uso (el primero lee; el siguiente respalda si falla). */
  providers: ProviderId[];
  /** Modelo explícito de Gemini (INGRESO_REMITO_GEMINI_MODEL) o "" si se elige automáticamente. */
  model: string;
  modelSource: "INGRESO_REMITO_GEMINI_MODEL" | "automático";
  /** ok | disabled (apagada por Sistemas) | missing_key (no hay ninguna clave: GEMINI_API_KEY ni OpenAI). */
  code: "ok" | "disabled" | "missing_key";
  reason: string;
};

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
/**
 * Presupuesto TOTAL de una lectura (debe ser menor que `maxDuration` de la ruta, 60 s) y tope por intento. Antes un único cronómetro de
 * 50 s cubría todo: si el primer intento se colgaba, no quedaba tiempo para reintentar ni probar otro modelo. Ahora cada intento tiene
 * su propio tope y lo que sobra se aprovecha para un segundo intento / otro modelo.
 */
const DEFAULT_BUDGET_MS = 54_000;
const DEFAULT_ATTEMPT_MS = 30_000;
/** Con menos que esto no vale la pena empezar otro intento. */
const MIN_ATTEMPT_MS = 9_000;
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;
/** Gemini acepta hasta ~20 MB de datos en línea por pedido: se envían como máximo estas hojas / bytes. */
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 14 * 1024 * 1024;
/** Si ni siquiera se puede listar modelos: alias mantenido por Google y últimos nombres conocidos. */
const STATIC_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];

/** Solo cuando el texto siguió siendo ilegible DESPUÉS de los intentos razonables (incluida la mejora automática de la imagen). */
export const MSG_UNREADABLE = "Necesito una imagen más clara del texto.";
/** Falla del servicio (saturación, cuota, configuración, red): NO es culpa de la imagen y no se pide otra foto. */
export const MSG_PROVIDER_DOWN = "La lectura automática no está disponible en este momento. Tu imagen está guardada y podés completar los datos manualmente o reintentar.";

const cleanModel = (v: string | undefined) => (v ?? "").trim().replace(/^models\//, "");

export const geminiAvailable = (env: Partial<NodeJS.ProcessEnv>) => Boolean(env.GEMINI_API_KEY?.trim());
export const openaiAvailable = (env: Partial<NodeJS.ProcessEnv>) => !["off", "false", "0", "no"].includes(String(env.INGRESO_REMITO_OPENAI ?? "").trim().toLowerCase()) && Boolean(openaiKey(env));

/** Orden de proveedores: `INGRESO_REMITO_PROVIDERS` (p. ej. «gemini,openai»); por defecto Gemini principal y OpenAI de respaldo. Solo los que tienen clave. */
export function providerOrder(env: Partial<NodeJS.ProcessEnv>): ProviderId[] {
  const wanted = String(env.INGRESO_REMITO_PROVIDERS ?? "gemini,openai").split(",").map((x) => x.trim().toLowerCase()).filter((x): x is ProviderId => x === "gemini" || x === "openai");
  const seen = [...new Set(wanted.length ? wanted : (["gemini", "openai"] as ProviderId[]))];
  return seen.filter((p) => (p === "gemini" ? geminiAvailable(env) : openaiAvailable(env)));
}

export function extractionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ExtractionConfig {
  const mode = (env.INGRESO_REMITO_EXTRACTION ?? "").trim().toLowerCase();
  const model = cleanModel(env.INGRESO_REMITO_GEMINI_MODEL);
  const modelSource = model ? "INGRESO_REMITO_GEMINI_MODEL" : "automático";
  // Se activa sola cuando existe alguna clave (Gemini u OpenAI). Solo se apaga con una orden explícita.
  if (["off", "false", "0", "no", "disabled", "desactivada"].includes(mode)) {
    return { available: false, provider: null, providers: [], model, modelSource, code: "disabled", reason: "La lectura automática de fotos está desactivada por Sistemas. Cargá los datos a mano: la foto queda adjunta igual." };
  }
  const providers = providerOrder(env);
  if (providers.length === 0) {
    return { available: false, provider: null, providers: [], model, modelSource, code: "missing_key", reason: "La lectura automática está habilitada pero falta la clave del servicio (GEMINI_API_KEY, o CREAMY_OPENAI_API_KEY / OPENAI_API_KEY para OpenAI). Cargá los datos a mano y avisá a Sistemas." };
  }
  return { available: true, provider: providers[0]!, providers, model, modelSource, code: "ok", reason: "" };
}

/** Base de la API. Solo se acepta otra distinta de Google para pruebas locales (localhost / 127.0.0.1). */
function baseUrl(env: Partial<NodeJS.ProcessEnv>): string {
  const raw = (env.INGRESO_REMITO_GEMINI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (raw && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(raw) && env.VERCEL !== "1") return raw;
  return DEFAULT_BASE;
}

/** Quita cualquier cosa con forma de clave de Google antes de registrar o devolver un texto. */
export function redactSecrets(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[clave oculta]").replace(/(api[_-]?key["'=: ]+)[^\s"']{8,}/gi, "$1[oculta]");
}

// ───────────────────────── Descubrimiento y elección de modelo ─────────────────────────

type ModelCache = { models: string[]; working: string | null; at: number };
let modelCache: ModelCache | null = null;
/** Modelos que el proveedor rechazó con 404 aunque figuren en el listado: se descartan un rato (no se vuelven a pedir en cada lectura). */
const DEAD_MODEL_MS = Math.max(1, Number(process.env.INGRESO_REMITO_DEAD_MODEL_MS ?? 30 * 60_000) || 30 * 60_000);
const deadModels = new Map<string, number>();
const isDeadModel = (m: string) => {
  const at = deadModels.get(m);
  if (at == null) return false;
  if (Date.now() - at > DEAD_MODEL_MS) {
    deadModels.delete(m);
    return false;
  }
  return true;
};
/** Modelos descartados por 404 (con cuánto falta para volver a probarlos): se muestra en el diagnóstico. */
export const deadModelList = () => [...deadModels.keys()].filter((m) => isDeadModel(m));
export function resetModelCacheForTests() {
  modelCache = null;
  deadModels.clear();
}

/**
 * Orden de preferencia para LEER REMITOS: modelos GA, económicos y con capacidad probada (no «el de versión más alta»: en producción los
 * 3.5–3.8 respondían 503 por alta demanda mientras 2.5 estaba disponible). Primero la lista fija de estables, luego el resto por grupo.
 */
export const STABLE_PREFERRED = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.0-flash"];
export function rankVisionModels(names: string[]): string[] {
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const group = (n: string) => {
    const preview = /preview|exp|\d{2}-\d{2,4}$/.test(n);
    if (/flash-latest$/.test(n)) return 1;
    if (/flash-lite/.test(n)) return preview ? 5 : 3;
    if (/flash/.test(n)) return preview ? 4 : 0;
    if (/pro/.test(n)) return preview ? 7 : 6;
    return 8;
  };
  const fixed = (n: string) => {
    const i = STABLE_PREFERRED.indexOf(n);
    return i < 0 ? 999 : i;
  };
  // Dentro de cada grupo se prefiere una versión estable conocida y, recién después, la de número más alto.
  return [...new Set(names)].sort((a, b) => fixed(a) - fixed(b) || group(a) - group(b) || version(b) - version(a) || a.length - b.length || a.localeCompare(b));
}

const NOT_FOR_VISION = /embedding|aqa|imagen|veo|tts|audio|live|image|robotics|computer-use|learnlm|gemma|vision$|thinking|customtools/;

type ListResult = { ok: true; models: string[] } | { ok: false; status: number | null; kind: FailureKind };

async function listModels(env: Partial<NodeJS.ProcessEnv>, doFetch: typeof fetch): Promise<ListResult> {
  const names: string[] = [];
  let token = "";
  try {
    for (let page = 0; page < 4; page++) {
      const res = await doFetch(`${baseUrl(env)}/v1beta/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY!.trim() } });
      const body = (await res.json().catch(() => null)) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>; nextPageToken?: string; error?: GeminiError } | null;
      if (!res.ok) return { ok: false, status: res.status, kind: classifyHttp(res.status, body?.error).kind };
      for (const m of body?.models ?? []) {
        const name = cleanModel(m.name);
        if (!name.startsWith("gemini") || NOT_FOR_VISION.test(name)) continue;
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes("generateContent")) continue;
        names.push(name);
      }
      token = body?.nextPageToken ?? "";
      if (!token) break;
    }
  } catch {
    return { ok: false, status: null, kind: "unavailable" };
  }
  return { ok: true, models: rankVisionModels(names) };
}

// ───────────────────────── Clasificación de errores ─────────────────────────

export type FailureKind = "model" | "key" | "permission" | "region" | "limit" | "quota" | "overloaded" | "unavailable" | "bad_request";
type GeminiError = { code?: number; status?: string; message?: string; details?: Array<{ reason?: string; metadata?: Record<string, string> }> };

/** Datos NO sensibles de un rechazo de Gemini (sin clave, sin contenido): sirven para saber QUÉ lo rechazó y dónde se corrige. */
export type GeminiDiag = { http: number | null; googleStatus: string; reason: string; service: string };
export function diagOf(status: number | null, err: GeminiError | null | undefined): GeminiDiag {
  const d = (err?.details ?? []).find((x) => x?.reason) ?? err?.details?.[0];
  return {
    http: status,
    googleStatus: String(err?.status ?? "").toUpperCase().slice(0, 40),
    reason: String(d?.reason ?? "").toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 60),
    service: String(d?.metadata?.service ?? "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80),
  };
}
export const diagText = (d: GeminiDiag | undefined | null) => (d ? [d.http ? `HTTP ${d.http}` : "", d.googleStatus, d.reason].filter(Boolean).join(" · ") : "");

/** Distingue modelo inexistente / clave inválida / permisos / región / límite de uso a partir del estado HTTP y del cuerpo del error. */
export function classifyHttp(status: number, err: GeminiError | null | undefined): { kind: FailureKind; detail: string } {
  const msg = err?.message ?? "";
  const st = (err?.status ?? "").toUpperCase();
  const detail = redactSecrets(msg).slice(0, 220);
  if (/api key not valid|api_key_invalid|api key expired|key.*(invalid|expired)/i.test(msg) || st === "UNAUTHENTICATED" || status === 401) return { kind: "key", detail };
  if (/location is not supported|not available in your (country|region)/i.test(msg)) return { kind: "region", detail };
  if (status === 404 || st === "NOT_FOUND" || /models\/[\w.-]+ is not found|no longer available|is not supported for generatecontent/i.test(msg)) return { kind: "model", detail };
  if (status === 429 || st === "RESOURCE_EXHAUSTED" || /quota|rate limit/i.test(msg)) {
    // Cuota DIARIA / sin cupo (límite 0): reintentar no sirve. Google usa el mismo texto («You exceeded your current quota») para el límite por
    // minuto, así que se mira el detalle estructurado (QuotaFailure.quotaId): «PerDay» = agotada; «PerMinute» o sin detalle = transitorio.
    const blob = JSON.stringify(err?.details ?? []);
    if (/PerDay|Daily/i.test(blob) || /limit:\s*0\b/i.test(msg)) return { kind: "quota", detail };
    return { kind: "limit", detail };
  }
  if (status === 403 || st === "PERMISSION_DENIED" || /has not been used in project|service_disabled|billing|permission/i.test(msg)) return { kind: "permission", detail };
  if (status === 503 || st === "UNAVAILABLE" || /overloaded|high demand|try again later/i.test(msg)) return { kind: "overloaded", detail };
  if (status === 400) return { kind: "bad_request", detail };
  return { kind: "unavailable", detail };
}

/** Qué falló y DÓNDE se corrige, según el motivo que informa Google (nunca el valor de la clave). */
export function permissionHelp(d: GeminiDiag | undefined, detail = ""): string {
  const r = d?.reason ?? "";
  const txt = `${r} ${detail}`.toLowerCase();
  if (r === "SERVICE_DISABLED" || /has not been used in project|is disabled|service_disabled/.test(txt))
    return "La API «Generative Language API» está deshabilitada en el proyecto de Google de la clave. Habilitala en Google Cloud Console → APIs y servicios → Biblioteca → «Generative Language API» → Habilitar (el proyecto de la clave figura en Google AI Studio → API keys).";
  if (/REFERRER|IP_ADDRESS|ANDROID|IOS/.test(r))
    return "La clave tiene restricciones de aplicación (sitios web / direcciones IP) que no sirven para un servidor de Vercel. En Google Cloud Console → APIs y servicios → Credenciales → tu clave → Restricciones de aplicaciones → «Ninguna».";
  if (r === "API_KEY_SERVICE_BLOCKED" || /api_key_service_blocked|are blocked/.test(txt))
    return "La clave tiene restringidas las APIs y no incluye «Generative Language API». Corregilo en Google Cloud Console → APIs y servicios → Credenciales → tu clave → Restricciones de API → agregá «Generative Language API» (o «No restringir la clave»).";
  if (/SUSPENDED/.test(r) || /suspended/.test(txt)) return "El proyecto de Google de la clave (o la clave) está suspendido. Revisá el estado del proyecto en Google Cloud Console / AI Studio.";
  if (/BILLING/.test(r) || /billing/.test(txt)) return "El proyecto de la clave no tiene la facturación habilitada o activa. Revisala en Google Cloud Console → Facturación.";
  return "Google rechazó el permiso sin indicar el motivo. Puede ser un modelo no habilitado para el proyecto de la clave (se probaron otros modelos), una restricción de la clave o la API deshabilitada: revisá Google AI Studio → API keys y Google Cloud Console → APIs y servicios.";
}

function messageFor(kind: FailureKind, model: string | null, tried: string[], diag?: GeminiDiag, detail = ""): string {
  switch (kind) {
    case "model":
      return tried.length > 1
        ? `Ningún modelo de Gemini disponible para esta clave pudo leer el remito (probados: ${tried.join(", ")}). Avisá a Sistemas; mientras tanto cargá los datos a mano.`
        : `El modelo de lectura «${model ?? tried[0] ?? "?"}» no existe o ya no está disponible para esta clave. Avisá a Sistemas; mientras tanto cargá los datos a mano.`;
    case "key":
      return "La clave de Gemini configurada no es válida o venció. Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "permission":
      return `La clave de Gemini no tiene permiso para usar este servicio${tried.length > 1 ? ` (probados: ${tried.join(", ")})` : ""}. ${permissionHelp(diag, detail)}${diag && diagText(diag) ? ` [${diagText(diag)}]` : ""}`;
    case "region":
      return "Gemini no está disponible desde la ubicación del servidor. Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "limit":
      return "Se alcanzó el límite de uso de Gemini por minuto (se reintentó automáticamente). Reintentá en un momento o cargá los datos a mano.";
    case "quota":
      return "La cuota de uso de Gemini está agotada (límite diario o plan). Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "bad_request":
      return "Gemini rechazó el pedido. Podés reintentar o completar los datos manualmente; si se repite, avisá a Sistemas.";
    case "overloaded":
      return "El servicio de lectura está saturado en este momento (se reintentó automáticamente). Probá de nuevo en un minuto o completá los datos manualmente: la foto no se pierde.";
    default:
      return "El servicio de lectura no está disponible ahora (no respondió tras varios intentos). Podés reintentar o completar los datos manualmente.";
  }
}

function logFailure(kind: string, status: number | null, model: string | null, detail: string) {
  // Sin claves ni contenido del remito: solo para que un fallo nunca sea invisible en los logs del servidor.
  console.warn(`[ingreso-remito] lectura automática falló (${kind}${status ? ` · HTTP ${status}` : ""}${model ? ` · modelo ${model}` : ""})${detail ? `: ${redactSecrets(detail).slice(0, 200)}` : ""}`);
}

// ───────────────────────── Llamada a Gemini con candidatos de modelo ─────────────────────────

type GeminiBody = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
  error?: GeminiError;
};
export type Attempt = { model: string; status: number | null; kind: "ok" | FailureKind; /** Motivo informado por Google (p. ej. SERVICE_DISABLED), sin datos sensibles. */ reason?: string; /** Mensaje del proveedor, saneado y acotado (sin clave ni contenido). */ detail?: string };

function generationConfig(model: string, withThinking = true, maxOutputTokens = 12288) {
  const cfg: Record<string, unknown> = { temperature: 0, responseMimeType: "application/json", maxOutputTokens };
  // Los modelos «que piensan» gastan tokens de salida razonando y pueden devolver una respuesta VACÍA (finishReason MAX_TOKENS):
  // para leer una foto no hace falta. 2.5 Flash: sin presupuesto de razonamiento; 3.x: nivel mínimo. Si el modelo no lo acepta
  // (400 «thinking») se reintenta igual sin esa opción.
  if (withThinking && (/gemini-2\.5-flash/.test(model) || /flash-latest$/.test(model)) && !/lite/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  else if (withThinking && /gemini-(3|[4-9])/.test(model)) cfg.thinkingConfig = { thinkingLevel: "low" };
  return cfg;
}

type RunResult =
  | { ok: true; body: GeminiBody; model: string; attempts: Attempt[]; calls?: number }
  | { ok: false; kind: FailureKind | "timeout"; message: string; attempts: Attempt[]; model: string | null; diag?: GeminiDiag; retryAfterMs?: number | null; calls?: number };

/**
 * Llama a generateContent probando modelos en orden: el explícito, el último que funcionó y, si hace falta, los que Google dice que existen.
 * Solo un 404 «modelo» pasa al siguiente candidato; el resto de los fallos (clave, permisos, límite…) se informan tal cual.
 */
async function runGenerate(
  parts: Array<Record<string, unknown>>,
  env: Partial<NodeJS.ProcessEnv>,
  doFetch: typeof fetch,
  opts: { maxOutputTokens?: number; json?: boolean; exclude?: string[]; /** Lectura RÁPIDA (hay otro proveedor de respaldo): 2 llamadas como máximo, sin esperas ni rondas; 429 y cuota abandonan de inmediato. */ fast?: boolean } = {}
): Promise<RunResult> {
  const cfg = extractionConfig(env);
  const attempts: Attempt[] = [];
  const tried = new Set<string>();
  const queue: string[] = [];
  const push = (m: string | null | undefined) => {
    const name = cleanModel(m ?? "");
    if (name && !tried.has(name) && !queue.includes(name) && !isDeadModel(name)) queue.push(name);
  };
  for (const m of opts.exclude ?? []) tried.add(cleanModel(m)); // modelos ya usados: no se vuelven a pedir (etapa de respaldo)
  push(cfg.model);
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) push(modelCache.working);
  let discovered = false;
  const discover = async () => {
    discovered = true;
    // Listar modelos tiene su propio tope corto: un listado colgado no puede comerse la lectura.
    const quick = ((url: string, init?: RequestInit) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 8_000);
      return doFetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
    }) as typeof fetch;
    const listed = await listModels(env, quick);
    if (listed.ok) {
      modelCache = { models: listed.models, working: modelCache?.working ?? null, at: modelCache?.at ?? Date.now() };
      for (const m of listed.models.slice(0, 6)) push(m); // el listado ya viene ordenado: estables primero
    } else {
      logFailure("no se pudo listar modelos", listed.status, null, listed.kind);
      for (const m of STATIC_FALLBACK_MODELS) push(m);
    }
  };
  if (!queue.length) {
    if (opts.fast) for (const m of STATIC_FALLBACK_MODELS.slice(0, 2)) push(m); // sin ListModels: cada ida y vuelta cuenta cuando hay un respaldo esperando
    else await discover();
  }

  const budgetMs = Math.max(50, Number(env.INGRESO_REMITO_BUDGET_MS ?? DEFAULT_BUDGET_MS) || DEFAULT_BUDGET_MS);
  const attemptMs = Math.max(20, Number(env.INGRESO_REMITO_ATTEMPT_MS ?? DEFAULT_ATTEMPT_MS) || DEFAULT_ATTEMPT_MS);
  const minAttemptMs = Math.min(MIN_ATTEMPT_MS, Math.round(attemptMs / 3));
  const deadline = Date.now() + budgetMs;
  const remaining = () => deadline - Date.now();
  let attemptTimeouts = 0;
  /** fetch con tope propio por intento (el menor entre el tope y lo que queda del presupuesto). */
  const timedFetch = async (url: string, init: RequestInit): Promise<Response> => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(1, Math.min(attemptMs, remaining())));
    try {
      // La respuesta se lee completa DENTRO del tope: devolver solo cabeceras y colgarse leyendo el cuerpo no debe ser posible.
      const res = await doFetch(url, { ...init, signal: ctl.signal });
      const text = await res.text();
      return new Response(text, { status: res.status, headers: res.headers });
    } finally {
      clearTimeout(timer);
    }
  };
  // Reintentos CONTROLADOS y con ESPERA REAL: antes se reintentaba dos veces en ~2,5 s y se informaba «saturado» aunque quedaran ~50 s de
  // presupuesto, pero una saturación de Gemini suele durar más que eso. Ahora, ante un fallo transitorio (red, 5xx, «saturado», límite
  // por minuto): espera con backoff exponencial + jitter (respetando Retry-After / RetryInfo), rota entre modelos (cada modelo tiene su
  // propia capacidad y su propio límite) y vuelve a la ronda mientras quede presupuesto y no se supere el tope de intentos.
  // Nunca reintenta errores de clave, permisos, región, modelo ni cuota agotada.
  const base = Math.max(0, Number(env.INGRESO_REMITO_RETRY_BASE_MS ?? 700) || 0);
  const maxCalls = opts.fast ? 2 : Math.max(2, Number(env.INGRESO_REMITO_MAX_ATTEMPTS ?? 9) || 9);
  let lastHint: number | null = null;
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let calls = 0;
  let transientStreak = 0; // fallos transitorios seguidos: hace crecer la espera
  let rounds = 0;
  const ring: string[] = []; // modelos que fallaron de forma transitoria (se vuelve a ellos en la ronda siguiente)
  /** Espera antes del próximo intento: exponencial con jitter, o lo que pidió el proveedor (si cabe en el presupuesto). */
  const waitFor = (retryAfterMs: number | null): number => {
    const room = Math.max(0, remaining() - minAttemptMs);
    if (retryAfterMs != null && retryAfterMs > 0) return Math.min(retryAfterMs, 15_000, room);
    const exp = Math.min(8_000, base * 2 ** Math.min(transientStreak, 5));
    return Math.min(room, Math.round(exp * (0.5 + Math.random() * 0.5)));
  };
  const retryAfterOf = (res: Response, err: GeminiError | null | undefined): number | null => {
    const h = res.headers.get("retry-after");
    if (h) {
      const sec = Number(h);
      if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
      const at = Date.parse(h);
      if (Number.isFinite(at)) return Math.max(0, at - Date.now());
    }
    const info = (err?.details as Array<Record<string, unknown>> | undefined)?.find((d) => typeof d?.retryDelay === "string");
    const m = /^(\d+(?:\.\d+)?)s$/.exec(String(info?.retryDelay ?? ""));
    return m ? Math.round(Number(m[1]) * 1000) : null;
  };
  let lastTransient: { kind: FailureKind; model: string } | null = null;
  // Un 403 puede ser de UN modelo (no habilitado para el proyecto) y no de toda la clave: se prueban otros candidatos (tope 3) antes de informarlo.
  let permissionFail: { model: string; diag: GeminiDiag; detail: string } | null = null;
  let permissionModels = 0;
  let modelMisses = 0;
  const MAX_MODEL_MISSES = 6;
  /** Vuelve a la ronda de modelos que fallaron de forma transitoria, si todavía hay presupuesto y no se superó el tope de intentos. */
  const requeue = async (): Promise<boolean> => {
    if (opts.fast || !lastTransient || ring.length === 0 || calls >= maxCalls || rounds >= 3 || remaining() < minAttemptMs * 1.5) return false;
    rounds += 1;
    const pause = waitFor(null);
    if (pause > 0) await sleep(pause);
    transientStreak = Math.min(transientStreak + 1, 5);
    for (const m of ring.splice(0)) queue.push(m);
    return queue.length > 0;
  };
  try {
    for (;;) {
      if (modelMisses >= MAX_MODEL_MISSES) break;
      if (!queue.length && !(await requeue())) break;
      const model = queue.shift()!;
      tried.add(model);
      let withThinking = true;
      let transientTries = 0;
      let moveOn = false;
      for (let n = 0; n < 6 && !moveOn; n++) {
        if (calls >= maxCalls) break;
        calls += 1;
        const gc = generationConfig(model, withThinking, opts.maxOutputTokens);
        if (opts.json === false) delete gc.responseMimeType;
        let res: Response;
        try {
          if (remaining() < Math.min(1_500, minAttemptMs)) throw Object.assign(new Error("presupuesto agotado"), { name: "AbortError" });
          res = await timedFetch(`${baseUrl(env)}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
            body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gc }),
          });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            // Un intento colgado NO consume toda la lectura: si queda tiempo se prueba otro modelo (o se reintenta una vez el mismo).
            attemptTimeouts += 1;
            attempts.push({ model, status: null, kind: "unavailable" });
            logFailure("intento sin respuesta a tiempo", null, model, `quedan ${Math.max(0, Math.round(remaining() / 1000))} s`);
            if (remaining() < minAttemptMs || attemptTimeouts >= 3) throw err;
            lastTransient = { kind: "unavailable", model };
            if (!queue.length && !discovered) await discover();
            if (queue.length) moveOn = true;
            else if (attemptTimeouts >= 2) throw err;
            continue;
          }
          attempts.push({ model, status: null, kind: "unavailable" });
          logFailure("red", null, model, err instanceof Error ? err.message : "");
          if (transientTries < 1) {
            transientTries += 1;
            await sleep(waitFor(null));
            transientStreak += 1;
            continue;
          }
          lastTransient = { kind: "unavailable", model };
          ring.push(model);
          moveOn = true;
          continue;
        }
        const body = (await res.json().catch(() => null)) as GeminiBody | null;
        if (res.ok && body === null) {
          // 200 con cuerpo ilegible (cortado): se trata como falla transitoria.
          attempts.push({ model, status: res.status, kind: "unavailable" });
          if (transientTries < 1 && remaining() > minAttemptMs) {
            transientTries += 1;
            await sleep(waitFor(null));
            transientStreak += 1;
            continue;
          }
          lastTransient = { kind: "unavailable", model };
          ring.push(model);
          moveOn = true;
          continue;
        }
        if (res.ok) {
          attempts.push({ model, status: res.status, kind: "ok" });
          modelCache = { models: modelCache?.models ?? [], working: model, at: Date.now() };
          return { ok: true, body: body ?? {}, model, attempts, calls };
        }
        const cls = classifyHttp(res.status, body?.error);
        if (cls.kind === "bad_request" && withThinking && /thinking/i.test(cls.detail)) {
          withThinking = false; // este modelo no acepta «thinkingConfig»: se reintenta igual sin él
          continue;
        }
        attempts.push({ model, status: res.status, kind: cls.kind, reason: diagOf(res.status, body?.error).reason || undefined, detail: cls.detail || undefined });
        logFailure(cls.kind, res.status, model, `${diagText(diagOf(res.status, body?.error))} ${cls.detail}`);
        if (cls.kind === "model") {
          // Un 404 es una respuesta inmediata sobre ESE modelo (aparecer en el listado no garantiza que se pueda usar): se descarta y se pasa al
          // siguiente SIN gastar el cupo de llamadas pensado para saturación o timeout, con un tope propio de modelos descartados.
          deadModels.set(model, Date.now());
          modelMisses += 1;
          calls -= 1;
          if (modelCache?.working === model) modelCache = { ...modelCache, working: null };
          if (modelMisses >= MAX_MODEL_MISSES) break;
          if (!queue.length && !discovered) await discover();
          moveOn = true;
          continue;
        }
        if (cls.kind === "permission") {
          permissionFail ??= { model, diag: diagOf(res.status, body?.error), detail: cls.detail };
          permissionModels += 1;
          if (permissionModels < 3) {
            if (!queue.length && !discovered) await discover();
            if (queue.length) {
              moveOn = true;
              continue;
            }
          }
          return { ok: false, kind: "permission", message: messageFor("permission", model, [...tried], permissionFail.diag, permissionFail.detail), attempts, model, diag: permissionFail.diag };
        }
        if (cls.kind === "overloaded" || cls.kind === "unavailable" || cls.kind === "limit") {
          const hint = retryAfterOf(res, body?.error);
          lastHint = hint;
          // Límite por minuto: cada modelo tiene su propio cupo, así que se pasa al siguiente sin esperar; con un único modelo se espera lo que pide el proveedor.
          const sameModelRetries = cls.kind === "limit" || opts.fast ? 0 : 1;
          lastTransient = { kind: cls.kind, model };
          // Con respaldo disponible (lectura rápida) un 429 no se espera ni se rota: el cupo se agotó, se pasa al otro proveedor YA.
          if (opts.fast && cls.kind === "limit") return { ok: false, kind: "limit", message: messageFor("limit", model, [...tried]), attempts, model, retryAfterMs: hint, calls };
          if (transientTries < sameModelRetries || (cls.kind === "limit" && !queue.length && !ring.length && transientTries < 1)) {
            transientTries += 1;
            await sleep(waitFor(hint));
            transientStreak += 1;
            continue;
          }
          if (!ring.includes(model)) ring.push(model);
          if (!queue.length && !discovered) await discover();
          moveOn = true; // otro modelo puede estar menos saturado
          continue;
        }
        if (cls.kind === "quota") {
          // Cuota agotada (diaria / facturación): reintentar no sirve. Se informa y queda el diagnóstico para Sistemas.
          return { ok: false, kind: "quota", message: messageFor("quota", model, [...tried]), attempts, model, diag: diagOf(res.status, body?.error), retryAfterMs: retryAfterOf(res, body?.error), calls };
        }
        return { ok: false, kind: cls.kind, message: messageFor(cls.kind, model, [...tried]), attempts, model, diag: diagOf(res.status, body?.error) };
      }
    }
    if (permissionFail) return { ok: false, kind: "permission", message: messageFor("permission", permissionFail.model, [...tried], permissionFail.diag, permissionFail.detail), attempts, model: permissionFail.model, diag: permissionFail.diag };
    if (lastTransient) return { ok: false, kind: lastTransient.kind, message: messageFor(lastTransient.kind, lastTransient.model, [...tried]), attempts, model: lastTransient.model, retryAfterMs: lastHint, calls };
    return { ok: false, kind: "model", message: messageFor("model", null, [...tried]), attempts, model: null };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logFailure(aborted ? "timeout" : "red", null, null, err instanceof Error ? err.message : "");
    return aborted
      ? { ok: false, kind: "timeout", message: "La lectura tardó demasiado. Podés reintentar o completar los datos manualmente.", attempts, model: null }
      : { ok: false, kind: "unavailable", message: "No se pudo contactar al servicio de lectura. Podés reintentar o completar los datos manualmente.", attempts, model: null };
  }
}

const PROMPT_BASE = `Leé este documento de ingreso de un laboratorio argentino: un REMITO o factura de proveedor (varios renglones) o la ETIQUETA de UN envase o bolsa (un solo producto: una única línea). Las imágenes son del MISMO documento. Extraé SOLO lo necesario para cargar el ingreso; ignorá logos, publicidad, diseños, condiciones comerciales, textos legales, firmas, datos fiscales y de transporte. Respondé SOLO un JSON compacto:
{"supplier":"","remitoNumber":"","remitoDate":"YYYY-MM-DD","notes":"","unclearFields":[],"lines":[{"supplierCode":"","description":"","quantity":null,"quantityText":"","handwrittenQuantity":"","unit":"","packages":null,"lot":"","expiryDate":"YYYY-MM-DD","notes":"","confidence":0.9,"unclearFields":[],"inferredFields":[]}]}
Reglas:
- "supplier": quien EMITE el documento o fabrica el producto (no Laboratorio Genus). "remitoNumber": el N.º del remito (no la orden de compra, el pedido ni el CUIT).
- UNA línea por renglón de la tabla. NUNCA inventes ni completes lo que no se lee con claridad: dejá "" o null y poné el nombre del campo en "unclearFields".
- "quantity": número (punto decimal). "quantityText": la cantidad IMPRESA tal cual se ve («1.000», «10.000», «25,5»). En Argentina el punto separa miles y la coma los decimales: 1.000 = mil. No confundas la cantidad con el N.º de remito, la orden, el lote, los bultos ni la cantidad por caja. Si dice «N bultos de X» y no hay total: quantity = N × X, "packages" = N y "quantity" en "inferredFields".
- Si hay un número ESCRITO A MANO que corrige o reemplaza la cantidad impresa, ponelo en "handwrittenQuantity" y dejá "quantity"/"quantityText" con lo IMPRESO.
- "supplierCode": el código del PROVEEDOR del renglón (columna Código, Art., Ref., SKU…); nunca el N.º de remito, el lote ni una cantidad.
- "unit": la unidad escrita (kg, g, un, l, cajas…). "lot" y "expiryDate" (ISO) solo si están impresos o escritos; «MM/AAAA» sin día: último día del mes y "expiryDate" en "inferredFields".
- "inferredFields": lo que NO está escrito literalmente y normalizaste o dedujiste. "notes": solo observaciones relevantes para el ingreso{EXTRA_NOTES}. "confidence" 0–1.
- Foto inclinada, con sombras, arrugada, tabla desalineada o notas a mano: leé todo lo razonablemente reconocible; una línea ilegible igual se devuelve con "unclearFields". Omití las claves vacías.
- Si la imagen no contiene un documento o etiqueta legible, devolvé {"supplier":"","remitoNumber":"","remitoDate":"","notes":"","unclearFields":[],"lines":[]}.`;

const MODULE_HINT: Record<"MP" | "ME", { intro: string; extraNotes: string }> = {
  MP: {
    intro: "Contexto: MATERIAS PRIMAS (químicos, aceites, activos, colorantes, fragancias). Prestá especial atención a código, nombre del producto, proveedor, lote, cantidad (kg/g/l) y fecha de vencimiento / re-análisis.",
    extraNotes: "; si figuran el CLIENTE o la UBICACIÓN, copialos en notes con el formato «Cliente: …» / «Ubicación: …»",
  },
  ME: {
    intro: "Contexto: DEPÓSITO — MATERIALES DE ENVASE (frascos, tapas, cajas, etiquetas, bolsas). Prestá especial atención a código, descripción, proveedor, cliente para el que se fabrica (si figura), lote (solo si corresponde), cantidad (unidades o cajas) y ubicación.",
    extraNotes: "; si figuran el CLIENTE o la UBICACIÓN, copialos en notes con el formato «Cliente: …» / «Ubicación: …»",
  },
};

function promptFor(module: "MP" | "ME" | undefined): string {
  const h = MODULE_HINT[module ?? "MP"];
  return `${h.intro}\n${PROMPT_BASE.replace("{EXTRA_NOTES}", h.extraNotes)}`;
}

export type ExtractionFile = { bytes: Uint8Array; contentType: string };
/** Resultado de UN proveedor dentro de una etapa (para Sistemas: quién respondió, cuánto tardó, cuánto consumió y por qué falló). */
export type ProviderOutcome = {
  provider: ProviderId;
  ok: boolean;
  ms: number;
  calls: number;
  model?: string | null;
  kind?: string;
  http?: number | null;
  tokens?: { prompt?: number; output?: number; total?: number };
  /** El circuit breaker lo salteó (no se lo llamó). */
  skipped?: "breaker";
  /** Motivo técnico del rechazo, saneado (código/mensaje del proveedor) para Sistemas. */
  detail?: string;
};
/** Diagnóstico para Sistemas (sin claves ni contenido del remito): permite ver rápido si falla GENUS OS, Vercel, el proveedor o la imagen. */
export type ReadStageDiag = {
  stage: "lectura" | "mejora" | "respaldo";
  ok: boolean;
  ms: number;
  model?: string | null;
  provider?: ProviderId;
  providers?: ProviderOutcome[];
  calls?: number;
  kind?: string;
  http?: number | null;
  /** Campos que esta etapa logró completar. */
  recovered?: string[];
  tokens?: { prompt?: number; output?: number; total?: number };
  note?: string;
};
export type ReadDiag = {
  provider: ProviderId;
  model: string | null;
  elapsedMs: number;
  stages: ReadStageDiag[];
  /** Intentos HTTP al proveedor por resultado: {ok:1, overloaded:2}. */
  attempts: Record<string, number>;
  /** Campos importantes todavía sin leer al terminar. */
  pending: string[];
  enhanced: boolean;
  errorKind?: string;
  failedStage?: string;
  http?: number | null;
  tokens?: { prompt?: number; output?: number; total?: number };
  /** Resumen por proveedor (llamadas, tiempo, tokens, resultado). */
  providers?: Record<string, { calls: number; ms: number; ok: boolean; kind?: string; http?: number | null; model?: string | null; tokens?: { prompt?: number; output?: number; total?: number }; skipped?: number }>;
  /** true = respondió el proveedor de respaldo porque el principal falló o estaba salteado. */
  fallback?: boolean;
  configured?: ProviderId[];
};

export type ExtractionOutcome =
  | { ok: true; data: ExtractedRemito; provider: string; model: string; /** La respuesta venía cortada: se rescataron solo los renglones completos. */ partial?: boolean; elapsedMs?: number; /** Campos importantes que siguen sin leerse (ver importantMissing). */ pending?: string[]; diag?: ReadDiag }
  | { ok: false; message: string; kind: "disabled" | "config" | FailureKind | "unreadable" | "timeout"; /** Texto técnico para Sistemas (no se muestra al operario). */ technical?: string; diag?: ReadDiag };

/**
 * Rescata lo aprovechable de un JSON cortado (respuesta truncada por tokens o por corte de red): el encabezado y los renglones que
 * quedaron COMPLETOS. Nunca completa ni adivina lo que falta. Devuelve null si no hay nada aprovechable.
 */
export function salvagePartialJson(text: string): Record<string, unknown> | null {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "");
  const out: Record<string, unknown> = {};
  const linesAt = t.search(/"lines"\s*:\s*\[/);
  const head = linesAt >= 0 ? t.slice(0, linesAt) : t; // el encabezado va antes de los renglones: no confundir con "notes" de un renglón
  for (const key of ["supplier", "remitoNumber", "remitoDate", "notes"]) {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head);
    if (m) {
      try {
        out[key] = JSON.parse(`"${m[1]}"`);
      } catch {
        /* campo ilegible: queda vacío */
      }
    }
  }
  const lines: unknown[] = [];
  const at = t.search(/"lines"\s*:\s*\[/);
  if (at >= 0) {
    let i = t.indexOf("[", at) + 1;
    let depth = 0;
    let start = -1;
    let inStr = false;
    for (; i < t.length; i++) {
      const ch = t[i]!;
      if (inStr) {
        if (ch === "\\") i++;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            lines.push(JSON.parse(t.slice(start, i + 1)));
          } catch {
            /* renglón dañado: se omite */
          }
          start = -1;
        }
      } else if (ch === "]" && depth === 0) break;
    }
  }
  if (lines.length === 0 && !out.supplier && !out.remitoNumber) return null;
  out.lines = lines;
  return out;
}

type ExtractionFailureKind = FailureKind | "unreadable" | "timeout";
type StageOk = { ok: true; data: ExtractedRemito; model: string; provider: ProviderId; partial: boolean; calls: number; attempts: Attempt[]; tokens?: ReadStageDiag["tokens"]; outcomes: ProviderOutcome[] };
type StageFail = { ok: false; kind: ExtractionFailureKind; technical: string; model: string | null; provider: ProviderId | null; attempts: Attempt[]; calls: number; http: number | null; outcomes: ProviderOutcome[] };
type StageRead = StageOk | StageFail;

const tokensOf = (body: GeminiBody): ReadStageDiag["tokens"] | undefined => {
  const u = (body as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
  return u ? { prompt: u.promptTokenCount, output: u.candidatesTokenCount, total: u.totalTokenCount } : undefined;
};

/** Salida de un proveedor, normalizada: texto JSON (mismo esquema para todos) o fallo clasificado. */
type ProviderResult =
  | { ok: true; provider: ProviderId; model: string; text: string; finishReason: string; blocked?: string; attempts: Attempt[]; calls: number; tokens?: ReadStageDiag["tokens"]; ms: number }
  | { ok: false; provider: ProviderId; kind: ExtractionFailureKind; message: string; model: string | null; attempts: Attempt[]; calls: number; http: number | null; retryAfterMs: number | null; ms: number; detail?: string };

async function callGemini(parts: Array<Record<string, unknown>>, env: Partial<NodeJS.ProcessEnv>, doFetch: typeof fetch, opts: { exclude?: string[]; fast?: boolean }): Promise<ProviderResult> {
  const t0 = Date.now();
  let run = await runGenerate(parts, env, doFetch, { exclude: opts.exclude, fast: opts.fast });
  // Respuesta cortada por tokens (modelo que «piensa» de más): un único reintento con más margen.
  if (run.ok && !run.body.candidates?.[0]?.content?.parts?.some((p) => (p.text ?? "").trim()) && run.body.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    logFailure("respuesta cortada (MAX_TOKENS)", null, run.model, "reintento con más margen");
    run = await runGenerate(parts, env, doFetch, { maxOutputTokens: 24576, exclude: opts.exclude, fast: opts.fast });
  }
  if (!run.ok) return { ok: false, provider: "gemini", kind: run.kind, message: run.message, model: run.model, attempts: run.attempts, calls: run.calls ?? run.attempts.length, http: run.attempts.at(-1)?.status ?? null, retryAfterMs: run.retryAfterMs ?? null, ms: Date.now() - t0 };
  const cand = run.body.candidates?.[0];
  return { ok: true, provider: "gemini", model: run.model, text: cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "", finishReason: cand?.finishReason ?? "", blocked: run.body.promptFeedback?.blockReason, attempts: run.attempts, calls: run.calls ?? run.attempts.length, tokens: tokensOf(run.body), ms: Date.now() - t0 };
}

async function callOpenAI(parts: Array<Record<string, unknown>>, env: Partial<NodeJS.ProcessEnv>, doFetch: typeof fetch): Promise<ProviderResult> {
  const r = await runOpenAI(parts, env, doFetch);
  const attempts = r.attempts.map((a) => ({ model: a.model, status: a.status, kind: (a.kind === "unsupported" ? "bad_request" : a.kind) as Attempt["kind"], detail: a.error ? [a.error.type, a.error.code, a.error.param ? `param ${a.error.param}` : "", a.error.message].filter(Boolean).join(" · ").slice(0, 300) : undefined }));
  if (r.ok) return { ok: true, provider: "openai", model: r.model, text: r.text, finishReason: r.finishReason, attempts, calls: r.calls, tokens: r.tokens, ms: r.ms };
  const kind: ExtractionFailureKind = r.kind === "unsupported" ? "unreadable" : r.kind === "bad_request" ? "bad_request" : r.kind;
  return { ok: false, provider: "openai", kind, message: r.message, model: r.model, attempts, calls: r.calls, http: r.http, retryAfterMs: r.retryAfterMs, ms: r.ms, detail: attempts.at(-1)?.detail };
}

/** Interpreta el texto de un proveedor con el saneamiento ÚNICO (mismo esquema para Gemini y OpenAI). */
function parseProviderText(r: Extract<ProviderResult, { ok: true }>): { ok: true; data: ExtractedRemito; partial: boolean } | { ok: false; technical: string } {
  if (r.blocked) {
    logFailure("bloqueado", null, r.model, r.blocked);
    return { ok: false, technical: `bloqueado: ${r.blocked}` };
  }
  if (!r.text.trim()) {
    logFailure("respuesta vacía", null, r.model, r.finishReason);
    return { ok: false, technical: `respuesta vacía (${r.finishReason || "?"})` };
  }
  let parsed: unknown;
  let partial = false;
  try {
    parsed = JSON.parse(r.text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    // Respuesta cortada: se aprovecha lo que quedó completo en vez de rechazar todo el remito.
    parsed = salvagePartialJson(r.text);
    partial = parsed != null;
    if (!partial) {
      logFailure("JSON inválido", null, r.model, r.finishReason);
      return { ok: false, technical: `JSON inválido (${r.finishReason || "?"})` };
    }
    logFailure("JSON cortado: lectura parcial", null, r.model, r.finishReason);
  }
  const data = sanitizeExtraction(parsed);
  if (!data) {
    logFailure("sin datos de remito", null, r.model, "");
    return { ok: false, technical: "sin datos de remito" };
  }
  return { ok: true, data, partial };
}

/**
 * UNA lectura con respaldo automático entre proveedores. Orden: el principal (Gemini) en modo RÁPIDO (máx. 2 llamadas, sin esperas, tope de
 * ~14 s) y, si falla por disponibilidad (503, 429, cuota, timeout, modelo caído, configuración), pasa SOLO al respaldo (OpenAI) con el
 * presupuesto que se reservó para eso. El circuit breaker saltea un proveedor que viene fallando: un remito nuevo no vuelve a esperar a
 * un proveedor caído. Si hay un único proveedor, usa todo el presupuesto con reintentos. Nunca lanza.
 */
async function readStage(
  parts: Array<Record<string, unknown>>,
  env: Partial<NodeJS.ProcessEnv>,
  doFetch: typeof fetch,
  opts: { budgetMs: number; health: ProviderHealthStore; exclude?: string[]; excludeProviders?: ProviderId[]; prefer?: ProviderId | null }
): Promise<StageRead> {
  const t0 = Date.now();
  const left = () => opts.budgetMs - (Date.now() - t0);
  let order = providerOrder(env).filter((p) => !(opts.excludeProviders ?? []).includes(p));
  if (opts.prefer && order.includes(opts.prefer)) order = [opts.prefer, ...order.filter((p) => p !== opts.prefer)];
  const outcomes: ProviderOutcome[] = [];
  const allAttempts: Attempt[] = [];
  let last: Extract<ProviderResult, { ok: false }> | null = null;
  if (order.length === 0) {
    return { ok: false, kind: "unavailable", technical: "sin proveedores de lectura configurados", model: null, provider: null, attempts: [], calls: 0, http: null, outcomes };
  }
  // Un proveedor con el circuito abierto se saltea mientras haya otro que probar; si TODOS están abiertos se prueban igual (último recurso).
  const states = await Promise.all(order.map((p) => isProviderOpen(opts.health, p)));
  const openSet = new Set(order.filter((_, i) => states[i]!.open));
  const usable = order.filter((p) => !openSet.has(p));
  const plan = usable.length > 0 ? usable : order;
  for (const p of order) if (!plan.includes(p)) outcomes.push({ provider: p, ok: false, ms: 0, calls: 0, skipped: "breaker", kind: states[order.indexOf(p)]!.state.lastKind ?? "unavailable", http: states[order.indexOf(p)]!.state.lastHttp });
  const FAST_BUDGET = Math.max(50, Number(env.INGRESO_REMITO_FAST_BUDGET_MS ?? 14_000) || 14_000);
  const FAST_ATTEMPT = Math.max(20, Number(env.INGRESO_REMITO_FAST_ATTEMPT_MS ?? 8_000) || 8_000);
  for (let i = 0; i < plan.length; i++) {
    const provider = plan[i]!;
    const hasBackup = i < plan.length - 1;
    if (left() < 50) break;
    // Con respaldo esperando, el principal usa solo una porción (tope ~14 s) y deja el resto del tiempo para el respaldo.
    const slice = hasBackup ? Math.max(50, Math.min(FAST_BUDGET, Math.round(left() * 0.35))) : Math.max(50, left());
    const attempt = hasBackup ? Math.min(FAST_ATTEMPT, Math.max(20, Math.round(slice * 0.7))) : Number(env.INGRESO_REMITO_ATTEMPT_MS ?? DEFAULT_ATTEMPT_MS) || DEFAULT_ATTEMPT_MS;
    const pEnv = { ...env, INGRESO_REMITO_BUDGET_MS: String(slice), INGRESO_REMITO_ATTEMPT_MS: String(Math.min(attempt, slice)) } as Partial<NodeJS.ProcessEnv>;
    const r = provider === "gemini" ? await callGemini(parts, pEnv, doFetch, { exclude: opts.exclude, fast: hasBackup }) : await callOpenAI(parts, pEnv, doFetch);
    allAttempts.push(...r.attempts);
    if (r.ok) {
      await opts.health.recordSuccess(provider);
      const parsed = parseProviderText(r);
      outcomes.push({ provider, ok: true, ms: r.ms, calls: r.calls, model: r.model, tokens: r.tokens });
      if (parsed.ok) return { ok: true, data: parsed.data, model: r.model, provider, partial: parsed.partial, calls: r.calls, attempts: allAttempts, tokens: r.tokens, outcomes };
      // El proveedor respondió pero no hay nada legible: NO es una falla de disponibilidad (se sigue con la mejora de imagen).
      return { ok: false, kind: "unreadable", technical: parsed.technical, model: r.model, provider, attempts: allAttempts, calls: r.calls, http: null, outcomes };
    }
    last = r;
    outcomes.push({ provider, ok: false, ms: r.ms, calls: r.calls, model: r.model, kind: r.kind, http: r.http, detail: r.detail ?? r.attempts.at(-1)?.detail });
    await opts.health.recordFailure(provider, { kind: r.kind, http: r.http, retryAfterMs: r.retryAfterMs });
    logFailure(`proveedor ${provider} no disponible${hasBackup ? " → respaldo" : ""}`, r.http, r.model, `${r.kind} · ${Math.round(r.ms)} ms`);
  }
  const f = last;
  return { ok: false, kind: f?.kind ?? "unavailable", technical: f ? `${f.provider}: ${f.message}` : "ningún proveedor respondió a tiempo", model: f?.model ?? null, provider: f?.provider ?? null, attempts: allAttempts, calls: allAttempts.length, http: f?.http ?? null, outcomes };
}

const PENDING_LABEL: Record<string, string> = { remitoNumber: "n.º de remito", remitoDate: "fecha", supplier: "proveedor", lines: "materiales", quantity: "cantidad", description: "descripción" };
function pendingNames(d: ExtractedRemito | null): string[] {
  if (!d) return ["remitoNumber", "remitoDate", "supplier", "lines"];
  const m = importantMissing(d);
  return [...m.header, ...(m.noLines ? ["lines"] : []), ...new Set(m.lines.flatMap((l) => l.fields))];
}
export const pendingLabel = (f: string) => PENDING_LABEL[f] ?? f;

/** Pedido de la 2.ª etapa: solo lo que falta; lo ya identificado se informa para NO releerlo ni cambiarlo. */
function stage2Prompt(module: "MP" | "ME" | undefined, known: ExtractedRemito | null, regions: string[]): string {
  const known_ = known
    ? JSON.stringify({ supplier: known.supplier || undefined, remitoNumber: known.remitoNumber || undefined, remitoDate: known.remitoDate || undefined, lines: known.lines.map((l, i) => ({ i, supplierCode: l.supplierCode || undefined, description: l.description || undefined, quantity: l.quantity || undefined })) })
    : "{}";
  const miss = known ? importantMissing(known) : null;
  const need = miss
    ? [...miss.header.map(pendingLabel), ...(miss.noLines ? ["los renglones (materiales y cantidades)"] : []), ...miss.lines.map((l) => `renglón ${l.index + 1}: ${l.fields.map(pendingLabel).join(" y ")}`)].join("; ")
    : "todo";
  return `${promptFor(module)}\n\nSEGUNDA LECTURA con las imágenes MEJORADAS (iluminación corregida, contraste y nitidez${regions.length ? `; además ampliaciones de: ${regions.join(", ")}` : ""}). Ya se identificó esto (NO lo repitas ni lo cambies; puede ir vacío): ${known_}\nRecuperá SOLO lo que falta: ${need}. Respetá el mismo JSON y las mismas reglas; si algo sigue ilegible dejalo "" o null y listalo en "unclearFields".`;
}

const sumAttempts = (a: Attempt[]) => a.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.kind]: (acc[x.kind] ?? 0) + 1 }), {});

/**
 * Lectura PROGRESIVA y eficiente. Etapa 1: la imagen original, pidiendo solo los campos necesarios. Etapa 2 (SOLO si falta algo importante):
 * copia mejorada de la imagen (+ ampliaciones del encabezado / tabla) y se releen únicamente los faltantes; lo ya identificado no se pisa.
 * Etapa 3 (solo si todavía falta y hay otro modelo disponible): el mismo pedido con otro modelo. Presupuesto total acotado: si la 1.ª lectura
 * alcanza no hay más llamadas. Nunca lanza: ante cualquier falla devuelve ok:false con un mensaje claro (y el diagnóstico para Sistemas).
 */
export async function extractRemito(files: ExtractionFile[], deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; module?: "MP" | "ME"; /** Circuit breaker de proveedores (por defecto en memoria; el servicio inyecta el compartido en la base). */ health?: ProviderHealthStore; /** Avisa al cambiar de etapa (la pantalla muestra «Mejorando la imagen…»). Un error acá nunca frena la lectura. */ onStage?: (stage: "lectura" | "mejora") => Promise<void> | void } = {}): Promise<ExtractionOutcome> {
  const env = deps.env ?? process.env;
  const cfg = extractionConfig(env);
  if (!cfg.available) return { ok: false, kind: cfg.code === "missing_key" ? "config" : "disabled", message: cfg.reason };
  if (files.length === 0) return { ok: false, kind: "unreadable", message: "No hay archivos para leer." };
  const doFetch = deps.fetchImpl ?? fetch;
  const health = deps.health ?? memoryHealth;
  const used: ExtractionFile[] = [];
  let total = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    if (total + f.bytes.length > MAX_TOTAL_BYTES) break;
    used.push(f);
    total += f.bytes.length;
  }
  const startedAt = Date.now();
  const budget = Math.max(50, Number(env.INGRESO_REMITO_BUDGET_MS ?? DEFAULT_BUDGET_MS) || DEFAULT_BUDGET_MS);
  const left = () => budget - (Date.now() - startedAt);
  const stages: ReadStageDiag[] = [];
  const allAttempts: Attempt[] = [];
  const outcomesAll: ProviderOutcome[] = [];
  const addOutcomes = (o: ProviderOutcome[]) => outcomesAll.push(...o);
  const providerSummary = (): NonNullable<ReadDiag["providers"]> => {
    const sum: NonNullable<ReadDiag["providers"]> = {};
    for (const o of outcomesAll) {
      const cur = sum[o.provider] ?? { calls: 0, ms: 0, ok: false, skipped: 0 };
      const tokens = o.tokens ? { prompt: (cur.tokens?.prompt ?? 0) + (o.tokens.prompt ?? 0), output: (cur.tokens?.output ?? 0) + (o.tokens.output ?? 0), total: (cur.tokens?.total ?? 0) + (o.tokens.total ?? 0) } : cur.tokens;
      sum[o.provider] = { calls: cur.calls + o.calls, ms: cur.ms + o.ms, ok: cur.ok || o.ok, kind: o.ok ? cur.kind : o.kind ?? cur.kind, http: o.ok ? cur.http : o.http ?? cur.http, model: o.model ?? cur.model, ...(tokens ? { tokens } : {}), skipped: (cur.skipped ?? 0) + (o.skipped ? 1 : 0) };
    }
    return sum;
  };
  const diagBase = (extra: Partial<ReadDiag> = {}): ReadDiag => ({ provider: cfg.providers[0] ?? "gemini", model: null, elapsedMs: Date.now() - startedAt, stages, attempts: sumAttempts(allAttempts), pending: [], enhanced: false, providers: providerSummary(), configured: cfg.providers, ...extra });
  const stageEnv = (ms: number) => ({ ...env, INGRESO_REMITO_BUDGET_MS: String(Math.max(50, Math.round(ms))) }) as Partial<NodeJS.ProcessEnv>;
  const withImages = (prompt: string, imgs: Array<{ bytes: Uint8Array; contentType: string }>) => [{ text: prompt }, ...imgs.map((f) => ({ inline_data: { mime_type: f.contentType, data: Buffer.from(f.bytes).toString("base64") } }))] as Array<Record<string, unknown>>;
  const stageDiag = (stage: ReadStageDiag["stage"], t: number, r: StageRead, extra: Partial<ReadStageDiag> = {}): ReadStageDiag => ({
    stage, ok: r.ok, ms: Date.now() - t, model: r.model, provider: r.provider ?? undefined, providers: r.outcomes, calls: r.calls, ...(r.ok ? { tokens: r.tokens } : { kind: r.kind, http: r.http }), ...extra,
  });

  // ── Etapa 1: imagen original, solo los campos necesarios (Gemini rápido → OpenAI si falla) ──
  const t1 = Date.now();
  const r1 = await readStage(withImages(promptFor(deps.module), used), stageEnv(Math.min(left(), budget * 0.72)), doFetch, { budgetMs: Math.min(left(), budget * 0.72), health });
  allAttempts.push(...r1.attempts);
  addOutcomes(r1.outcomes);
  stages.push(stageDiag("lectura", t1, r1));
  // Ningún proveedor disponible (NO es culpa de la imagen): no se pide otra foto ni se gasta tiempo mejorando la imagen.
  if (!r1.ok && r1.kind !== "unreadable") {
    return { ok: false, kind: r1.kind, message: operatorMessage(r1.kind), technical: r1.technical, diag: diagBase({ model: r1.model, errorKind: r1.kind, failedStage: "lectura", http: r1.http, pending: pendingNames(null), fallback: false }) };
  }
  let data: ExtractedRemito | null = r1.ok ? r1.data : null;
  let model = r1.model ?? "";
  let usedProvider: ProviderId | null = r1.provider;
  let partial = r1.ok ? r1.partial : false;
  let enhanced = false;
  let pending = pendingNames(data);

  // ── Etapa 2: mejora automática de la imagen, solo si falta algo importante (con el proveedor que SÍ respondió) ──
  const enhanceOn = !["0", "false", "off", "no"].includes(String(env.INGRESO_REMITO_ENHANCE ?? "").toLowerCase());
  const MIN_STAGE_MS = Math.min(9_000, Math.round(budget / 5));
  if (pending.length > 0 && enhanceOn && left() >= MIN_STAGE_MS) {
    try { await deps.onStage?.("mejora"); } catch { /* informativo */ }
    const t2 = Date.now();
    const miss = data ? importantMissing(data) : null;
    const regions: Array<"encabezado" | "tabla"> = [];
    if (!miss || miss.header.length) regions.push("encabezado");
    if (!miss || miss.noLines || miss.lines.length) regions.push("tabla");
    const enh = await enhanceReceiptImages(used, { regions });
    if (enh.applied) {
      enhanced = true;
      const budget2 = left() * 0.65;
      const r2 = await readStage(withImages(stage2Prompt(deps.module, data, regions.map((r) => (r === "encabezado" ? "el encabezado" : "la tabla"))), enh.images), stageEnv(budget2), doFetch, { budgetMs: budget2, health, prefer: usedProvider });
      allAttempts.push(...r2.attempts);
      addOutcomes(r2.outcomes);
      const before = pendingNames(data);
      if (r2.ok) {
        data = data ? mergeExtractions(data, r2.data) : r2.data;
        model = model || r2.model;
        usedProvider = usedProvider ?? r2.provider;
        partial = partial && r2.partial;
        pending = pendingNames(data);
      }
      stages.push(stageDiag("mejora", t2, r2, { recovered: before.filter((f) => !pending.includes(f)) }));
    } else {
      stages.push({ stage: "mejora", ok: false, ms: Date.now() - t2, kind: "no_aplicable", note: enh.reason });
    }
  }

  // ── Etapa 3: otro proveedor (o, con uno solo, otro modelo), si todavía falta lo importante y hay tiempo ──
  if (pending.length > 0 && enhanced && left() >= MIN_STAGE_MS && model) {
    const t3 = Date.now();
    const miss = data ? importantMissing(data) : null;
    const enh = await enhanceReceiptImages(used, { regions: miss && !miss.header.length && !miss.noLines ? ["tabla"] : [] });
    if (enh.applied) {
      const others = providerOrder(env).filter((p) => p !== usedProvider);
      const r3 = await readStage(withImages(stage2Prompt(deps.module, data, []), enh.images), stageEnv(left()), doFetch, { budgetMs: left(), health, ...(others.length ? { excludeProviders: usedProvider ? [usedProvider] : [] } : { exclude: [model] }) });
      allAttempts.push(...r3.attempts);
      addOutcomes(r3.outcomes);
      const before = pending;
      if (r3.ok) {
        data = data ? mergeExtractions(data, r3.data) : r3.data;
        pending = pendingNames(data);
      }
      stages.push(stageDiag("respaldo", t3, r3, { recovered: before.filter((f) => !pending.includes(f)) }));
    }
  }

  const primary = cfg.providers[0];
  const fallback = Boolean(usedProvider && primary && usedProvider !== primary);
  const diag = diagBase({ provider: usedProvider ?? primary ?? "gemini", model: model || null, enhanced, pending, fallback, tokens: stages.reduce<ReadDiag["tokens"]>((acc, st) => (st.tokens ? { prompt: (acc?.prompt ?? 0) + (st.tokens.prompt ?? 0), output: (acc?.output ?? 0) + (st.tokens.output ?? 0), total: (acc?.total ?? 0) + (st.tokens.total ?? 0) } : acc), undefined) });
  if (!data || (data.lines.length === 0 && !data.supplier && !data.remitoNumber)) {
    // Un proveedor respondió pero no hay nada legible incluso después de mejorar la imagen: recién ahora se pide una imagen más clara.
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE, technical: r1.ok ? "sin datos legibles" : r1.technical, diag: { ...diag, errorKind: "unreadable", failedStage: stages.at(-1)?.stage } };
  }
  return { ok: true, data, provider: `${usedProvider ?? "gemini"}:${model}`, model, elapsedMs: Date.now() - startedAt, pending, diag, ...(partial ? { partial: true } : {}) };
}

/** Mensaje para el OPERARIO según la causa: fallas del servicio no culpan a la imagen ni piden otra foto. */
export function operatorMessage(kind: ExtractionFailureKind | "disabled" | "config"): string {
  return kind === "unreadable" ? MSG_UNREADABLE : MSG_PROVIDER_DOWN;
}

/**
 * Pregunta de TEXTO (sin imágenes) que devuelve JSON, con presupuesto corto: sirve para evaluar equivalencias de materiales sin demorar la
 * lectura del remito. Nunca lanza; ante cualquier falla devuelve ok:false y quien llama sigue sin la ayuda de la IA.
 */
export async function askGeminiJson(prompt: string, deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; budgetMs?: number } = {}): Promise<{ ok: true; json: unknown; ms: number } | { ok: false; message: string }> {
  const baseEnv = deps.env ?? process.env;
  const cfg = extractionConfig(baseEnv);
  if (!cfg.available || !geminiAvailable(baseEnv)) return { ok: false, message: cfg.available ? "Esta ayuda usa Gemini y no está configurado." : cfg.reason };
  const budget = String(deps.budgetMs ?? 22_000);
  const env = { ...baseEnv, INGRESO_REMITO_BUDGET_MS: budget, INGRESO_REMITO_ATTEMPT_MS: String(Math.min(16_000, deps.budgetMs ?? 16_000)) };
  const t0 = Date.now();
  const run = await runGenerate([{ text: prompt }], env, deps.fetchImpl ?? fetch, { maxOutputTokens: 4096 });
  if (!run.ok) return { ok: false, message: run.message };
  const text = run.body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return { ok: true, json: JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")), ms: Date.now() - t0 };
  } catch {
    return { ok: false, message: "La IA no devolvió una respuesta interpretable." };
  }
}

/**
 * Llamada genérica a Gemini con PARTES arbitrarias (texto + archivos en línea) que devuelve JSON. La usa la importación de pedidos desde
 * email. Mismo presupuesto, reintentos y clasificación de errores que la lectura de remitos. Nunca lanza.
 */
export async function generateJsonFromParts(
  parts: Array<Record<string, unknown>>,
  deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; budgetMs?: number; maxOutputTokens?: number } = {}
): Promise<{ ok: true; json: unknown; ms: number; model: string } | { ok: false; message: string; kind: string; diag?: GeminiDiag }> {
  const baseEnv = deps.env ?? process.env;
  const cfg = extractionConfig(baseEnv);
  if (!cfg.available || !geminiAvailable(baseEnv)) return { ok: false, message: cfg.available ? "Esta función usa Gemini y no está configurado." : cfg.reason, kind: cfg.available ? "config" : cfg.code };
  const env = deps.budgetMs ? { ...baseEnv, INGRESO_REMITO_BUDGET_MS: String(deps.budgetMs), INGRESO_REMITO_ATTEMPT_MS: String(Math.min(30_000, deps.budgetMs)) } : baseEnv;
  const t0 = Date.now();
  const run = await runGenerate(parts, env, deps.fetchImpl ?? fetch, { maxOutputTokens: deps.maxOutputTokens ?? 8192 });
  if (!run.ok) return { ok: false, message: run.message, kind: run.kind, diag: run.diag };
  const text = run.body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return { ok: true, json: JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")), ms: Date.now() - t0, model: run.model };
  } catch {
    return { ok: false, message: "La IA no devolvió una respuesta interpretable.", kind: "unreadable" };
  }
}

// ───────────────────────── Prueba de configuración ─────────────────────────

/** Resultado de UNA prueba (texto o imagen) de un proveedor: código HTTP, error técnico saneado y tiempo. */
export type ProbeStep = {
  ok: boolean;
  kind?: string;
  message: string;
  http?: number | null;
  /** Error técnico del proveedor (tipo/código/parámetro/mensaje), saneado y acotado. Solo lo ve quien puede ejecutar el diagnóstico. */
  detail?: string;
  requestId?: string | null;
  ms?: number;
  read?: { supplier: string; remitoNumber: string; remitoDate: string; lines: number };
};
export type ProviderProbe = {
  provider: ProviderId;
  configured: boolean;
  /** Variable de entorno que aporta la clave (solo el NOMBRE; nunca el valor). */
  keySource: string | null;
  /** Endpoint y versión de API (sin secretos ni parámetros). */
  endpoint: string | null;
  apiVersion: string | null;
  /** Modelo pedido a mano (o null si se elige solo) y modelo que efectivamente respondió. */
  requestedModel: string | null;
  model: string | null;
  ok: boolean;
  ms: number;
  /** Prueba de TEXTO (sin imagen). Un OK acá NO prueba la visión. */
  text: ProbeStep;
  /** Prueba de IMAGEN (remito ficticio incorporado). null = no se pidió (`image=1`). */
  image: null | ProbeStep;
  /** Intentos por modelo (Gemini): modelo, HTTP, tipo y motivo saneado. */
  attempts?: Attempt[];
  /** Estado del circuit breaker de este proveedor (compartido entre instancias si hay base). */
  breaker: { open: boolean; until: string | null; consecutiveFailures: number; lastKind: string | null; lastHttp: number | null; lastFailureAt: string | null; lastSuccessAt: string | null };
};

export type ProbeResult = {
  ok: boolean;
  code: ExtractionConfig["code"] | "tested";
  /** Proveedor principal (primero configurado). */
  provider: ProviderId | null;
  /** Orden de uso: el principal lee; el siguiente respalda. */
  order: ProviderId[];
  /** Modelo definido a mano en INGRESO_REMITO_GEMINI_MODEL (o null si se elige solo). */
  configuredModel: string | null;
  modelSource: ExtractionConfig["modelSource"];
  /** Valor de CREAMY_GEMINI_MODEL: solo informativo, la lectura de remitos ya no lo hereda. */
  creamyModel: string | null;
  effectiveModel: string | null;
  listing: { ok: boolean; status: number | null; count: number; candidates: string[]; kind?: string };
  attempts: Attempt[];
  text: { ok: boolean; kind?: string; message: string };
  image: null | { ok: boolean; kind?: string; message: string; read?: { supplier: string; remitoNumber: string; remitoDate: string; lines: number } };
  /** Modelos de Gemini descartados por 404 (figuran en el listado pero no sirven): no se vuelven a pedir por un rato. */
  skippedModels: string[];
  /** Almacenamiento del circuit breaker: `persistent` = la tabla `ai_provider_health` (migración 0086) existe y responde. */
  breakerStore: { persistent: boolean; table: string; error?: string } | null;
  /** Una entrada por proveedor configurado (o faltante de configurar): resultado real, modelo y breaker. */
  providers: ProviderProbe[];
  /** Presupuesto real de una lectura (ms) y reparto entre proveedor principal y respaldo. */
  budget: { totalMs: number; primaryFastMs: number; primaryAttemptMs: number; routeMaxMs: number };
  message: string;
};

/**
 * Prueba de configuración para administradores (sin movimientos de inventario). Sin `image`: pedido mínimo por proveedor. Con `image`: lee un
 * remito ficticio incorporado al sistema con CADA proveedor configurado, por separado, para confirmar disponibilidad real, modelo,
 * tiempos y estado del circuit breaker. Devuelve solo estado y nombres de modelos: jamás claves ni contenido de remitos reales.
 */
export async function probeExtraction(deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; image?: boolean; health?: ProviderHealthStore; /** Comprueba que la tabla del circuit breaker (migración 0086) exista y responda. */ storeCheck?: () => Promise<{ persistent: boolean; table: string; error?: string }> } = {}): Promise<ProbeResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;
  const health = deps.health ?? memoryHealth;
  const cfg = extractionConfig(env);
  const base = {
    provider: cfg.provider,
    order: cfg.providers,
    configuredModel: cfg.model || null,
    modelSource: cfg.modelSource,
    creamyModel: cleanModel(env.CREAMY_GEMINI_MODEL) || null,
    budget: { totalMs: Number(env.INGRESO_REMITO_BUDGET_MS ?? DEFAULT_BUDGET_MS) || DEFAULT_BUDGET_MS, primaryFastMs: Number(env.INGRESO_REMITO_FAST_BUDGET_MS ?? 14_000) || 14_000, primaryAttemptMs: Number(env.INGRESO_REMITO_FAST_ATTEMPT_MS ?? 8_000) || 8_000, routeMaxMs: 60_000 },
  };
  const empty = { ok: false, status: null, count: 0, candidates: [] as string[] };
  const breakerOf = async (p: ProviderId): Promise<ProviderProbe["breaker"]> => {
    const st = await health.state(p);
    const iso = (n: number | null) => (n ? new Date(n).toISOString() : null);
    return { open: st.openUntil > Date.now(), until: iso(st.openUntil || null), consecutiveFailures: st.consecutiveFailures, lastKind: st.lastKind, lastHttp: st.lastHttp, lastFailureAt: iso(st.lastFailureAt), lastSuccessAt: iso(st.lastSuccessAt) };
  };
  const probeImg = { bytes: new Uint8Array(Buffer.from(PROBE_IMAGE_BASE64, "base64")), contentType: PROBE_IMAGE_MIME };

  const stepOf = (run: { ok: boolean; kind?: string; message?: string; http?: number | null; detail?: string; requestId?: string | null }, okMsg: string, ms: number): ProbeStep =>
    run.ok ? { ok: true, message: okMsg, http: run.http ?? 200, ms } : { ok: false, kind: run.kind, message: run.message ?? "", http: run.http ?? null, detail: run.detail ? redactSecrets(run.detail).slice(0, 400) : undefined, requestId: run.requestId ?? null, ms };
  const imageStep = (out: ExtractionOutcome, ms: number): ProbeStep => {
    const failing = out.ok ? undefined : out.diag?.stages.flatMap((st) => st.providers ?? []).find((o) => !o.ok);
    return out.ok
      ? {
          ok: out.data.lines.length > 0,
          message: out.data.lines.length ? `El modelo «${out.model}» analizó la imagen de prueba y encontró ${out.data.lines.length} renglón(es).` : "El modelo respondió pero no encontró renglones en la imagen de prueba.",
          http: 200,
          ms,
          read: { supplier: out.data.supplier, remitoNumber: out.data.remitoNumber, remitoDate: out.data.remitoDate, lines: out.data.lines.length },
        }
      : { ok: false, kind: out.kind, message: redactSecrets(out.technical || out.message).slice(0, 400), http: failing?.http ?? out.diag?.http ?? null, detail: failing?.detail, ms };
  };
  const readImage = async (provider: ProviderId): Promise<ProbeStep> => {
    const t = Date.now();
    const out = await extractRemito([probeImg], { fetchImpl: doFetch, env: { ...env, INGRESO_REMITO_PROVIDERS: provider, INGRESO_REMITO_BUDGET_MS: "20000" }, health: createNoopHealth() });
    return imageStep(out, Date.now() - t);
  };
  const providers: ProviderProbe[] = [];

  // ── Gemini ──
  let geminiTop: { effectiveModel: string | null; listing: ProbeResult["listing"]; attempts: Attempt[]; text: ProbeResult["text"]; image: ProbeResult["image"] } = { effectiveModel: null, listing: empty, attempts: [], text: { ok: false, message: "Gemini no está configurado." }, image: null };
  const gBase = baseUrl(env);
  if (geminiAvailable(env)) {
    const t = Date.now();
    const listed = await listModels(env, doFetch);
    const listing = listed.ok ? { ok: true, status: 200, count: listed.models.length, candidates: listed.models.slice(0, 8) } : { ok: false, status: listed.status, count: 0, candidates: [], kind: listed.kind };
    const tt = Date.now();
    const run = await runGenerate([{ text: 'Respondé únicamente la palabra "OK".' }], env, doFetch, { maxOutputTokens: 16, json: false, fast: Boolean(providerOrder(env).length > 1) });
    const last = run.attempts.at(-1);
    const text = stepOf(run.ok ? { ok: true } : { ok: false, kind: run.kind, message: run.message, http: last?.status ?? null, detail: last?.detail }, run.ok ? `El modelo «${run.model}» respondió correctamente (prueba de texto).` : "", Date.now() - tt);
    const image = deps.image ? await readImage("gemini") : null;
    geminiTop = { effectiveModel: run.ok ? run.model : null, listing, attempts: run.attempts, text, image };
    providers.push({
      provider: "gemini", configured: true, keySource: "GEMINI_API_KEY", endpoint: `POST ${gBase}/v1beta/models/{modelo}:generateContent`, apiVersion: "v1beta",
      requestedModel: cfg.model || null, model: run.ok ? run.model : null,
      ok: text.ok && (!deps.image || Boolean(image?.ok)), ms: Date.now() - t, text, image, attempts: run.attempts, breaker: await breakerOf("gemini"),
    });
  } else providers.push({ provider: "gemini", configured: false, keySource: null, endpoint: null, apiVersion: null, requestedModel: null, model: null, ok: false, ms: 0, text: { ok: false, message: "Gemini no está configurado (falta GEMINI_API_KEY)." }, image: null, breaker: await breakerOf("gemini") });

  // ── OpenAI (respaldo) ──
  if (openaiAvailable(env)) {
    const t = Date.now();
    const oenv = { ...env, INGRESO_REMITO_BUDGET_MS: "20000" } as Partial<NodeJS.ProcessEnv>;
    const tt = Date.now();
    const r = await runOpenAI([{ text: 'Respondé únicamente la palabra "OK".' }], oenv, doFetch, { maxOutputTokens: 16, json: false, textOnly: true });
    const text = stepOf(r.ok ? { ok: true } : { ok: false, kind: r.kind, message: r.message, http: r.http, detail: r.error ? [r.error.type, r.error.code, r.error.param ? `param ${r.error.param}` : "", r.error.message].filter(Boolean).join(" · ") : undefined, requestId: r.error?.requestId }, r.ok ? `El modelo «${r.model}» respondió correctamente (prueba de texto).` : "", Date.now() - tt);
    const image = deps.image ? await readImage("openai") : null;
    providers.push({
      provider: "openai", configured: true, keySource: openaiKeySource(env), endpoint: "POST https://api.openai.com/v1/responses", apiVersion: "v1 (Responses API)",
      requestedModel: openaiModel(env), model: r.ok ? r.model : null, ok: text.ok && (!deps.image || Boolean(image?.ok)), ms: Date.now() - t, text, image, breaker: await breakerOf("openai"),
    });
  } else providers.push({ provider: "openai", configured: false, keySource: null, endpoint: null, apiVersion: null, requestedModel: null, model: null, ok: false, ms: 0, text: { ok: false, message: "OpenAI no está configurado: definí CREAMY_OPENAI_API_KEY u OPENAI_API_KEY (o INGRESO_REMITO_OPENAI_API_KEY) en el servidor." }, image: null, breaker: await breakerOf("openai") });

  const breakerStore = deps.storeCheck ? await deps.storeCheck().catch((e: unknown) => ({ persistent: false, table: "ai_provider_health", error: e instanceof Error ? redactSecrets(e.message).slice(0, 160) : "error" })) : null;
  if (!cfg.available) {
    return { ...base, ok: false, code: cfg.code, effectiveModel: null, listing: empty, attempts: [], text: { ok: false, message: cfg.reason }, image: null, providers, skippedModels: deadModelList(), breakerStore, message: cfg.reason };
  }
  const anyOk = providers.some((p) => p.configured && p.ok);
  const firstOk = providers.find((p) => p.configured && p.ok);
  const failMsg = providers.filter((p) => p.configured).map((p) => `${p.provider}: ${(p.image && !p.image.ok ? p.image.message : p.text.message)}`).join(" · ");
  return {
    ...base,
    ok: anyOk,
    code: "tested",
    effectiveModel: geminiTop.effectiveModel ?? firstOk?.model ?? null,
    listing: geminiTop.listing,
    attempts: geminiTop.attempts,
    text: geminiTop.text, // el diagnóstico de Gemini no se disfraza: el estado del respaldo va en `providers`
    image: geminiTop.image,
    providers,
    skippedModels: deadModelList(),
    breakerStore,
    message: anyOk ? (providers.every((p) => !p.configured || p.ok) ? (deps.image ? "Los proveedores configurados analizaron correctamente una imagen de prueba." : "Los proveedores configurados respondieron a la prueba de TEXTO; la visión no se probó (agregá image=1).") : `Funciona con ${firstOk?.provider}; algún proveedor falló: ${failMsg}`) : failMsg,
  };
}

/** Salud «nula» para pruebas de configuración: no toca el circuit breaker real. */
function createNoopHealth(): ProviderHealthStore {
  return { async state() { return { consecutiveFailures: 0, openUntil: 0, lastKind: null, lastHttp: null, lastFailureAt: null, lastSuccessAt: null }; }, async recordSuccess() {}, async recordFailure() {} };
}
