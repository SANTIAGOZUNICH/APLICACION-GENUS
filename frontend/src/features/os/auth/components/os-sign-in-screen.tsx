"use client";

import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { GENUS_COMPANY_NAME } from "../constants";
import { OsAuthField } from "./os-auth-field";
import { OsAuthMockBanner } from "./os-auth-mock-banner";
import { GenusOsLogo } from "./genus-os-logo";
import { OsPlantContextPanel } from "./os-plant-context-panel";
import { OsSessionBootstrapScreen } from "./os-session-bootstrap-screen";
import { OsSignInIdentityCard } from "./os-sign-in-identity-card";
import type { OsSignInCredentials, OsSignInScreenProps } from "../types";

export type { OsSignInCredentials, OsSignInIdentityPreview, OsSignInScreenProps } from "../types";

type ScreenPhase = "sign-in" | "bootstrap";

function isCorporateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Pantalla premium de ingreso al Manufacturing Operating System — UI Fase 4.1b. */
export function OsSignInScreen({
  onSubmit,
  simulateBootstrapOnSubmit = false,
  isSubmitting = false,
  formError = null,
  identityPreview = null,
}: OsSignInScreenProps) {
  const rememberId = useId();
  const [phase, setPhase] = useState<ScreenPhase>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const emailEntered = email.trim().length > 0;
  const company = identityPreview?.company ?? GENUS_COMPANY_NAME;

  const validate = useCallback(() => {
    const next: { email?: string; password?: string } = {};
    if (!email.trim()) {
      next.email = "Ingresá tu email corporativo.";
    } else if (!isCorporateEmail(email)) {
      next.email = "El formato del email no es válido.";
    }
    if (!password) {
      next.password = "Ingresá tu contraseña.";
    } else if (password.length < 4) {
      next.password = "La contraseña es demasiado corta.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }, [email, password]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    const credentials: OsSignInCredentials = { email, password, rememberMe };

    if (onSubmit) {
      void onSubmit(credentials);
      return;
    }

    if (simulateBootstrapOnSubmit) {
      setPhase("bootstrap");
    }
  };

  const handleBootstrapComplete = useCallback(() => {
    setPhase("sign-in");
    setPassword("");
    setFieldErrors({});
  }, []);

  const identityForCard = useMemo(
    () =>
      identityPreview ?? {
        company,
      },
    [company, identityPreview]
  );

  return (
    <>
      <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
        <a
          href="#os-sign-in-form"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--os-radius-sm)] focus:bg-[var(--os-surface)] focus:px-4 focus:py-2 focus:text-sm focus:shadow-[var(--os-shadow-md)]"
        >
          Saltar al formulario de ingreso
        </a>

        <OsAuthMockBanner />

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          {/* Panel contextual — dark OS shell */}
          <aside className="relative overflow-hidden bg-[var(--os-sidebar-bg)] px-6 py-8 text-[var(--os-sidebar-text)] sm:px-10 lg:px-12 lg:py-12">
            <div
              className="pointer-events-none absolute inset-0 opacity-40"
              aria-hidden="true"
              style={{
                background:
                  "radial-gradient(circle at 20% 20%, rgb(31 163 154 / 0.22), transparent 42%), radial-gradient(circle at 80% 0%, rgb(15 76 92 / 0.35), transparent 36%)",
              }}
            />

            <div className="relative flex h-full flex-col">
              <header className="os-fade-in">
                <div className="flex items-center gap-4">
                  <GenusOsLogo className="size-14 text-[var(--os-teal)]" />
                  <div>
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[var(--os-teal)]">
                      Genus OS
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--os-sidebar-text)] sm:text-[1.75rem]">
                      Manufacturing Operating System
                    </h1>
                  </div>
                </div>

                <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--os-sidebar-muted)]">
                  Sistema operativo para la manufactura cosmética de Laboratorio Genus. Unifica
                  operaciones, sectores y decisiones en una sola experiencia de planta.
                </p>
              </header>

              <div className="mt-8 lg:mt-10">
                <p className="mb-4 text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--os-sidebar-muted)]">
                  Contexto de planta
                </p>
                <OsPlantContextPanel />
              </div>

              <footer className="mt-auto hidden pt-10 text-xs text-[var(--os-sidebar-muted)] lg:block">
                {company} · Planta principal · Acceso corporativo seguro
              </footer>
            </div>
          </aside>

          {/* Formulario — light entry surface */}
          <main
            id="os-sign-in-form"
            className="flex items-center justify-center px-6 py-10 sm:px-10 lg:px-12 lg:py-14"
          >
            <div className="os-fade-in w-full max-w-[28rem]" style={{ animationDelay: "60ms" }}>
              <div className="mb-8 lg:hidden">
                <div className="flex items-center gap-3">
                  <GenusOsLogo className="size-10 text-[var(--os-teal)]" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--os-teal)]">
                      Genus OS
                    </p>
                    <p className="text-sm font-medium text-[var(--os-text)]">
                      Manufacturing Operating System
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-8">
                <h2 className="text-[1.625rem] font-semibold tracking-tight text-[var(--os-text)]">
                  Ingresá al sistema
                </h2>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--os-text-muted)]">
                  Usá tu identidad corporativa{" "}
                  <span className="font-medium text-[var(--os-text)]">@laboratoriogenus.com.ar</span>
                  . Tu sector y rol se derivan automáticamente.
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
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
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
                  disabled={isSubmitting || phase === "bootstrap"}
                  error={fieldErrors.email}
                  hint="Será tu identificador principal en Genus OS."
                  leadingIcon={<Mail className="size-[1.125rem]" aria-hidden="true" />}
                />

                <OsAuthField
                  label="Contraseña"
                  htmlFor="os-sign-in-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  disabled={isSubmitting || phase === "bootstrap"}
                  error={fieldErrors.password}
                  leadingIcon={<Lock className="size-[1.125rem]" aria-hidden="true" />}
                />

                <div className="rounded-[var(--os-radius-sm)] border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)]/70 px-4 py-3.5">
                  <label htmlFor={rememberId} className="flex cursor-pointer items-start gap-3">
                    <input
                      id={rememberId}
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      disabled={isSubmitting || phase === "bootstrap"}
                      className="mt-0.5 size-[1.125rem] rounded border-[var(--os-border)] accent-[var(--os-teal)]"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-[var(--os-text)]">
                        Mantenerme conectado
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--os-text-muted)]">
                        Recordá este dispositivo para agilizar futuros ingresos en planta.
                      </span>
                    </span>
                  </label>
                </div>

                <OsSignInIdentityCard preview={identityForCard} emailEntered={emailEntered} />

                {formError && (
                  <p role="alert" className="rounded-[var(--os-radius-sm)] border border-[var(--genus-error)]/20 bg-[var(--genus-error-soft)] px-4 py-3 text-sm text-[var(--genus-error)]">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || phase === "bootstrap"}
                  className="group flex h-12 w-full items-center justify-center gap-2 rounded-[var(--os-radius-sm)] bg-[var(--os-teal)] text-[15px] font-semibold text-white shadow-[var(--os-shadow-sm)] transition-all hover:bg-[var(--os-teal)]/92 hover:shadow-[var(--os-shadow-card)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--os-teal)]/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Ingresar a Genus OS
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              </form>

              <p className="mt-8 text-center text-xs leading-relaxed text-[var(--os-text-muted)]">
                ¿Problemas para ingresar?{" "}
                <a
                  href="mailto:sistemas@laboratoriogenus.com.ar"
                  className="font-medium text-[var(--os-teal)] underline-offset-2 hover:underline"
                >
                  Contactá a Sistemas
                </a>
              </p>
            </div>
          </main>
        </div>
      </div>

      {phase === "bootstrap" && (
        <OsSessionBootstrapScreen onComplete={handleBootstrapComplete} />
      )}
    </>
  );
}
