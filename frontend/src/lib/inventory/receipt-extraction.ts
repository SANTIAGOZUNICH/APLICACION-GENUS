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
const STATIC_FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-3.5-flash"];

export const MSG_UNREADABLE = "No pudimos interpretar automáticamente este remito. Podés reintentar o completar los datos manualmente.";

const cleanModel = (v: string | undefined) => (v ?? "").trim().replace(/^models\//, "");

export function extractionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ExtractionConfig {
  const mode = (env.INGRESO_REMITO_EXTRACTION ?? "").trim().toLowerCase();
  const model = cleanModel(env.INGRESO_REMITO_GEMINI_MODEL);
  const modelSource = model ? "INGRESO_REMITO_GEMINI_MODEL" : "automático";
  // Se activa sola cuando existe GEMINI_API_KEY (antes exigía además INGRESO_REMITO_EXTRACTION=gemini y, sin esa variable,
  // la lectura quedaba «apagada» aunque la clave estuviera cargada). Solo se apaga con una orden explícita.
  if (["off", "false", "0", "no", "disabled", "desactivada"].includes(mode)) {
    return { available: false, provider: null, model, modelSource, code: "disabled", reason: "La lectura automática de fotos está desactivada por Sistemas. Cargá los datos a mano: la foto queda adjunta igual." };
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

export type FailureKind = "model" | "key" | "permission" | "region" | "limit" | "overloaded" | "unavailable" | "bad_request";
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
  if (status === 503 || st === "UNAVAILABLE" || /overloaded|high demand|try again later/i.test(msg)) return { kind: "overloaded", detail };
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
export type Attempt = { model: string; status: number | null; kind: "ok" | FailureKind };

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
    // Listar modelos tiene su propio tope corto: un listado colgado no puede comerse la lectura.
    const quick = ((url: string, init?: RequestInit) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 8_000);
      return doFetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
    }) as typeof fetch;
    const listed = await listModels(env, quick);
    if (listed.ok) {
      modelCache = { models: listed.models, working: modelCache?.working ?? null, at: modelCache?.at ?? Date.now() };
      for (const m of listed.models.slice(0, 4)) push(m);
    } else {
      logFailure("no se pudo listar modelos", listed.status, null, listed.kind);
      for (const m of STATIC_FALLBACK_MODELS) push(m);
    }
  };
  if (!queue.length) await discover();

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
  // Reintentos CONTROLADOS: solo para fallos transitorios (red, 5xx, «saturado», límite por minuto), con espera creciente y un tope
  // fijo; si un modelo no se recupera se prueba otro candidato. Nunca hay reintentos infinitos (y todo cabe en el presupuesto de la lectura).
  const base = Math.max(0, Number(env.INGRESO_REMITO_RETRY_BASE_MS ?? 700) || 0);
  const BACKOFF_MS = [base, Math.round(base * 2.6)];
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let lastTransient: { kind: FailureKind; model: string } | null = null;
  let transientModels = 0; // tope: con dos modelos saturados se informa, no se sigue probando
  try {
    while (queue.length) {
      const model = queue.shift()!;
      tried.add(model);
      let withThinking = true;
      let transientTries = 0;
      let moveOn = false;
      for (let n = 0; n < 6 && !moveOn; n++) {
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
          if (transientTries < BACKOFF_MS.length) {
            await sleep(BACKOFF_MS[transientTries++]!);
            continue;
          }
          lastTransient = { kind: "unavailable", model };
          moveOn = true;
          continue;
        }
        const body = (await res.json().catch(() => null)) as GeminiBody | null;
        if (res.ok && body === null) {
          // 200 con cuerpo ilegible (cortado): se trata como falla transitoria.
          attempts.push({ model, status: res.status, kind: "unavailable" });
          if (transientTries < BACKOFF_MS.length && remaining() > minAttemptMs) {
            await sleep(BACKOFF_MS[transientTries++]!);
            continue;
          }
          lastTransient = { kind: "unavailable", model };
          moveOn = true;
          continue;
        }
        if (res.ok) {
          attempts.push({ model, status: res.status, kind: "ok" });
          modelCache = { models: modelCache?.models ?? [], working: model, at: Date.now() };
          return { ok: true, body: body ?? {}, model, attempts };
        }
        const cls = classifyHttp(res.status, body?.error);
        if (cls.kind === "bad_request" && withThinking && /thinking/i.test(cls.detail)) {
          withThinking = false; // este modelo no acepta «thinkingConfig»: se reintenta igual sin él
          continue;
        }
        attempts.push({ model, status: res.status, kind: cls.kind });
        logFailure(cls.kind, res.status, model, cls.detail);
        if (cls.kind === "model") {
          if (modelCache?.working === model) modelCache = { ...modelCache, working: null };
          if (!queue.length && !discovered) await discover();
          moveOn = true;
          continue;
        }
        if (cls.kind === "overloaded" || cls.kind === "unavailable" || cls.kind === "limit") {
          const maxTries = cls.kind === "limit" ? 1 : BACKOFF_MS.length;
          if (transientTries < maxTries) {
            await sleep(BACKOFF_MS[transientTries++]!);
            continue;
          }
          lastTransient = { kind: cls.kind, model };
          transientModels += 1;
          if (transientModels >= 2) return { ok: false, kind: cls.kind, message: messageFor(cls.kind, model, [...tried]), attempts, model };
          if (cls.kind === "limit") return { ok: false, kind: cls.kind, message: messageFor(cls.kind, model, [...tried]), attempts, model };
          if (!queue.length && !discovered) await discover();
          moveOn = true; // otro modelo puede estar menos saturado
          continue;
        }
        return { ok: false, kind: cls.kind, message: messageFor(cls.kind, model, [...tried]), attempts, model };
      }
    }
    if (lastTransient) return { ok: false, kind: lastTransient.kind, message: messageFor(lastTransient.kind, lastTransient.model, [...tried]), attempts, model: lastTransient.model };
    return { ok: false, kind: "model", message: messageFor("model", null, [...tried]), attempts, model: null };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logFailure(aborted ? "timeout" : "red", null, null, err instanceof Error ? err.message : "");
    return aborted
      ? { ok: false, kind: "timeout", message: "La lectura tardó demasiado. Podés reintentar o completar los datos manualmente.", attempts, model: null }
      : { ok: false, kind: "unavailable", message: "No se pudo contactar al servicio de lectura. Podés reintentar o completar los datos manualmente.", attempts, model: null };
  }
}

const PROMPT_BASE = `Sos un asistente de lectura de documentos de ingreso de un laboratorio argentino. La foto puede ser un REMITO o factura de proveedor (varios renglones) o la ETIQUETA / rótulo de UN envase o bolsa (un solo producto: en ese caso devolvé una única línea). Las imágenes/páginas adjuntas son del MISMO documento. Devolvé SOLO un JSON con esta forma:
{"supplier": string, "remitoNumber": string, "remitoDate": "YYYY-MM-DD" | "", "notes": string,
 "unclearFields": string[],
 "lines": [{"supplierCode": string, "description": string, "quantity": number|null, "unit": string, "packages": number|null, "lot": string, "expiryDate": "YYYY-MM-DD"|"", "notes": string, "confidence": number, "unclearFields": string[], "inferredFields": string[]}]}
Reglas estrictas:
- "supplier" es quien EMITE el documento o fabrica el producto (el proveedor), no el destinatario (Laboratorio Genus).
- UNA línea por producto o renglón de la tabla. No omitas renglones. NUNCA inventes ni completes datos que no se lean con claridad: dejá "" o null y agregá el nombre del campo en "unclearFields". Una foto borrosa o cortada es mejor devolverla con campos vacíos que adivinada.
- "supplierCode" es el código del producto que imprime el PROVEEDOR / la etiqueta. Buscalo con atención: puede estar en una columna «Código», «Cód.», «Artículo», «Art.», «Referencia», «Ref.», «SKU» o «Item», o escrito junto a la descripción (p. ej. «FR-4521 Fragancia rosa»: código «FR-4521», descripción «Fragancia rosa»). Los códigos de fragancias suelen mezclar letras, números y guiones. NO lo confundas con el número de remito, el número de pedido/orden, el lote, una fecha, un precio ni una cantidad. Si no hay código legible, dejalo "" y agregá "supplierCode" a "unclearFields". Copialo tal cual, sin inventar ni «arreglar» caracteres.
- Extraé TODO lo visible que corresponda a una columna de la tabla: proveedor, cliente (si figura), n.º de remito, fecha, código, nombre y descripción, lote, vencimiento, cantidad, bultos y cantidad por bulto, ubicación y observaciones. Lo que no figure, vacío.
- Si el documento indica «N bultos de X» (o X por bulto) y NO imprime un total, "quantity" = N × X, "packages" = N y agregá "quantity" a "inferredFields"; si imprime el total, usá ese total. No uses otra cuenta.
- "quantity" es la cantidad como número (sin unidades; usá punto decimal); "unit" la unidad escrita (kg, g, un, l, cajas...). "packages" son los bultos/cajas/tambores si figuran.
- "lot" (lote) y "expiryDate" (vencimiento, formato ISO) solo si están impresos o escritos. Una fecha «MM/AAAA» o «AAAA-MM» sin día: dejala en "expiryDate" como último día de ese mes SOLO si se lee con claridad y agregá "expiryDate" a "inferredFields".
- "inferredFields": campos que NO están escritos literalmente y que normalizaste o dedujiste (p. ej. unidad deducida, fecha completada, descripción ordenada). Lo copiado tal cual de la imagen NO va ahí.
- "notes": observaciones relevantes (condiciones, faltantes, daños, referencias de orden de compra{EXTRA_NOTES}). "confidence" entre 0 y 1.
- La foto puede estar inclinada, con sombras, algo borrosa, con tablas desalineadas, abreviaturas o notas escritas a mano junto al texto impreso: leé todo lo razonablemente reconocible. Si UNA línea no se entiende, devolvé igual el resto y marcá solo los campos dudosos de esa línea en "unclearFields" (dejando vacío lo ilegible). No descartes el documento por una línea difícil.
- Para ahorrar tiempo, en cada renglón OMITÍ las claves vacías o sin novedad ("notes", "unclearFields", "inferredFields", "packages", "lot", "expiryDate" cuando no hay nada).
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
export type ExtractionOutcome =
  | { ok: true; data: ExtractedRemito; provider: string; model: string; /** La respuesta venía cortada: se rescataron solo los renglones completos. */ partial?: boolean; elapsedMs?: number }
  | { ok: false; message: string; kind: "disabled" | "config" | FailureKind | "unreadable" | "timeout" };

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

/** Llama al servicio y devuelve la sugerencia saneada. Nunca lanza: ante cualquier falla devuelve ok:false con un mensaje claro. */
export async function extractRemito(files: ExtractionFile[], deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; module?: "MP" | "ME" } = {}): Promise<ExtractionOutcome> {
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
  const startedAt = Date.now();
  const parts: Array<Record<string, unknown>> = [{ text: promptFor(deps.module) }];
  for (const f of used) parts.push({ inline_data: { mime_type: f.contentType, data: Buffer.from(f.bytes).toString("base64") } });
  let run = await runGenerate(parts, env, deps.fetchImpl ?? fetch);
  // Respuesta cortada por tokens (modelo que «piensa» de más): un único reintento con más margen.
  if (run.ok && !run.body.candidates?.[0]?.content?.parts?.some((p) => (p.text ?? "").trim()) && run.body.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    logFailure("respuesta cortada (MAX_TOKENS)", null, run.model, "reintento con más margen");
    run = await runGenerate(parts, env, deps.fetchImpl ?? fetch, { maxOutputTokens: 24576 });
  }
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
  let partial = false;
  try {
    parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    // Respuesta cortada: se aprovecha lo que quedó completo en vez de rechazar todo el remito.
    parsed = salvagePartialJson(text);
    partial = parsed != null;
    if (!partial) {
      logFailure("JSON inválido", null, run.model, cand?.finishReason ?? "");
      return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
    }
    logFailure("JSON cortado: lectura parcial", null, run.model, cand?.finishReason ?? "");
  }
  const data = sanitizeExtraction(parsed);
  if (!data) {
    logFailure("sin datos de remito", null, run.model, "");
    return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
  }
  return { ok: true, data, provider: `gemini:${run.model}`, model: run.model, elapsedMs: Date.now() - startedAt, ...(partial ? { partial: true } : {}) };
}

/**
 * Pregunta de TEXTO (sin imágenes) que devuelve JSON, con presupuesto corto: sirve para evaluar equivalencias de materiales sin demorar la
 * lectura del remito. Nunca lanza; ante cualquier falla devuelve ok:false y quien llama sigue sin la ayuda de la IA.
 */
export async function askGeminiJson(prompt: string, deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv>; budgetMs?: number } = {}): Promise<{ ok: true; json: unknown; ms: number } | { ok: false; message: string }> {
  const baseEnv = deps.env ?? process.env;
  const cfg = extractionConfig(baseEnv);
  if (!cfg.available) return { ok: false, message: cfg.reason };
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
): Promise<{ ok: true; json: unknown; ms: number; model: string } | { ok: false; message: string; kind: string }> {
  const baseEnv = deps.env ?? process.env;
  const cfg = extractionConfig(baseEnv);
  if (!cfg.available) return { ok: false, message: cfg.reason, kind: cfg.code };
  const env = deps.budgetMs ? { ...baseEnv, INGRESO_REMITO_BUDGET_MS: String(deps.budgetMs), INGRESO_REMITO_ATTEMPT_MS: String(Math.min(30_000, deps.budgetMs)) } : baseEnv;
  const t0 = Date.now();
  const run = await runGenerate(parts, env, deps.fetchImpl ?? fetch, { maxOutputTokens: deps.maxOutputTokens ?? 8192 });
  if (!run.ok) return { ok: false, message: run.message, kind: run.kind };
  const text = run.body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return { ok: true, json: JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")), ms: Date.now() - t0, model: run.model };
  } catch {
    return { ok: false, message: "La IA no devolvió una respuesta interpretable.", kind: "unreadable" };
  }
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
