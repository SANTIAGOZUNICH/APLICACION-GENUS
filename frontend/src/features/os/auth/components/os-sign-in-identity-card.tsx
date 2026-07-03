"use client";

import { UserRound } from "lucide-react";
import type { OsSignInIdentityPreview } from "../types";

interface OsSignInIdentityCardProps {
  preview: OsSignInIdentityPreview | null;
  emailEntered: boolean;
}

/** Tarjeta de identidad — preparada para foto, cargo y sector (PR 4.3+). */
export function OsSignInIdentityCard({ preview, emailEntered }: OsSignInIdentityCardProps) {
  const hasPreview = Boolean(
    preview?.displayName || preview?.roleLabel || preview?.sectorLabel || preview?.jobTitle
  );
  const isExpanded = emailEntered || hasPreview;

  return (
    <section
      aria-label="Identidad del usuario"
      className={`overflow-hidden rounded-[var(--os-radius)] border transition-all duration-300 ease-out ${
        isExpanded
          ? "border-[var(--os-border)] bg-[var(--os-surface)] shadow-[var(--os-shadow-card)]"
          : "border-dashed border-[var(--os-border)] bg-[var(--os-surface-muted)]/60"
      }`}
    >
      <div className="border-b border-[var(--os-border-subtle)] px-5 py-3">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--os-text-muted)]">
          Identidad en Genus OS
        </p>
        <p className="mt-1 text-xs text-[var(--os-text-muted)]">
          {isExpanded
            ? "Tu perfil se completa al reconocer tu email corporativo."
            : "Ingresá tu email para reservar tu contexto operativo."}
        </p>
      </div>

      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div
          className={`flex size-16 shrink-0 items-center justify-center rounded-[var(--os-radius)] border ${
            hasPreview && preview?.displayName
              ? "border-[var(--os-teal)]/30 bg-[var(--os-teal-soft)] text-[var(--os-teal)]"
              : "border-[var(--os-border)] bg-[var(--os-surface-muted)] text-[var(--os-text-muted)]"
          }`}
          aria-hidden={!hasPreview}
        >
          {preview?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- placeholder avatar URL futura
            <img
              src={preview.avatarUrl}
              alt=""
              className="size-full rounded-[var(--os-radius)] object-cover"
            />
          ) : (
            <UserRound className="size-7" />
          )}
        </div>

        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <IdentityField label="Nombre completo" value={preview?.displayName} />
          <IdentityField label="Cargo" value={preview?.jobTitle} />
          <IdentityField label="Sector" value={preview?.sectorLabel} />
          <IdentityField label="Rol" value={preview?.roleLabel} />
          <IdentityField
            label="Empresa"
            value={preview?.company}
            className="sm:col-span-2"
          />
        </div>
      </div>
    </section>
  );
}

function IdentityField({
  label,
  value,
  className = "",
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--os-text-muted)]">
        {label}
      </p>
      <p
        className={`mt-1 min-h-[1.25rem] text-sm ${
          value ? "font-medium text-[var(--os-text)]" : "text-[var(--os-text-muted)]"
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}
