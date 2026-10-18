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

import { sanitizeExtraction, type ExtractedRemito } from "@/lib/inventory/receipt-rules";
import { PROBE_IMAGE_BASE64, PROBE_IMAGE_MIME } from "@/lib/inventory/receipt-probe-image";

export type ExtractionConfig = {
  available: boolean;
  provider: "gemini" | null;
  /** Modelo explícito (INGRESO_REMITO_GEMINI_MODEL) o "" si se elige automáticamente. */
  model: string;
  modelSource: "INGRESO_REMITO_GEMINI_MODEL" | "automático";
  /** ok | disabled (falta INGRESO_REMITO_EXTRACTION=gemini) | missing_key (falta GEMINI_API_KEY). */
  code: "ok" | "disabled" | "missing_key";
  reason: string;
};

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
const TIMEOUT_MS = 50_000;
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;
/** Gemini acepta hasta ~20 MB de datos en línea por pedido: se envían como máximo estas hojas / bytes. */
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 14 * 1024 * 1024;
/** Si ni siquiera se puede listar modelos: alias mantenido por Google y últimos nombres conocidos. */
const STATIC_FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash"];

export const MSG_UNREADABLE = "No pudimos interpretar automáticamente este remito. Podés reintentar o completar los datos manualmente.";

const cleanModel = (v: string | undefined) => (v ?? "").trim().replace(/^models\//, "");

export function extractionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ExtractionConfig {
  const mode = (env.INGRESO_REMITO_EXTRACTION ?? "").trim().toLowerCase();
  const model = cleanModel(env.INGRESO_REMITO_GEMINI_MODEL);
  const modelSource = model ? "INGRESO_REMITO_GEMINI_MODEL" : "automático";
  if (mode !== "gemini") {
    return { available: false, provider: null, model, modelSource, code: "disabled", reason: "La lectura automática de remitos todavía no está activada en GENUS OS. Cargá los datos a mano: la foto queda adjunta igual." };
  }
  if (!env.GEMINI_API_KEY?.trim()) {
    return { available: false, provider: null, model, modelSource, code: "missing_key", reason: "La lectura automática está habilitada pero falta la clave del servicio (GEMINI_API_KEY). Cargá los datos a mano y avisá a Sistemas." };
  }
  return { available: true, provider: "gemini", model, modelSource, code: "ok", reason: "" };
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
export function resetModelCacheForTests() {
  modelCache = null;
}

/** Cuánto «sirve» un modelo para leer remitos: estable > alias > preview; flash antes que lite y que pro; versión más nueva primero. */
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
  return [...new Set(names)].sort((a, b) => group(a) - group(b) || version(b) - version(a) || a.length - b.length || a.localeCompare(b));
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

export type FailureKind = "model" | "key" | "permission" | "region" | "limit" | "unavailable" | "bad_request";
type GeminiError = { code?: number; status?: string; message?: string };

/** Distingue modelo inexistente / clave inválida / permisos / región / límite de uso a partir del estado HTTP y del cuerpo del error. */
export function classifyHttp(status: number, err: GeminiError | null | undefined): { kind: FailureKind; detail: string } {
  const msg = err?.message ?? "";
  const st = (err?.status ?? "").toUpperCase();
  const detail = redactSecrets(msg).slice(0, 220);
  if (/api key not valid|api_key_invalid|api key expired|key.*(invalid|expired)/i.test(msg) || st === "UNAUTHENTICATED" || status === 401) return { kind: "key", detail };
  if (/location is not supported|not available in your (country|region)/i.test(msg)) return { kind: "region", detail };
  if (status === 404 || st === "NOT_FOUND" || /models\/[\w.-]+ is not found|no longer available|is not supported for generatecontent/i.test(msg)) return { kind: "model", detail };
  if (status === 403 || st === "PERMISSION_DENIED" || /has not been used in project|service_disabled|billing|permission/i.test(msg)) return { kind: "permission", detail };
  if (status === 429 || st === "RESOURCE_EXHAUSTED" || /quota|rate limit/i.test(msg)) return { kind: "limit", detail };
  if (status === 400) return { kind: "bad_request", detail };
  return { kind: "unavailable", detail };
}

function messageFor(kind: FailureKind, model: string | null, tried: string[]): string {
  switch (kind) {
    case "model":
      return tried.length > 1
        ? `Ningún modelo de Gemini disponible para esta clave pudo leer el remito (probados: ${tried.join(", ")}). Avisá a Sistemas; mientras tanto cargá los datos a mano.`
        : `El modelo de lectura «${model ?? tried[0] ?? "?"}» no existe o ya no está disponible para esta clave. Avisá a Sistemas; mientras tanto cargá los datos a mano.`;
    case "key":
      return "La clave de Gemini configurada no es válida o venció. Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "permission":
      return "La clave de Gemini no tiene permiso para usar este servicio (API no habilitada, facturación o restricciones del proyecto). Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "region":
      return "Gemini no está disponible desde la ubicación del servidor. Avisá a Sistemas; mientras tanto cargá los datos a mano.";
    case "limit":
      return "Se alcanzó el límite de uso de Gemini (cuota). Reintentá en unos minutos o cargá los datos a mano.";
    case "bad_request":
      return "Gemini rechazó el pedido. Podés reintentar o completar los datos manualmente; si se repite, avisá a Sistemas.";
    default:
      return "El servicio de lectura no está disponible ahora. Podés reintentar o completar los datos manualmente.";
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
export type Attempt = { model: string; status: number | null; kind: "ok" | FailureKind };

function generationConfig(model: string, withThinking = true, maxOutputTokens = 8192) {
  const cfg: Record<string, unknown> = { temperature: 0, responseMimeType: "application/json", maxOutputTokens };
  // Gemini 2.5 Flash «piensa» por defecto (lento y con costo): para leer un remito no hace falta. Otros modelos pueden no aceptarlo.
  if (withThinking && /gemini-2\.5-flash/.test(model) && !/lite/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}

type RunResult =
  | { ok: true; body: GeminiBody; model: string; attempts: Attempt[] }
  | { ok: false; kind: FailureKind | "timeout"; message: string; attempts: Attempt[]; model: string | null };

/**
 * Llama a generateContent probando modelos en orden: el explícito, el último que funcionó y, si hace falta, los que Google dice que existen.
 * Solo un 404 «modelo» pasa al siguiente candidato; el resto de los fallos (clave, permisos, límite…) se informan tal cual.
 */
async function runGenerate(
  parts: Array<Record<string, unknown>>,
  env: Partial<NodeJS.ProcessEnv>,
  doFetch: typeof fetch,
  opts: { maxOutputTokens?: number; json?: boolean } = {}
): Promise<RunResult> {
  const cfg = extractionConfig(env);
  const attempts: Attempt[] = [];
  const tried = new Set<string>();
  const queue: string[] = [];
  const push = (m: string | null | undefined) => {
    const name = cleanModel(m ?? "");
    if (name && !tried.has(name) && !queue.includes(name)) queue.push(name);
  };
  push(cfg.model);
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) push(modelCache.working);
  let discovered = false;
  const discover = async () => {
    discovered = true;
    const listed = await listModels(env, doFetch);
    if (listed.ok) {
      modelCache = { models: listed.models, working: modelCache?.working ?? null, at: modelCache?.at ?? Date.now() };
      for (const m of listed.models.slice(0, 4)) push(m);
    } else {
      logFailure("no se pudo listar modelos", listed.status, null, listed.kind);
      for (const m of STATIC_FALLBACK_MODELS) push(m);
    }
  };
  if (!queue.length) await discover();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    while (queue.length) {
      const model = queue.shift()!;
      tried.add(model);
      let withThinking = true;
      for (let retry = 0; retry < 2; retry++) {
        const gc = generationConfig(model, withThinking, opts.maxOutputTokens);
        if (opts.json === false) delete gc.responseMimeType;
        const res = await doFetch(`${baseUrl(env)}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gc }),
          signal: ctl.signal,
        });
        const body = (await res.json().catch(() => null)) as GeminiBody | null;
        if (res.ok) {
          attempts.push({ model, status: res.status, kind: "ok" });
          modelCache = { models: modelCache?.models ?? [], working: model, at: Date.now() };
          return { ok: true, body: body ?? {}, model, attempts };
        }
        const cls = classifyHttp(res.status, body?.error);
        if (cls.kind === "bad_request" && withThinking && /thinking/i.test(cls.detail) && retry === 0) {
          withThinking = false; // este modelo no acepta «thinkingConfig»: se reintenta igual sin él
          continue;
        }
        attempts.push({ model, status: res.status, kind: cls.kind });
        logFailure(cls.kind, res.status, model, cls.detail);
        if (cls.kind === "model") {
          if (modelCache?.working === model) modelCache = { ...modelCache, working: null };
          if (!queue.length && !discovered) await discover();
          break; // siguiente candidato
        }
        return { ok: false, kind: cls.kind, message: messageFor(cls.kind, model, [...tried]), attempts, model };
      }
    }
    return { ok: false, kind: "model", message: messageFor("model", null, [...tried]), attempts, model: null };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logFailure(aborted ? "timeout" : "red", null, null, err instanceof Error ? err.message : "");
    return aborted
      ? { ok: false, kind: "timeout", message: "La lectura tardó demasiado. Podés reintentar o completar los datos manualmente.", attempts, model: null }
      : { ok: false, kind: "unavailable", message: "No se pudo contactar al servicio de lectura. Podés reintentar o completar los datos manualmente.", attempts, model: null };
  } finally {
    clearTimeout(timer);
  }
}

const PROMPT = `Sos un asistente de lectura de remitos de proveedores argentinos (materias primas y materiales de envase de un laboratorio). Las imágenes/páginas adjuntas son del MISMO remito. Devolvé SOLO un JSON con esta forma:
{"supplier": string, "remitoNumber": string, "remitoDate": "YYYY-MM-DD" | "", "notes": string,
 "unclearFields": string[],
 "lines": [{"supplierCode": string, "description": string, "quantity": number|null, "unit": string, "packages": number|null, "lot": string, "expiryDate": "YYYY-MM-DD"|"", "notes": string, "confidence": number, "unclearFields": string[]}]}
Reglas estrictas:
- "supplier" es quien EMITE el remito (el proveedor), no el destinatario (Laboratorio Genus).
- UNA línea por producto o renglón de la tabla. No omitas renglones. No inventes ni completes datos que no se lean con claridad: dejá "" o null y agregá el nombre del campo en "unclearFields".
- "supplierCode" es el código que imprime el PROVEEDOR para ese renglón; no lo conviertas en otro código.
- "quantity" es la cantidad de ese renglón como número (sin unidades); "unit" la unidad escrita (kg, g, un, l, cajas...). "packages" son los bultos/cajas/tambores si figuran.
- "lot" (lote) y "expiryDate" (vencimiento, formato ISO) solo si están impresos o escritos.
- "notes": observaciones relevantes del remito (condiciones, faltantes, daños, referencias de orden de compra). "confidence" entre 0 y 1.
- Si la imagen no es un remito legible, devolvé {"supplier":"","remitoNumber":"","remitoDate":"","notes":"","unclearFields":[],"lines":[]}.`;

export type ExtractionFile = { bytes: Uint8Array; contentType: string };
export type ExtractionOutcome =
  | { ok: true; data: ExtractedRemito; provider: string; model: string }
  | { ok: false; message: string; kind: "disabled" | "config" | FailureKind | "unreadable" | "timeout" };

/** Llama al servicio y devuelve la sugerencia saneada. Nunca lanza: ante cualquier falla devuelve ok:false con un mensaje claro. */
export async function extractRemito(files: ExtractionFile[], deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv> } = {}): Promise<ExtractionOutcome> {
  const env = deps.env ?? process.env;
  const cfg = extractionConfig(env);
  if (!cfg.available) return { ok: false, kind: cfg.code === "missing_key" ? "config" : "disabled", message: cfg.reason };
  if (files.length === 0) return { ok: false, kind: "unreadable", message: "No hay archivos para leer." };
  const used: ExtractionFile[] = [];
  let total = 0;
  for (const f of files.slice(0, MAX_FILES)) {
    if (total + f.bytes.length > MAX_TOTAL_BYTES) break;
    used.push(f);
    total += f.bytes.length;
  }
  const parts: Array<Record<string, unknown>> = [{ text: PROMPT }];
  for (const f of used) parts.push({ inline_data: { mime_type: f.contentType, data: Buffer.from(f.bytes).toString("base64") } });
  const run = await runGenerate(parts, env, deps.fetchImpl ?? fetch);
  if (!run.ok) return { ok: false, kind: run.kind, message: run.message };
  const body = run.body;
  if (body.promptFeedback?.blockReason) {
    logFailure("bloqueado", null, run.model, body.promptFeedback.blockReason);
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
  }
  const cand = body.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    logFailure("respuesta vacía", null, run.model, cand?.finishReason ?? "");
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    logFailure("JSON inválido", null, run.model, cand?.finishReason ?? "");
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
  }
  const data = sanitizeExtraction(parsed);
  if (!data) {
    logFailure("sin datos de remito", null, run.model, "");
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
  }
  return { ok: true, data, provider: `gemini:${run.model}`, model: run.model };
}

// ───────────────────────── Prueba de configuración ─────────────────────────

export type ProbeResult = {
  ok: boolean;
  code: ExtractionConfig["code"] | "tested";
  provider: "gemini" | null;
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
  message: string;
};

/**
 * Prueba de configuración para administradores. Sin `image`: texto fijo (ningún documento). Con `image`: lee un remito ficticio
 * incorporado al sistema para confirmar que el modelo elegido puede analizar una IMAGEN. Devuelve solo estado y nombres de modelos:
 * jamás la clave ni contenido de remitos reales.
 */
export async function probeExtraction(deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; image?: boolean } = {}): Promise<ProbeResult> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetchImpl ?? fetch;
  const cfg = extractionConfig(env);
  const base = {
    provider: cfg.provider,
    configuredModel: cfg.model || null,
    modelSource: cfg.modelSource,
    creamyModel: cleanModel(env.CREAMY_GEMINI_MODEL) || null,
  };
  const empty = { ok: false, status: null, count: 0, candidates: [] as string[] };
  if (!cfg.available) {
    return { ...base, ok: false, code: cfg.code, effectiveModel: null, listing: empty, attempts: [], text: { ok: false, message: cfg.reason }, image: null, message: cfg.reason };
  }
  const listed = await listModels(env, doFetch);
  const listing = listed.ok ? { ok: true, status: 200, count: listed.models.length, candidates: listed.models.slice(0, 6) } : { ok: false, status: listed.status, count: 0, candidates: [], kind: listed.kind };
  const run = await runGenerate([{ text: 'Respondé únicamente la palabra "OK".' }], env, doFetch, { maxOutputTokens: 16, json: false });
  const text = run.ok ? { ok: true, message: `El modelo «${run.model}» respondió correctamente.` } : { ok: false, kind: run.kind, message: run.message };
  let image: ProbeResult["image"] = null;
  if (deps.image && run.ok) {
    const out = await extractRemito([{ bytes: new Uint8Array(Buffer.from(PROBE_IMAGE_BASE64, "base64")), contentType: PROBE_IMAGE_MIME }], { fetchImpl: doFetch, env });
    image = out.ok
      ? { ok: out.data.lines.length > 0, message: out.data.lines.length ? `El modelo «${out.model}» analizó la imagen de prueba y encontró ${out.data.lines.length} renglón(es).` : "El modelo respondió pero no encontró renglones en la imagen de prueba.", read: { supplier: out.data.supplier, remitoNumber: out.data.remitoNumber, remitoDate: out.data.remitoDate, lines: out.data.lines.length } }
      : { ok: false, kind: out.kind, message: out.message };
  }
  const ok = text.ok && (!deps.image || Boolean(image?.ok));
  return {
    ...base,
    ok,
    code: "tested",
    effectiveModel: run.ok ? run.model : null,
    listing,
    attempts: run.attempts,
    text,
    image,
    message: ok ? (deps.image ? "Gemini analizó correctamente una imagen de prueba." : "Gemini respondió correctamente con la clave configurada.") : image && !image.ok ? image.message : text.message,
  };
}
