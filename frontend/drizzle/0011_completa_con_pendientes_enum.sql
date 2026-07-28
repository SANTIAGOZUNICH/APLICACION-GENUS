/**
 * Migración 0011 — Enum COMPLETA_CON_PENDIENTES (aditiva).
 *
 * Contexto: el valor ya está en TypeScript/schema (`operational_order_status`)
 * y en `0002_completa_con_pendientes.sql`, pero 0002 NUNCA entró al journal
 * (salta 0001 → 0003). En Preview Neon el enum no tiene el valor → deliver
 * incompleto falla con 500 al intentar setear COMPLETA_CON_PENDIENTES.
 *
 * NO APLICAR hasta autorización explícita: APPLY_MIGRATION_0011=1
 * Idempotente (duplicate_object → null). Sin DROP/TRUNCATE.
 *
 * Rollback (manual, solo si se aplicó): no se puede quitar un valor de enum
 * Postgres fácilmente; no revertir en caliente.
 */

DO $$ BEGIN
  ALTER TYPE "operational_order_status" ADD VALUE 'COMPLETA_CON_PENDIENTES';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
