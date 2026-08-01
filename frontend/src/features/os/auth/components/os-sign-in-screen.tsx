"use client";

import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { GENUS_COMPANY_NAME } from "../constants";
import {
  findMockUserByEmail,
  PREVIEW_AUTH_ERROR,
  type PreviewDirectoryUser,
} from "../lib/mock-preview-users";
import { AuthAdapterError, genusAuthAdapter } from "../adapters/genus-auth-adapter";
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

function toIdentityPreview(user: PreviewDirectoryUser): OsSignInIdentityPreview {
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
  const [showPassword, setShowPassword] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const submitting = isSubmitting || localSubmitting;

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
      if (localSubmitting) return;
      setLocalSubmitting(true);
      try {
        const session = await genusAuthAdapter.signIn(credentials);
        if (!session) {
          setAuthError(PREVIEW_AUTH_ERROR);
          return;
        }
        startBootstrap(session.redirectTo);
      } catch (error) {
        setAuthError(error instanceof AuthAdapterError ? error.message : PREVIEW_AUTH_ERROR);
      } finally {
        setLocalSubmitting(false);
      }
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

  const isInteractive = phase === "sign-in" && !submitting;
  const showBootstrap = phase === "bootstrap" || phase === "redirecting";
  const contentVisible = phase === "sign-in";

  return (
    <>
      <div className="os-login-scene relative flex min-h-dvh flex-col">
        <a
          href="#os-sign-in-form"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--os-radius-sm)] focus:bg-[var(--os-surface)] focus:px-4 focus:py-2 focus:text-sm"
        >
          Saltar al formulario de ingreso
        </a>

        <div className="relative z-[1]">
          <OsAuthMockBanner />
        </div>

        <div
          className={`relative z-[1] grid min-h-0 flex-1 transition-opacity duration-300 ease-out md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] ${
            contentVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* Panel institucional — desktop */}
          <aside className="relative hidden overflow-hidden md:flex md:flex-col">
            <GenusOsLogo
              className="pointer-events-none absolute -bottom-10 -right-8 size-[min(32rem,58vw)] text-white opacity-[0.05]"
              decorative
            />

            <div className="relative flex h-full flex-col px-12 py-14 xl:px-16 xl:py-16">
              <GenusOsLogo className="size-12 text-[var(--os-teal-glow)] drop-shadow-[0_0_18px_rgb(18_191_183_/_0.35)]" />
              <h1 className="mt-10 max-w-md text-[1.75rem] font-semibold leading-tight tracking-tight text-[var(--os-sidebar-text)] xl:text-[2rem]">
                El laboratorio, organizado en un solo lugar.
              </h1>
              <p className="mt-4 max-w-sm text-[0.9375rem] leading-relaxed text-[var(--os-sidebar-muted)]">
                Producción, elaboración, envasado, calidad y materias primas trabajando con la
                misma información.
              </p>
              <OsInstitutionalCredential />
              <OsOperationalContext />
            </div>
          </aside>

          {/* Formulario — protagonista en móvil */}
          <main
            id="os-sign-in-form"
            className="relative flex min-w-0 max-w-full flex-1 flex-col items-center justify-center overflow-x-clip px-5 py-8 sm:px-10 lg:px-14 lg:py-12"
          >
            <div className="mb-6 flex w-full max-w-[26.5rem] items-center gap-3 md:hidden">
              <GenusOsLogo className="size-9 text-[var(--os-teal-glow)]" />
              <div>
                <p className="text-sm font-semibold text-white">Genus OS</p>
                <p className="text-[0.6875rem] text-white/65">Manufacturing Operating System</p>
              </div>
            </div>

            <div className="os-login-form-panel w-full max-w-[26.5rem] rounded-[var(--os-radius)] px-6 py-8 sm:px-8 sm:py-9">
              <div className="mb-7 lg:mb-8">
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-[var(--os-text-muted)]">
                  Vista previa de acceso
                </p>
                <h2 className="mt-3 text-[1.625rem] font-semibold tracking-tight text-[var(--os-text)] sm:text-[1.75rem]">
                  Ingresá al sistema
                </h2>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--os-text-muted)]">
                  Identidad corporativa{" "}
                  <span className="text-[var(--os-text)]">@laboratoriogenus.com.ar</span>
                </p>
              </div>

              <form className="space-y-6" onSubmit={handleSubmit} noValidate>
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
                  type={showPassword ? "text" : "password"}
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
                  trailingAction={
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={!isInteractive}
                      className="pointer-events-auto rounded p-1 text-[var(--os-text-muted)] transition-colors hover:text-[var(--os-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]/40"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <EyeOff className="size-[1.125rem]" aria-hidden="true" />
                      ) : (
                        <Eye className="size-[1.125rem]" aria-hidden="true" />
                      )}
                    </button>
                  }
                />

                <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border)] bg-[var(--os-surface-muted)]/50 px-4 py-3.5">
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
                    className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/15 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]"
                  >
                    {authError ?? formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!isInteractive}
                  className="os-btn-motion group flex h-12 w-full items-center justify-center rounded-[var(--os-radius-sm)] bg-[var(--os-action)] text-[15px] font-semibold text-white shadow-[var(--os-shadow-sm)] hover:bg-[var(--os-action)]/92 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--os-action)]/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>Ingresar a Genus OS</span>
                  <ArrowRight
                    className="ml-0 size-4 max-w-0 opacity-0 transition-all duration-200 group-hover:ml-2 group-hover:max-w-[1rem] group-hover:opacity-100 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </button>
              </form>

              <p className="mt-8 text-center text-xs text-[var(--os-text-muted)]">
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

        <div className="relative z-[1]">
          <OsLoginFooter />
        </div>
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
