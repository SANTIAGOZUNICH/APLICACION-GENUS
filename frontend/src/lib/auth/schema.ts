import "server-only";

import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Definiciones Drizzle para las tablas creadas por la migración 0016
 * (drizzle/0016_genus_auth.sql). Aisladas de src/lib/db/schema.ts a
 * propósito: 0016 queda diferida (APPLY_MIGRATION_0016=1) y este módulo
 * solo se usa cuando GENUS_AUTH_BACKEND=neon.
 */
export const genusAuthUsers = pgTable("genus_auth_users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  emailNormalized: text("email_normalized").notNull(),
  displayName: text("display_name").notNull(),
  sector: text("sector").notNull(),
  roleId: text("role_id").notNull(),
  roleLabel: text("role_label").notNull(),
  sectorLabel: text("sector_label").notNull(),
  jobTitle: text("job_title").notNull(),
  status: text("status").notNull(),
  passwordHash: text("password_hash").notNull(),
  redirectTo: text("redirect_to").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const genusAuthSessions = pgTable("genus_auth_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
});

export const genusAuthAuditEvents = pgTable("genus_auth_audit_events", {
  id: uuid("id").primaryKey(),
  eventType: text("event_type").notNull(),
  emailNormalized: text("email_normalized"),
  userId: uuid("user_id"),
  detail: jsonb("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export type GenusAuthUserRow = typeof genusAuthUsers.$inferSelect;
export type GenusAuthSessionRow = typeof genusAuthSessions.$inferSelect;
export type GenusAuthAuditEventRow = typeof genusAuthAuditEvents.$inferSelect;
