"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticatedPreview } from "../lib/auth-session-helpers";
import { OsSignInScreen } from "./os-sign-in-screen";

/** Si ya hay sesión activa, redirige directo a /mi-trabajo en vez de mostrar el login. */
export function OsLoginGate() {
  const router = useRouter();
  const [authenticated] = useState(() => isAuthenticatedPreview());

  useEffect(() => {
    if (authenticated) router.replace("/mi-trabajo");
  }, [authenticated, router]);

  if (authenticated) return null;

  return <OsSignInScreen accessPreview />;
}
