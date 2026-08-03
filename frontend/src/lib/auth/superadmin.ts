import "server-only";

import { normalizeEmail } from "@/lib/auth/directory";

/**
 * Superadmin allowlist from GENUS_SUPERADMIN_EMAIL.
 * Supports a single email or comma/semicolon-separated list.
 * Values are never logged.
 */
export function getSuperadminEmails(): string[] {
  const raw = process.env.GENUS_SUPERADMIN_EMAIL ?? "";
  return raw
    .split(/[,;]/)
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

export function isSuperadminEmailConfigured(): boolean {
  return getSuperadminEmails().length > 0;
}

export function isSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  return getSuperadminEmails().includes(normalized);
}

/** Count ACTIVO users whose email is on the superadmin allowlist. */
export function countActiveSuperadmins(
  users: Array<{ id: string; emailNormalized: string; status: string }>,
  options?: { excludeUserId?: string }
): number {
  const allow = new Set(getSuperadminEmails());
  return users.filter((u) => {
    if (options?.excludeUserId && u.id === options.excludeUserId) return false;
    return allow.has(u.emailNormalized) && u.status === "ACTIVO";
  }).length;
}
