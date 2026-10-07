/**
 * Lector de remitos con IA (visión). Reutiliza la infraestructura de Creamy
 * (`ai` + @ai-sdk/google | @ai-sdk/openai, mismas claves/env). Solo PROPONE:
 * devuelve un objeto crudo que `validateRemitoExtraction` valida server-side.
 */
import "server-only";

import { generateText, jsonSchema, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveCreamyProvider } from "@/lib/assistant/creamy-provider";
import { REMITO_EXTRACTION_JSON_SCHEMA, RemitoAiInvalidResponseError } from "./extraction";

export type RemitoReaderFile = { bytes: Buffer; contentType: string; name: string };

export interface RemitoReader {
  readonly info: { provider: string; model: string };
  read(files: RemitoReaderFile[]): Promise<unknown>;
}

export const REMITO_READER_SYSTEM_PROMPT = [
  "Sos un lector de remitos de proveedores para un laboratorio cosmético. Recibís 1 o más imágenes/páginas de UN mismo remito.",
  "Transcribí SOLO lo que se ve. Nunca inventes ni completes datos que no estén impresos.",
  "Si el documento no es un remito, está borroso, cortado, de baja resolución o parece faltar una página, devolvé legible=false (o esRemito=false) y explicá el motivo en 'motivo'.",
  "proveedor = emisor del remito (no el destinatario Laboratorio Genus).",
  "items = una entrada por línea de material. Ignorá filas de totales, subtotales, transporte y observaciones.",
  "Si varias páginas repiten encabezado, pie o una misma línea de continuación, NO dupliques líneas.",
  "cantidadTexto = la CANTIDAD ENTREGADA exactamente como está impresa (ej. '1.000'). NUNCA uses la capacidad o medida del envase ('30 ML', '24/410') como cantidad.",
  "unidadOriginal = la unidad impresa tal cual (UN, U, PCS, CAJAS, BULTOS, KG). No conviertas cajas a unidades.",
  "Respondé únicamente con el objeto estructurado pedido.",
].join("\n");

function buildModel(): { model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>; info: RemitoReader["info"] } | {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  info: RemitoReader["info"];
} {
  const resolved = resolveCreamyProvider();
  // Modelo dedicado opcional (OCR visual suele rendir mejor con un modelo más grande).
  const override = process.env.REMITO_AI_MODEL?.trim();
  const modelId = override || resolved.model;
  if (!resolved.configured) {
    throw Object.assign(new Error("La lectura de remitos con IA no está configurada (falta la clave del proveedor)."), {
      status: 503,
      code: "REMITO_AI_NOT_CONFIGURED",
    });
  }
  if (resolved.provider === "gemini") {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
    return { model: google(modelId), info: { provider: "gemini", model: modelId } };
  }
  const key = (process.env.CREAMY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim();
  const openai = createOpenAI({ apiKey: key });
  return { model: openai(modelId), info: { provider: "openai", model: modelId } };
}

export function createDefaultRemitoReader(): RemitoReader {
  const { model, info } = buildModel();
  return {
    info,
    async read(files) {
      try {
        const result = await generateText({
          model,
          system: REMITO_READER_SYSTEM_PROMPT,
          output: Output.object({ schema: jsonSchema(REMITO_EXTRACTION_JSON_SCHEMA as never) }),
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(50_000),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Interpretá este remito (${files.length} archivo(s)/página(s)).` },
                ...files.map((f) =>
                  f.contentType === "application/pdf"
                    ? ({ type: "file", data: f.bytes, mediaType: "application/pdf", filename: f.name } as const)
                    : ({ type: "image", image: f.bytes, mediaType: f.contentType } as const)
                ),
              ],
            },
          ],
        });
        return result.output;
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "REMITO_AI_NOT_CONFIGURED") {
          throw err;
        }
        const name = err instanceof Error ? err.name : "";
        if (/NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/i.test(name)) {
          throw new RemitoAiInvalidResponseError();
        }
        console.warn("[remito-ai] fallo del proveedor", name);
        throw Object.assign(new Error("No se pudo interpretar el remito en este momento. Probá de nuevo."), {
          status: 502,
          code: "REMITO_AI_PROVIDER_ERROR",
        });
      }
    },
  };
}
