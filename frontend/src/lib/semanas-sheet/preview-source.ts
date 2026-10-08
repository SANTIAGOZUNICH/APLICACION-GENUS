/**
 * Fuente de datos de PREVIEW para Producción → Semanas: una copia XLSX de SEMANAS 2026.
 *
 * Por qué existe: en Preview la planilla original (Google) puede no estar indexada/legible por la cuenta de servicio, y
 * escribir sobre ella está prohibido. Esta fuente permite revisar el calendario en el navegador con datos reales de la
 * COPIA, de solo lectura. NUNCA se habilita en Production (VERCEL_ENV=production / GENUS_ENV=production) y jamás
 * escribe en Google ni en la base: las ediciones quedan desactivadas (`writable=false`).
 *
 * Orden: (1) libro subido por el usuario (Blob privado si hay storage; si no, memoria de la instancia),
 *        (2) copia incluida en el deploy (assets/semanas-preview/).
 */
import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { getFileStorage, isPrivateFileStorageConfigured } from "@/lib/storage/file-storage";
import { OrdersValidationError } from "@/lib/orders/types";
import { parseWeeklyCalendar } from "./calendar-model";
import { XlsxFixtureGateway } from "./xlsx-grid";

export const PREVIEW_SPREADSHEET_ID = "preview-xlsx-semanas-2026";
export const PREVIEW_STORAGE_KEY = "semanas-preview/current.xlsx";
export const PREVIEW_MAX_BYTES = 4 * 1024 * 1024; // el límite de body de una función de Vercel es 4,5 MB
const BUNDLED = "assets/semanas-preview/SEMANAS-2026-copia-de-prueba.xlsx";
const REQUIRED_SHEETS = ["ELABORACION", "ACONDICIONAMIENTO", "ENTREGAS", "QACONDDIA"] as const;

/** Preview/desarrollo sí; Production jamás (aunque se fuerce con variables). */
export function isPreviewSourceAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === "production" || env.GENUS_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview") return true;
  return !env.VERCEL_ENV && env.NODE_ENV !== "production";
}

export interface WorkbookSummary {
  sha256: string;
  bytes: number;
  sheets: string[];
  weeks: Record<string, number>;
}

/** Valida que `bytes` sea un libro SEMANAS 2026 usable. Lanza OrdersValidationError con el motivo concreto. */
export async function validateSemanasWorkbook(bytes: Uint8Array): Promise<WorkbookSummary> {
  if (bytes.byteLength === 0) throw new OrdersValidationError("El archivo está vacío.");
  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new OrdersValidationError(`El archivo supera ${PREVIEW_MAX_BYTES / 1024 / 1024} MB.`);
  // .xlsx = zip ("PK"); descarta .xls/.csv/imágenes renombradas.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new OrdersValidationError("No es un archivo .xlsx válido (se esperaba un libro de Excel).");
  let sheets: string[];
  try {
    sheets = XLSX.read(Buffer.from(bytes), { type: "buffer", bookSheets: true }).SheetNames;
  } catch {
    throw new OrdersValidationError("No se pudo leer el libro: el archivo está dañado.");
  }
  const missing = REQUIRED_SHEETS.filter((s) => !sheets.includes(s));
  if (missing.length) throw new OrdersValidationError(`Faltan pestañas obligatorias: ${missing.join(", ")}.`);
  const gw = new XlsxFixtureGateway(bytes);
  const weeks: Record<string, number> = {};
  for (const tab of ["ELABORACION", "ACONDICIONAMIENTO"] as const) {
    const rows = await gw.readTab("x", tab);
    const n = parseWeeklyCalendar(rows, await gw.readMerges("x", tab), { year: Number(process.env.SEMANAS_YEAR ?? 2026) }).length;
    if (n === 0) throw new OrdersValidationError(`La pestaña ${tab} no tiene semanas (se esperan filas «Lunes … Viernes» en B, D, F, H, J).`);
    weeks[tab] = n;
  }
  const entregas = await gw.readTab("x", "ENTREGAS");
  if (!entregas.some((r) => String(r[1] ?? "").trim().toLowerCase() === "fecha")) throw new OrdersValidationError("La pestaña ENTREGAS no tiene la fila de encabezado «FECHA».");
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength, sheets, weeks };
}

const g = globalThis as unknown as { __genusSemanasPreview?: { memory: Uint8Array | null; cache: { sha: string; gw: XlsxFixtureGateway } | null } };
function state() {
  if (!g.__genusSemanasPreview) g.__genusSemanasPreview = { memory: null, cache: null };
  return g.__genusSemanasPreview;
}

function bundledBytes(): Uint8Array {
  return readFileSync(path.join(process.cwd(), BUNDLED));
}

export type PreviewOrigin = "UPLOADED_STORAGE" | "UPLOADED_MEMORY" | "BUNDLED";

async function currentBytes(): Promise<{ bytes: Uint8Array; origin: PreviewOrigin }> {
  const st = state();
  if (st.memory) return { bytes: st.memory, origin: "UPLOADED_MEMORY" };
  if (isPrivateFileStorageConfigured() || process.env.VITEST === "true") {
    try {
      const storage = getFileStorage();
      if (await storage.exists(PREVIEW_STORAGE_KEY)) {
        const got = await storage.get(PREVIEW_STORAGE_KEY);
        return { bytes: got.bytes, origin: "UPLOADED_STORAGE" };
      }
    } catch {
      /* storage no disponible: se usa la copia incluida */
    }
  }
  return { bytes: bundledBytes(), origin: "BUNDLED" };
}

export async function getPreviewGateway(): Promise<{ gateway: XlsxFixtureGateway; origin: PreviewOrigin; sha256: string }> {
  const { bytes, origin } = await currentBytes();
  const sha = createHash("sha256").update(bytes).digest("hex");
  const st = state();
  if (!st.cache || st.cache.sha !== sha) st.cache = { sha, gw: new XlsxFixtureGateway(bytes) };
  return { gateway: st.cache.gw, origin, sha256: sha };
}

export async function getPreviewStatus() {
  const { bytes, origin } = await currentBytes();
  const summary = await validateSemanasWorkbook(bytes);
  return { origin, persisted: origin !== "UPLOADED_MEMORY", storageConfigured: isPrivateFileStorageConfigured(), ...summary };
}

/** Guarda un libro YA validado. Devuelve si quedó persistente (Blob) o solo en la memoria de la instancia. */
export async function savePreviewWorkbook(bytes: Uint8Array): Promise<{ persisted: boolean }> {
  const st = state();
  st.cache = null;
  if (isPrivateFileStorageConfigured() || process.env.VITEST === "true") {
    try {
      await getFileStorage().put({ storageKey: PREVIEW_STORAGE_KEY, bytes, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", allowOverwrite: true });
      st.memory = null;
      return { persisted: true };
    } catch {
      /* sin storage escribible: queda en memoria */
    }
  }
  st.memory = bytes;
  return { persisted: false };
}

export async function resetPreviewWorkbook(): Promise<void> {
  const st = state();
  st.memory = null;
  st.cache = null;
  if (isPrivateFileStorageConfigured() || process.env.VITEST === "true") {
    try {
      await getFileStorage().delete(PREVIEW_STORAGE_KEY);
    } catch {
      /* nada que borrar */
    }
  }
}
