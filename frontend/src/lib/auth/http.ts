import "server-only";

import { NextResponse } from "next/server";
import {
  AuthBlockedError,
  AuthInvalidCredentialsError,
  AuthRateLimitedError,
  AuthUnauthorizedError,
} from "@/lib/auth/types";

/** Mapea errores de Genus Auth a respuestas HTTP. Nunca incluye password ni token. */
export function authErrorResponse(err: unknown): NextResponse {
  if (
    err instanceof AuthUnauthorizedError ||
    err instanceof AuthInvalidCredentialsError ||
    err instanceof AuthBlockedError ||
    err instanceof AuthRateLimitedError
  ) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[auth]", err);
  return NextResponse.json(
    { error: "Error interno de autenticación.", code: "AUTH_INTERNAL_ERROR" },
    { status: 500 }
  );
}
