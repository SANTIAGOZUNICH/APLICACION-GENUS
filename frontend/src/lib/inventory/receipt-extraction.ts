/**
 * Lectura automática de remitos (visión) con Gemini — SOLO sugerencia: nunca confirma ni mueve stock.
 *
 * Reutiliza la clave de Gemini que GENUS OS ya tiene (`GEMINI_API_KEY`, la misma de Creamy; no se toca ni se registra), pero NO se
 * activa solo por existir esa clave: enviar remitos reales a un servicio externo exige autorización explícita de quien administra
 * el sistema → `INGRESO_REMITO_EXTRACTION=gemini`. Sin eso la pantalla funciona igual con carga manual + foto adjunta y MUESTRA por qué
 * no lee (no queda «vacío sin explicar»).
 *
 * La respuesta se trata como dato NO confiable: `sanitizeExtraction` descarta lo inválido y marca «Revisar» lo ausente o ambiguo.
 * Las fallas nunca se tragan en silencio: se devuelve un mensaje claro y se deja un registro (sin claves ni contenido del remito).
 */
import "server-only";

import { sanitizeExtraction, type ExtractedRemito } from "@/lib/inventory/receipt-rules";

export type ExtractionConfig = {
  available: boolean;
  provider: "gemini" | null;
  model: string;
  /** ok | disabled (falta INGRESO_REMITO_EXTRACTION=gemini) | missing_key (falta GEMINI_API_KEY). */
  code: "ok" | "disabled" | "missing_key";
  reason: string;
};

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_BASE = "https://generativelanguage.googleapis.com";
const TIMEOUT_MS = 50_000;
/** Gemini acepta hasta ~20 MB de datos en línea por pedido: se envían como máximo estas hojas / bytes. */
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 14 * 1024 * 1024;

export const MSG_UNREADABLE = "No pudimos interpretar automáticamente este remito. Podés reintentar o completar los datos manualmente.";

export function extractionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ExtractionConfig {
  const mode = (env.INGRESO_REMITO_EXTRACTION ?? "").trim().toLowerCase();
  const model = (env.INGRESO_REMITO_GEMINI_MODEL ?? env.CREAMY_GEMINI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (mode !== "gemini") {
    return { available: false, provider: null, model, code: "disabled", reason: "La lectura automática de remitos todavía no está activada en GENUS OS. Cargá los datos a mano: la foto queda adjunta igual." };
  }
  if (!env.GEMINI_API_KEY?.trim()) {
    return { available: false, provider: null, model, code: "missing_key", reason: "La lectura automática está habilitada pero falta la clave del servicio (GEMINI_API_KEY). Cargá los datos a mano y avisá a Sistemas." };
  }
  return { available: true, provider: "gemini", model, code: "ok", reason: "" };
}

/** Base de la API. Solo se acepta otra distinta de Google para pruebas locales (localhost / 127.0.0.1). */
function baseUrl(env: Partial<NodeJS.ProcessEnv>): string {
  const raw = (env.INGRESO_REMITO_GEMINI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (raw && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(raw) && env.VERCEL !== "1") return raw;
  return DEFAULT_BASE;
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
export type ExtractionOutcome = { ok: true; data: ExtractedRemito; provider: string } | { ok: false; message: string; kind: "disabled" | "config" | "limit" | "unavailable" | "unreadable" | "timeout" };

/** Quita cualquier cosa con forma de clave de Google antes de registrar o devolver un texto. */
export function redactSecrets(text: string): string {
  return text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[clave oculta]").replace(/(api[_-]?key["'=: ]+)[^\s"']{8,}/gi, "$1[oculta]");
}

function logFailure(kind: string, status: number | null, detail: string) {
  // Sin claves ni contenido del remito: solo para que un fallo nunca sea invisible en los logs del servidor.
  console.warn(`[ingreso-remito] lectura automática falló (${kind}${status ? ` · HTTP ${status}` : ""})${detail ? `: ${redactSecrets(detail).slice(0, 200)}` : ""}`);
}

type GeminiBody = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; message?: string };
};

function generationConfig(model: string) {
  const cfg: Record<string, unknown> = { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 };
  // Gemini 2.5 Flash «piensa» por defecto (lento y con costo): para leer un remito no hace falta.
  if (/gemini-2\.5-flash/.test(model) && !/lite/.test(model)) cfg.thinkingConfig = { thinkingBudget: 0 };
  return cfg;
}

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
  const doFetch = deps.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const parts: Array<Record<string, unknown>> = [{ text: PROMPT }];
    for (const f of used) parts.push({ inline_data: { mime_type: f.contentType, data: Buffer.from(f.bytes).toString("base64") } });
    const res = await doFetch(`${baseUrl(env)}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: generationConfig(cfg.model) }),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => null)) as GeminiBody | null;
    if (!res.ok) {
      const status = res.status;
      logFailure("http", status, body?.error?.message ?? "");
      if (status === 400 && /api key/i.test(body?.error?.message ?? "")) return { ok: false, kind: "config", message: "El servicio de lectura rechazó la clave configurada. Avisá a Sistemas; mientras tanto cargá los datos a mano." };
      if (status === 401 || status === 403) return { ok: false, kind: "config", message: "El servicio de lectura no está autorizado con la clave actual. Avisá a Sistemas; mientras tanto cargá los datos a mano." };
      if (status === 429) return { ok: false, kind: "limit", message: "El servicio de lectura alcanzó su límite de uso por ahora. Reintentá en unos minutos o cargá los datos a mano." };
      if (status === 404) return { ok: false, kind: "config", message: "El modelo de lectura configurado no existe. Avisá a Sistemas; mientras tanto cargá los datos a mano." };
      return { ok: false, kind: "unavailable", message: "El servicio de lectura no está disponible ahora. Podés reintentar o completar los datos manualmente." };
    }
    if (body?.promptFeedback?.blockReason) {
      logFailure("bloqueado", null, body.promptFeedback.blockReason);
      return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
    }
    const cand = body?.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      logFailure("respuesta vacía", null, cand?.finishReason ?? "");
      return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    } catch {
      logFailure("JSON inválido", null, cand?.finishReason ?? "");
      return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
    }
    const data = sanitizeExtraction(parsed);
    if (!data) {
      logFailure("sin datos de remito", null, "");
      return { ok: false, kind: "unreadable", message: MSG_UNREADABLE };
    }
    return { ok: true, data, provider: `gemini:${cfg.model}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logFailure(aborted ? "timeout" : "red", null, err instanceof Error ? err.message : "");
    return aborted
      ? { ok: false, kind: "timeout", message: "La lectura tardó demasiado. Podés reintentar o completar los datos manualmente." }
      : { ok: false, kind: "unavailable", message: "No se pudo contactar al servicio de lectura. Podés reintentar o completar los datos manualmente." };
  } finally {
    clearTimeout(timer);
  }
}

export type ProbeResult = { ok: boolean; provider: string | null; model: string; code: ExtractionConfig["code"] | "http_error"; status: number | null; message: string };

/**
 * Prueba liviana de configuración para administradores: manda un texto fijo (NUNCA un remito) y comprueba que la clave, el modelo y
 * la red respondan. Devuelve solo estado y mensaje redactado; jamás la clave.
 */
export async function probeExtraction(deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv> } = {}): Promise<ProbeResult> {
  const env = deps.env ?? process.env;
  const cfg = extractionConfig(env);
  if (!cfg.available) return { ok: false, provider: null, model: cfg.model, code: cfg.code, status: null, message: cfg.reason };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${baseUrl(env)}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Respondé únicamente la palabra "OK".' }] }], generationConfig: { temperature: 0, maxOutputTokens: 16, ...(/gemini-2\.5-flash/.test(cfg.model) && !/lite/.test(cfg.model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => null)) as GeminiBody | null;
    if (!res.ok) return { ok: false, provider: "gemini", model: cfg.model, code: "http_error", status: res.status, message: redactSecrets(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
    return { ok: true, provider: "gemini", model: cfg.model, code: "ok", status: res.status, message: "Gemini respondió correctamente con la clave y el modelo configurados." };
  } catch (err) {
    return { ok: false, provider: "gemini", model: cfg.model, code: "http_error", status: null, message: err instanceof Error && err.name === "AbortError" ? "Tiempo de espera agotado." : "No se pudo contactar a Gemini desde el servidor." };
  } finally {
    clearTimeout(timer);
  }
}
