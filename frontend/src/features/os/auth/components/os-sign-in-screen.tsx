"use client";

import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { GENUS_COMPANY_NAME } from "../constants";
import {
  findMockUserByEmail,
  PREVIEW_AUTH_ERROR,
  type MockPreviewUser,
} from "../lib/mock-preview-users";
import { mockAuthAdapter } from "../lib/auth-session-helpers";
import { OsAuthField } from "./os-auth-field";
import { OsAuthMockBanner } from "./os-auth-mock-banner";
import { GenusOsLogo } from "./genus-os-logo";
import { OsInstitutionalCredential } from "./os-institutional-credential";
import { OsLoginFooter } from "./os-login-footer";
import { OsOperationalContext } from "./os-operational-context";
import { OsSessionBootstrapScreen } from "./os-session-bootstrap-screen";
import { OsSignInIdentityCard } from "./os-sign-in-identity-card";
import type { OsSignInCredentials, OsSignInIdentityPreview, OsSignInScreenProps } from "../types";

export type { OsSignInCredentials, OsSignInIdentityPreview, OsSignInScreenProps } from "../types";

type ScreenPhase = "sign-in" | "fade-out" | "bootstrap" | "redirecting";

const FADE_MS = 280;

function isCorporateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function toIdentityPreview(user: MockPreviewUser): OsSignInIdentityPreview {
  return {
    displayName: user.displayName,
    jobTitle: user.jobTitle,
    sectorLabel: user.sectorLabel,
    roleLabel: user.roleLabel,
    company: GENUS_COMPANY_NAME,
  };
}

/** Pantalla premium de ingreso — Access Preview + UX polish Fase 4.1c. */
export function OsSignInScreen({
  onSubmit,
  accessPreview = false,
  simulateBootstrapOnSubmit = false,
  isSubmitting = false,
  formError = null,
  identityPreview = null,
}: OsSignInScreenProps) {
  const router = useRouter();
  const rememberId = useId();
  const [phase, setPhase] = useState<ScreenPhase>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const emailEntered = email.trim().length > 0;
  const matchedUser = useMemo(
    () => (emailEntered ? findMockUserByEmail(email) : undefined),
    [email, emailEntered]
  );

  const identityForCard = useMemo(() => {
    if (identityPreview) return identityPreview;
    if (matchedUser) return toIdentityPreview(matchedUser);
    return null;
  }, [identityPreview, matchedUser]);

  const validate = useCallback(() => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) {
      next.email = "Ingresá tu email corporativo.";
    } else if (!isCorporateEmail(email)) {
      next.email = "El formato del email no es válido.";
    }
    if (!password) {
      next.password = "Ingresá tu contraseña.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }, [email, password]);

  const startBootstrap = useCallback((redirectTo: string) => {
    setPendingRedirect(redirectTo);
    setPhase("fade-out");
    window.setTimeout(() => setPhase("bootstrap"), FADE_MS);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    if (!validate()) return;

    const credentials: OsSignInCredentials = { email, password, rememberMe };

    if (onSubmit) {
      void onSubmit(credentials);
      return;
    }

    if (accessPreview) {
      const session = await mockAuthAdapter.signIn(credentials);
      if (!session) {
        setAuthError(PREVIEW_AUTH_ERROR);
        return;
      }
      startBootstrap(session.redirectTo);
      return;
    }

    if (simulateBootstrapOnSubmit) {
      startBootstrap("/mi-trabajo");
    }
  };

  const handleBootstrapComplete = useCallback(() => {
    setPhase("redirecting");
    window.setTimeout(() => {
      if (pendingRedirect) {
        router.push(pendingRedirect);
      } else {
        setPhase("sign-in");
        setPassword("");
      }
    }, FADE_MS);
  }, [pendingRedirect, router]);

  const isInteractive = phase === "sign-in" && !isSubmitting;
  const showBootstrap = phase === "bootstrap" || phase === "redirecting";
  const contentVisible = phase === "sign-in";

  return (
    <>
      <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
        <a
          href="#os-sign-in-form"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[12px] focus:bg-[var(--os-surface)] focus:px-4 focus:py-2 focus:text-sm"
        >
          Saltar al formulario de ingreso
        </a>

        <OsAuthMockBanner />

        <div
          className={`grid min-h-0 flex-1 transition-opacity duration-300 ease-out md:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] ${
            contentVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Panel izquierdo — branding + credencial + contexto mínimo */}
          <aside className="relative hidden overflow-hidden bg-[var(--os-sidebar-bg)] md:flex md:flex-col">
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
              style={{
                background:
                  "linear-gradient(165deg, rgb(15 23 42) 0%, rgb(15 35 48) 48%, rgb(15 23 42) 100%)",
              }}
            />
            <GenusOsLogo
              className="pointer-events-none absolute -bottom-8 -right-6 size-[min(28rem,55vw)] text-[var(--os-sidebar-text)] opacity-[0.055]"
              decorative
            />

            <div className="relative flex h-full flex-col px-12 py-14 xl:px-16 xl:py-16">
              <GenusOsLogo className="size-12 text-[var(--os-teal)]" />
              <OsInstitutionalCredential />
              <OsOperationalContext />
            </div>
          </aside>

          {/* Formulario */}
          <main
            id="os-sign-in-form"
            className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:px-14 lg:py-12"
          >
            <div className="w-full max-w-[26.5rem] -translate-y-2">
              <div className="mb-8 lg:mb-10">
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-[var(--os-text-muted)]">
                  Vista previa de acceso
                </p>
                <h2 className="mt-3 text-[1.75rem] font-semibold tracking-tight text-[var(--os-text)]">
                  Ingresá al sistema
                </h2>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--os-text-muted)]">
                  Identidad corporativa{" "}
                  <span className="text-[var(--os-text)]">@laboratoriogenus.com.ar</span>
                </p>
              </div>

              <form className="space-y-7" onSubmit={handleSubmit} noValidate>
                <OsAuthField
                  label="Email corporativo"
                  htmlFor="os-sign-in-email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  required
                  placeholder="nombre@laboratoriogenus.com.ar"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setAuthError(null);
                    if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  onBlur={() => {
                    if (email && !isCorporateEmail(email)) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        email: "El formato del email no es válido.",
                      }));
                    }
                  }}
                  disabled={!isInteractive}
                  error={fieldErrors.email}
                  leadingIcon={<Mail className="size-[1.125rem]" aria-hidden="true" />}
                />

                <OsAuthField
                  label="Contraseña"
                  htmlFor="os-sign-in-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setAuthError(null);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  disabled={!isInteractive}
                  error={fieldErrors.password}
                  leadingIcon={<Lock className="size-[1.125rem]" aria-hidden="true" />}
                />

                <div className="border border-[var(--os-border-subtle)] px-4 py-3.5">
                  <label htmlFor={rememberId} className="flex cursor-pointer items-start gap-3">
                    <input
                      id={rememberId}
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      disabled={!isInteractive}
                      className="mt-0.5 size-[1.125rem] rounded border-[var(--os-border)] accent-[var(--os-teal)]"
                    />
                    <span>
                      <span className="block text-sm font-medium text-[var(--os-text)]">
                        Mantenerme conectado
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-[var(--os-text-muted)]">
                        Preferencia persistente en este dispositivo.
                      </span>
                    </span>
                  </label>
                </div>

                {identityForCard && (
                  <OsSignInIdentityCard preview={identityForCard} emailEntered={emailEntered} />
                )}

                {(authError || formError) && (
                  <p
                    role="alert"
                    className="border border-[var(--genus-error)]/15 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]"
                  >
                    {authError ?? formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!isInteractive}
                  className="group flex h-12 w-full items-center justify-center rounded-[12px] bg-[var(--os-teal)] text-[15px] font-semibold text-white transition-colors hover:bg-[var(--os-teal)]/92 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--os-teal)]/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>Ingresar a Genus OS</span>
                  <ArrowRight
                    className="ml-0 size-4 max-w-0 opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[1rem] group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </button>
              </form>

              <p className="mt-10 text-center text-xs text-[var(--os-text-muted)]">
                <a
                  href="mailto:sistemas@laboratoriogenus.com.ar"
                  className="underline-offset-2 hover:text-[var(--os-text)] hover:underline"
                >
                  Contactar Sistemas
                </a>
              </p>
            </div>
          </main>
        </div>

        <OsLoginFooter />
      </div>

      {showBootstrap && (
        <OsSessionBootstrapScreen
          visible={phase !== "redirecting"}
          onComplete={handleBootstrapComplete}
        />
      )}
    </>
  );
}
