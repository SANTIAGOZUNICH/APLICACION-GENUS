/** Validación de uploads de procedimientos (usable en cliente y servidor). */

export const PROCEDURE_ALLOWED_EXT = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "zip",
]);

export const PROCEDURE_ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
]);

export const PROCEDURE_MAX_BYTES = 50 * 1024 * 1024;

export function validateProcedureUpload(params: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): void {
  const ext = params.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!PROCEDURE_ALLOWED_EXT.has(ext)) {
    throw new Error(`Extensión no permitida: .${ext || "(sin extensión)"}`);
  }
  const mimeOk =
    PROCEDURE_ALLOWED_MIME.has(params.mimeType) ||
    (ext === "csv" && params.mimeType.startsWith("text/")) ||
    (ext === "txt" && params.mimeType.startsWith("text/")) ||
    (["jpg", "jpeg"].includes(ext) && params.mimeType.startsWith("image/"));
  if (!mimeOk) {
    throw new Error(`MIME no permitido: ${params.mimeType}`);
  }
  if (params.sizeBytes <= 0 || params.sizeBytes > PROCEDURE_MAX_BYTES) {
    throw new Error("Tamaño de archivo inválido (máx. 50 MB).");
  }
  if (/[\\/]/.test(params.fileName) || params.fileName.includes("..")) {
    throw new Error("Nombre de archivo inválido.");
  }
}

export function mimeMatchesFilter(mime: string, filter: string): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "pdf") return mime === "application/pdf";
  if (filter === "image") return mime.startsWith("image/");
  if (filter === "doc") {
    return (
      mime.includes("word") ||
      mime === "application/msword" ||
      mime === "text/plain"
    );
  }
  if (filter === "sheet") {
    return mime.includes("sheet") || mime.includes("excel") || mime.includes("csv");
  }
  if (filter === "zip") return mime.includes("zip");
  return mime.includes(filter);
}
