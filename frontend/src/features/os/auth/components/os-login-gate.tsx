"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { genusAuthAdapter } from "../adapters/genus-auth-adapter";
import { OsSignInScreen } from "./os-sign-in-screen";

/** Verifica la cookie de sesión antes de redirigir desde el login. */
export function OsLoginGate() {
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void genusAuthAdapter
      .hydrateSession()
      .then((session) => {
        if (active) setAuthenticated(Boolean(session));
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authenticated) router.replace("/mi-trabajo");
  }, [authenticated, router]);

  if (!hydrated || authenticated) return null;

  return <OsSignInScreen accessPreview />;
}
