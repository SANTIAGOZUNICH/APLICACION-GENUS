"use client";

import { UserRound } from "lucide-react";
import { GENUS_COMPANY_NAME } from "../constants";
import type { OsSignInIdentityPreview } from "../types";

interface OsSignInIdentityCardProps {
  preview: OsSignInIdentityPreview | null;
  emailEntered: boolean;
}

/** Credencial de identidad — sobria, preparada para PR 4.3+. */
export function OsSignInIdentityCard({ preview, emailEntered }: OsSignInIdentityCardProps) {
  const hasPreview = Boolean(
    preview?.displayName || preview?.roleLabel || preview?.sectorLabel || preview?.jobTitle
  );
  const isExpanded = emailEntered || hasPreview;

  if (!isExpanded) return null;

  return (
    <section
      aria-label="Identidad del usuario"
      className="border border-[var(--os-border-subtle)] bg-[var(--os-surface-muted)]/40 px-5 py-4"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--os-text)]">{GENUS_COMPANY_NAME}</p>
        <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-[var(--os-text-muted)]">
          Entidad operativa
        </p>
        <p className="text-[0.6875rem] text-[var(--os-text-muted)]">Ambiente de preview</p>
      </div>

      <div className="mt-4 flex gap-4">
        <div
          className={`flex size-14 shrink-0 items-center justify-center border ${
            hasPreview
              ? "border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-text-muted)]"
              : "border-dashed border-[var(--os-border)] bg-transparent text-[var(--os-text-muted)]"
          }`}
          aria-hidden={!hasPreview}
        >
          {preview?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound className="size-6" />
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <IdentityField label="Nombre completo" value={preview?.displayName} />
          <IdentityField label="Cargo" value={preview?.jobTitle} />
          <IdentityField label="Sector" value={preview?.sectorLabel} />
          <IdentityField label="Rol" value={preview?.roleLabel} />
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
      <p className="text-[0.6875rem] text-[var(--os-text-muted)]">{label}</p>
      <p
        className={`mt-0.5 min-h-[1.125rem] text-sm ${
          value ? "font-medium text-[var(--os-text)]" : "text-[var(--os-text-muted)]"
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}
