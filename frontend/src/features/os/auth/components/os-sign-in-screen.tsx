"use client";

import { useState, type FormEvent } from "react";
import { Building2, Loader2, Lock, Mail, Shield } from "lucide-react";
import { GENUS_COMPANY_NAME } from "../constants";
import { OsAuthMockBanner } from "./os-auth-mock-banner";

const inputClassName =
  "h-11 w-full rounded-[var(--os-radius)] border border-[var(--os-border)] bg-[var(--os-surface)] px-3.5 text-sm text-[var(--os-text)] transition-colors placeholder:text-[var(--os-text-muted)] focus-visible:border-[var(--os-teal)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--os-teal)]/20 disabled:cursor-not-allowed disabled:opacity-60";

const readOnlyClassName =
  "h-11 w-full rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)] px-3.5 text-sm text-[var(--os-text-muted)]";

export interface OsSignInIdentityPreview {
  displayName?: string;
  sectorLabel?: string;
  roleLabel?: string;
  company?: string;
}

export interface OsSignInCredentials {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface OsSignInScreenProps {
  onSubmit?: (credentials: OsSignInCredentials) => void | Promise<void>;
  isSubmitting?: boolean;
  formError?: string | null;
  identityPreview?: OsSignInIdentityPreview | null;
}

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]"
    >
      {children}
      {required && (
        <span className="ml-0.5 text-[var(--os-teal)]" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
}

/** Pantalla enterprise de ingreso — identidad Fase 4 (UI; auth en PRs siguientes). */
export function OsSignInScreen({
  onSubmit,
  isSubmitting = false,
  formError = null,
  identityPreview = null,
}: OsSignInScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const company = identityPreview?.company ?? GENUS_COMPANY_NAME;
  const hasIdentity = Boolean(
    identityPreview?.displayName || identityPreview?.sectorLabel || identityPreview?.roleLabel
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit?.({ email, password, rememberMe });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--os-bg)]">
      <OsAuthMockBanner />

      <div className="flex flex-1 flex-col lg:flex-row">
        <aside className="flex flex-col justify-between border-b border-[var(--os-border)] bg-[var(--os-surface)] px-8 py-10 lg:w-[42%] lg:border-b-0 lg:border-r lg:px-12 lg:py-16">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-[var(--os-radius)] bg-[var(--os-teal-soft)]">
                <Shield className="size-5 text-[var(--os-teal)]" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-teal)]">
                  Genus OS
                </p>
                <p className="text-sm text-[var(--os-text-muted)]">Manufacturing Operating System</p>
              </div>
            </div>

            <h1 className="mt-10 text-3xl font-semibold tracking-tight text-[var(--os-text)] lg:text-4xl">
              Ingresá a tu puesto de trabajo
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--os-text-muted)]">
              Acceso corporativo para operarios, supervisores y dirección. Tu sector y rol se
              derivan de tu identidad — no necesitás elegirlos manualmente.
            </p>
          </div>

          <div className="mt-10 flex items-center gap-2 text-sm text-[var(--os-text-muted)] lg:mt-0">
            <Building2 className="size-4 shrink-0" aria-hidden="true" />
            <span>{company}</span>
          </div>
        </aside>

        <main className="flex flex-1 items-center justify-center px-6 py-10 lg:px-12 lg:py-16">
          <div className="w-full max-w-md os-fade-in">
            <h2 className="text-xl font-semibold tracking-tight text-[var(--os-text)]">
              Inicio de sesión
            </h2>
            <p className="mt-2 text-sm text-[var(--os-text-muted)]">
              Usá tu email corporativo <span className="font-medium">@laboratoriogenus.com.ar</span>
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
              <div>
                <FieldLabel htmlFor="os-sign-in-email" required>
                  Email corporativo
                </FieldLabel>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--os-text-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    id="os-sign-in-email"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={isSubmitting}
                    className={`${inputClassName} pl-10`}
                    placeholder="nombre@laboratoriogenus.com.ar"
                  />
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="os-sign-in-password" required>
                  Contraseña
                </FieldLabel>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--os-text-muted)]"
                    aria-hidden="true"
                  />
                  <input
                    id="os-sign-in-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={isSubmitting}
                    className={`${inputClassName} pl-10`}
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--os-text-muted)]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={isSubmitting}
                  className="size-4 rounded border-[var(--os-border)] accent-[var(--os-teal)]"
                />
                Mantenerme conectado
              </label>

              <div className="space-y-4 rounded-[var(--os-radius)] border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)]/50 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                  Tu identidad en el sistema
                </p>
                <div>
                  <FieldLabel htmlFor="os-sign-in-name">Nombre completo</FieldLabel>
                  <input
                    id="os-sign-in-name"
                    type="text"
                    readOnly
                    tabIndex={-1}
                    value={identityPreview?.displayName ?? ""}
                    placeholder={hasIdentity ? undefined : "Se completa al validar tu email"}
                    className={readOnlyClassName}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="os-sign-in-sector">Sector</FieldLabel>
                    <input
                      id="os-sign-in-sector"
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={identityPreview?.sectorLabel ?? ""}
                      placeholder={hasIdentity ? undefined : "Derivado automáticamente"}
                      className={readOnlyClassName}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="os-sign-in-role">Rol</FieldLabel>
                    <input
                      id="os-sign-in-role"
                      type="text"
                      readOnly
                      tabIndex={-1}
                      value={identityPreview?.roleLabel ?? ""}
                      placeholder={hasIdentity ? undefined : "Derivado automáticamente"}
                      className={readOnlyClassName}
                    />
                  </div>
                </div>
              </div>

              {formError && (
                <p role="alert" className="text-sm text-red-600">
                  {formError}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--os-radius)] bg-[var(--os-teal)] text-sm font-semibold text-white transition-colors hover:bg-[var(--os-teal)]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Ingresando…
                  </>
                ) : (
                  "Ingresar"
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-xs text-[var(--os-text-muted)]">
              ¿Problemas para ingresar? Contactá a sistemas@laboratoriogenus.com.ar
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
