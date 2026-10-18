/**
 * Lectura automática de remitos (OCR / visión) — SOLO sugerencia, desactivada por defecto.
 *
 * Reutiliza el proveedor de IA que GENUS OS ya tiene (Gemini, `GEMINI_API_KEY`), pero NO se activa solo por existir esa clave:
 * enviar la foto de un remito real a un servicio externo exige una autorización explícita de quien administra el sistema →
 * `INGRESO_REMITO_EXTRACTION=gemini`. Sin eso la pantalla funciona igual con carga manual + foto adjunta.
 *
 * La respuesta se trata como dato NO confiable: `sanitizeExtraction` descarta lo inválido, deja vacío (y marcado «Revisar»)
 * lo ausente o ambiguo, y nada de esto toca stock.
 */
import "server-only";

import { sanitizeExtraction, type ExtractedRemito } from "@/lib/inventory/receipt-rules";

export type ExtractionConfig = { available: boolean; provider: "gemini" | null; model: string; reason: string };

const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 45_000;

export function extractionConfig(env: Partial<NodeJS.ProcessEnv> = process.env): ExtractionConfig {
  const mode = (env.INGRESO_REMITO_EXTRACTION ?? "").trim().toLowerCase();
  const model = (env.INGRESO_REMITO_GEMINI_MODEL ?? env.CREAMY_GEMINI_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  if (mode !== "gemini") {
    return { available: false, provider: null, model, reason: "La lectura automática no está activada. Cargá los datos a mano: la foto queda adjunta igual." };
  }
  if (!env.GEMINI_API_KEY?.trim()) {
    return { available: false, provider: null, model, reason: "La lectura automática está habilitada pero falta la clave del servicio. Cargá los datos a mano." };
  }
  return { available: true, provider: "gemini", model, reason: "" };
}

const PROMPT = `Sos un asistente de lectura de remitos de proveedores argentinos. Mirá las imágenes/páginas adjuntas (son del MISMO remito) y devolvé SOLO un JSON con esta forma:
{"supplier": string, "remitoNumber": string, "remitoDate": "YYYY-MM-DD" | "", "notes": string,
 "unclearFields": string[],
 "lines": [{"supplierCode": string, "description": string, "quantity": number|null, "unit": string, "packages": number|null, "lot": string, "expiryDate": "YYYY-MM-DD"|"", "notes": string, "confidence": number, "unclearFields": string[]}]}
Reglas estrictas:
- UNA línea por producto. No inventes ni completes datos que no se lean con claridad: dejá "" o null y agregá el nombre del campo en "unclearFields".
- "supplierCode" es el código que imprime el PROVEEDOR; no lo conviertas en otro código.
- "quantity" es la cantidad recibida/remitida de esa línea como número; "unit" la unidad escrita (kg, g, un, l...).
- "packages" son los bultos si figuran. "lot" y "expiryDate" solo si están impresos.
- "notes": observaciones relevantes del remito (condiciones, faltantes, daños). Fechas siempre en formato ISO.
- Si no es un remito legible, devolvé {"supplier":"","remitoNumber":"","remitoDate":"","notes":"","unclearFields":[],"lines":[]}.`;

export type ExtractionFile = { bytes: Uint8Array; contentType: string };
export type ExtractionOutcome = { ok: true; data: ExtractedRemito; provider: string } | { ok: false; message: string };

/** Llama al servicio y devuelve la sugerencia saneada. Nunca lanza: ante cualquier falla devuelve ok:false (carga manual). */
export async function extractRemito(files: ExtractionFile[], deps: { fetchImpl?: typeof fetch; env?: Partial<NodeJS.ProcessEnv> } = {}): Promise<ExtractionOutcome> {
  const env = deps.env ?? process.env;
  const cfg = extractionConfig(env);
  if (!cfg.available) return { ok: false, message: cfg.reason };
  if (files.length === 0) return { ok: false, message: "No hay archivos para leer." };
  const doFetch = deps.fetchImpl ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const parts: Array<Record<string, unknown>> = [{ text: PROMPT }];
    for (const f of files) parts.push({ inline_data: { mime_type: f.contentType, data: Buffer.from(f.bytes).toString("base64") } });
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, message: "El servicio de lectura no está disponible ahora. Cargá los datos a mano." };
    const body = (await res.json().catch(() => null)) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
    const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      return { ok: false, message: "No se pudo interpretar la lectura del remito. Cargá los datos a mano." };
    }
    const data = sanitizeExtraction(parsed);
    if (!data) return { ok: false, message: "No se pudo leer el remito (foto borrosa o sin datos). Cargá los datos a mano." };
    return { ok: true, data, provider: `gemini:${cfg.model}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, message: aborted ? "La lectura tardó demasiado. Cargá los datos a mano." : "No se pudo contactar al servicio de lectura. Cargá los datos a mano." };
  } finally {
    clearTimeout(timer);
  }
}
