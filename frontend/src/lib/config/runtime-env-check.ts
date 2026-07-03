import "server-only";

import {
  getGenusFolderId,
  hasAnyCriticalSheetFastPath,
  isDriveRepositoryConfigured,
} from "@/lib/adapters/drive/drive-folder-config";
import { googleDriveGateway } from "@/lib/adapters/drive/google-drive-gateway";
import { hasGoogleCredentials } from "@/lib/adapters/google/google-auth";
import { canUseDriveAdapter } from "@/lib/api/bff-helpers";
import {
  getClientDataMode,
  getServerDataMode,
  shouldFallbackToDemo,
} from "@/lib/config/data-mode";

export type PrivateKeyFormat =
  | "missing"
  | "missing_pem_header"
  | "literal_newlines"
  | "escaped_backslash_n"
  | "single_line_no_newlines";

export type DriveFolderErrorCode =
  | "skipped"
  | "missing_folder_id"
  | "missing_credentials"
  | "invalid_private_key"
  | "folder_not_found"
  | "permission_denied"
  | "auth_failed"
  | "unknown";

export interface PrivateKeyDiagnostic {
  present: boolean;
  hasBeginPrivateKey: boolean;
  hasEndPrivateKey: boolean;
  hasLiteralNewlines: boolean;
  hasEscapedNewlines: boolean;
  format: PrivateKeyFormat;
  /** PEM parseable after \\n normalization — no key material exposed. */
  appearsValidPem: boolean;
}

export interface DriveFolderDiagnostic {
  ok: boolean;
  errorCode: DriveFolderErrorCode;
  message: string;
  folderName?: string;
  subfolderCount?: number;
}

export interface RuntimeEnvSnapshot {
  mode: ReturnType<typeof getServerDataMode>;
  publicMode: ReturnType<typeof getClientDataMode>;
  rawGenusDataMode: string | null;
  rawPublicGenusDataMode: string | null;
  hasServiceAccountEmail: boolean;
  hasPrivateKey: boolean;
  hasApplicationCredentialsPath: boolean;
  hasDriveFolderId: boolean;
  hasCriticalSheetFastPath: boolean;
  fallbackToDemo: boolean;
  nodeEnv: string;
  vercelEnv: string | null;
  gitCommit: string | null;
  vercelUrl: string | null;
  canUseDriveAdapter: boolean;
  driveAdapterBlockers: string[];
  privateKey: PrivateKeyDiagnostic;
  driveFolder: DriveFolderDiagnostic;
  checkedAt: string;
}

function readRawEnv(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  return value;
}

export function analyzePrivateKeyFormat(raw: string | undefined | null): PrivateKeyDiagnostic {
  if (!raw?.trim()) {
    return {
      present: false,
      hasBeginPrivateKey: false,
      hasEndPrivateKey: false,
      hasLiteralNewlines: false,
      hasEscapedNewlines: false,
      format: "missing",
      appearsValidPem: false,
    };
  }

  const trimmed = raw.trim();
  const hasBeginPrivateKey = trimmed.includes("BEGIN PRIVATE KEY");
  const hasEndPrivateKey = trimmed.includes("END PRIVATE KEY");
  const hasLiteralNewlines = trimmed.includes("\n");
  const hasEscapedNewlines = trimmed.includes("\\n");

  let format: PrivateKeyFormat = "single_line_no_newlines";
  if (!hasBeginPrivateKey) {
    format = "missing_pem_header";
  } else if (hasLiteralNewlines && !hasEscapedNewlines) {
    format = "literal_newlines";
  } else if (hasEscapedNewlines) {
    format = "escaped_backslash_n";
  }

  const normalized = trimmed.replace(/\\n/g, "\n");
  const appearsValidPem =
    normalized.includes("BEGIN PRIVATE KEY") && normalized.includes("END PRIVATE KEY");

  return {
    present: true,
    hasBeginPrivateKey,
    hasEndPrivateKey,
    hasLiteralNewlines,
    hasEscapedNewlines,
    format,
    appearsValidPem,
  };
}

function buildDriveAdapterBlockers(): string[] {
  const blockers: string[] = [];

  if (getServerDataMode() !== "real") {
    blockers.push(
      `GENUS_DATA_MODE efectivo=${getServerDataMode()} (raw server=${readRawEnv("GENUS_DATA_MODE") ?? "—"}, public=${readRawEnv("NEXT_PUBLIC_GENUS_DATA_MODE") ?? "—"})`
    );
  }

  if (!hasGoogleCredentials()) {
    blockers.push("Credenciales Google ausentes o incompletas.");
  } else {
    const keyDiag = analyzePrivateKeyFormat(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
    if (keyDiag.present && !keyDiag.appearsValidPem) {
      blockers.push(`Private key PEM inválida (format=${keyDiag.format}).`);
    }
  }

  if (!isDriveRepositoryConfigured()) {
    blockers.push("GOOGLE_DRIVE_GENUS_FOLDER_ID ausente y sin fast-path de Sheets.");
  }

  return blockers;
}

function classifyDriveError(err: unknown): { errorCode: DriveFolderErrorCode; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid_grant") ||
    lower.includes("decrypt") ||
    lower.includes("private key") ||
    lower.includes("err_ossl") ||
    lower.includes("no key or cert")
  ) {
    return {
      errorCode: "invalid_private_key",
      message:
        "Private key inválida o mal formateada — verificar BEGIN/END PRIVATE KEY y \\n en Vercel.",
    };
  }

  if (lower.includes("unauthorized") || lower.includes("invalid credentials")) {
    return {
      errorCode: "auth_failed",
      message: "Autenticación Google falló — revisar email SA y private key.",
    };
  }

  if (lower.includes("not found") || lower.includes("404")) {
    return {
      errorCode: "folder_not_found",
      message: "Folder ID inexistente o incorrecto — verificar GOOGLE_DRIVE_GENUS_FOLDER_ID.",
    };
  }

  if (
    lower.includes("permission") ||
    lower.includes("403") ||
    lower.includes("forbidden")
  ) {
    return {
      errorCode: "permission_denied",
      message:
        "Service account sin permiso — compartir carpeta GENUS con el email de la SA (Viewer).",
    };
  }

  return {
    errorCode: "unknown",
    message: `Error al acceder Drive: ${message.slice(0, 200)}`,
  };
}

export async function probeDriveFolderAccess(): Promise<DriveFolderDiagnostic> {
  const folderId = getGenusFolderId();

  if (!folderId) {
    return {
      ok: false,
      errorCode: "missing_folder_id",
      message: "GOOGLE_DRIVE_GENUS_FOLDER_ID no configurado.",
    };
  }

  if (!hasGoogleCredentials()) {
    return {
      ok: false,
      errorCode: "missing_credentials",
      message: "Credenciales Google no configuradas.",
    };
  }

  const keyDiag = analyzePrivateKeyFormat(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  if (keyDiag.present && !keyDiag.appearsValidPem) {
    return {
      ok: false,
      errorCode: "invalid_private_key",
      message: `Private key PEM inválida (format=${keyDiag.format}).`,
    };
  }

  try {
    const meta = await googleDriveGateway.getFileMetadata(folderId);
    if (!meta) {
      return {
        ok: false,
        errorCode: "folder_not_found",
        message: "Folder ID inexistente o inaccesible — verificar ID y permisos.",
      };
    }

    const subfolders = await googleDriveGateway.listSubfolders(folderId);
    return {
      ok: true,
      errorCode: "skipped",
      message: "Carpeta GENUS accesible.",
      folderName: meta.name,
      subfolderCount: subfolders.length,
    };
  } catch (err) {
    const classified = classifyDriveError(err);
    return { ok: false, ...classified };
  }
}

export async function buildRuntimeEnvSnapshot(): Promise<RuntimeEnvSnapshot> {
  const privateKey = analyzePrivateKeyFormat(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const driveFolder =
    getServerDataMode() === "real" && hasGoogleCredentials() && getGenusFolderId()
      ? await probeDriveFolderAccess()
      : {
          ok: false,
          errorCode: "skipped" as const,
          message: "Probe omitido — modo demo o credenciales/folder ausentes.",
        };

  return {
    mode: getServerDataMode(),
    publicMode: getClientDataMode(),
    rawGenusDataMode: readRawEnv("GENUS_DATA_MODE"),
    rawPublicGenusDataMode: readRawEnv("NEXT_PUBLIC_GENUS_DATA_MODE"),
    hasServiceAccountEmail: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()),
    hasPrivateKey: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()),
    hasApplicationCredentialsPath: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()),
    hasDriveFolderId: Boolean(getGenusFolderId()),
    hasCriticalSheetFastPath: hasAnyCriticalSheetFastPath(),
    fallbackToDemo: shouldFallbackToDemo(),
    nodeEnv: process.env.NODE_ENV ?? "unknown",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    gitCommit:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      null,
    vercelUrl: process.env.VERCEL_URL ?? null,
    canUseDriveAdapter: canUseDriveAdapter(),
    driveAdapterBlockers: buildDriveAdapterBlockers(),
    privateKey,
    driveFolder,
    checkedAt: new Date().toISOString(),
  };
}
