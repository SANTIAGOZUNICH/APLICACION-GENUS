-- Inventario ME / MP (Neon) — tablas vacías; sin datos históricos.
CREATE TABLE IF NOT EXISTS "inv_me_ingresos" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_me_salidas" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_me_materials" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_me_alerts" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_me_alert_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "alert_id" uuid NOT NULL,
  "actor_email" text NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inv_me_alert_reads_alert_email_uidx"
  ON "inv_me_alert_reads" ("alert_id", "actor_email");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_mp_stock" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_mp_ingresos" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_mp_control" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_mp_compras" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_ajustes" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inv_audit" (
  "id" uuid PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
