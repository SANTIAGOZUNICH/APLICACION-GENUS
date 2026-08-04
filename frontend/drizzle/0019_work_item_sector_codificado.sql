/**
 * Additive: allow CODIFICADO as durable work_item assignee sector.
 * Rollback (manual): cannot easily remove enum values in Postgres.
 */
ALTER TYPE "public"."work_item_sector" ADD VALUE IF NOT EXISTS 'CODIFICADO';
