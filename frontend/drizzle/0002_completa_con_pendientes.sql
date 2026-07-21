-- Add incomplete-deliver status for OE/OA legal orders.
DO $$ BEGIN
  ALTER TYPE "operational_order_status" ADD VALUE 'COMPLETA_CON_PENDIENTES';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
