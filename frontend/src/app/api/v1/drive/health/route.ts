import { NextResponse } from "next/server";
import { operationsDocumentRepository } from "@/lib/adapters/drive/operations-document-repository";
import { buildRuntimeEnvSnapshot } from "@/lib/config/runtime-env-check";

export const dynamic = "force-dynamic";

/** Health Drive — usa las mismas variables runtime que /api/v1/env-check. */
export async function GET() {
  const env = await buildRuntimeEnvSnapshot();

  if (env.mode !== "real") {
    return NextResponse.json({
      ok: true,
      mode: "demo",
      message: "Modo demo — Drive no requerido.",
      env: {
        mode: env.mode,
        publicMode: env.publicMode,
        rawGenusDataMode: env.rawGenusDataMode,
        rawPublicGenusDataMode: env.rawPublicGenusDataMode,
        vercelEnv: env.vercelEnv,
        gitCommit: env.gitCommit,
        canUseDriveAdapter: env.canUseDriveAdapter,
        driveAdapterBlockers: env.driveAdapterBlockers,
      },
    });
  }

  if (!env.canUseDriveAdapter) {
    return NextResponse.json({
      ok: false,
      mode: "real",
      message: env.driveAdapterBlockers.join(" ") || "Drive adapter no disponible.",
      env: {
        hasServiceAccountEmail: env.hasServiceAccountEmail,
        hasPrivateKey: env.hasPrivateKey,
        hasDriveFolderId: env.hasDriveFolderId,
        fallbackToDemo: env.fallbackToDemo,
        privateKeyFormat: env.privateKey.format,
        privateKeyAppearsValidPem: env.privateKey.appearsValidPem,
        driveFolder: env.driveFolder,
        driveAdapterBlockers: env.driveAdapterBlockers,
        vercelEnv: env.vercelEnv,
        gitCommit: env.gitCommit,
      },
    });
  }

  const health = await operationsDocumentRepository.health();
  return NextResponse.json({
    ...health,
    env: {
      vercelEnv: env.vercelEnv,
      gitCommit: env.gitCommit,
      fallbackToDemo: env.fallbackToDemo,
      privateKeyFormat: env.privateKey.format,
      driveFolder: env.driveFolder,
      canUseDriveAdapter: env.canUseDriveAdapter,
    },
  });
}
