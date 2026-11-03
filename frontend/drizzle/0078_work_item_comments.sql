-- genus:reconcile-safe
-- Migración 0078 — Comentarios del equipo por trabajo (Vista mensual). ADITIVA / IDEMPOTENTE.
-- Tabla NUEVA: un comentario inmutable por fila, vinculado al id estable del trabajo (work_items.id), no a producto ni fecha.
-- No toca planificación, cantidades, stock ni entregas. Las observaciones originales (work_items.notes) no se copian ni se modifican.
CREATE TABLE IF NOT EXISTS "work_item_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  -- Identidad tomada de la SESIÓN en el servidor (nunca del cuerpo de la petición).
  "author_email" text NOT NULL,
  "author_name" text NOT NULL,
  "author_sector" text NOT NULL,
  "author_sector_label" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- Clave generada por el cliente al abrir el formulario: reintentos / doble clic no duplican el comentario.
  "client_request_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_comments_idem_uq" ON "work_item_comments" ("work_item_id", "author_email", "client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_item_comments_item_idx" ON "work_item_comments" ("work_item_id", "created_at");
