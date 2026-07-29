# Migración 0014 — Codificado + Depósito Graneles

**Estado:** CREADA Y DIFERIDA — **NO APLICAR** sin autorización (`APPLY_MIGRATION_0014=1`).

## Baseline Preview actual
- Migraciones registradas: **13** (última aplicada: `0013_notification_user_deletes`)
- Fórmulas: **842 / 784** (no tocar)
- Host Preview: `ep-polished-recipe-*`
- Production: **no involucrada**

## SQL exacto
Archivo: `drizzle/0014_codificado_deposito_graneles.sql`

## Tablas / columnas
### `work_items` (ADD COLUMN IF NOT EXISTS)
- `packaging_total_units` numeric
- `sent_to_codificado_at` timestamptz
- `sent_to_codificado_by` text
- `codificado_origin_sector` text
- `via_codificado` boolean default false
- `delivered_from_codificado_at` timestamptz
- `codificado_observation` text
- `bulk_remainder_kg` numeric
- `bulk_remainder_id` text

### `deposito_graneles` (CREATE IF NOT EXISTS)
- id, work_item_id, origin_sector, product, client, bulk_lot, kg_available, intake_date, reported_by, observation, location, status, timestamps, annul fields
- Unique parcial: un sobrante activo por `work_item_id`

### `deposito_graneles_audit`
- Auditoría create/update/delta/annul/delete

## Compatibilidad
- Aditiva; filas existentes siguen válidas
- Runtime Preview actual usa **localStorage** (`genus_os_work_progress`, `genus_os_deposito_graneles`) hasta aplicar Neon
- No toca remitos históricos ni fórmulas

## Conteos incompatibles esperados
- 0 (solo columnas nuevas / tablas nuevas)

## Plan live dry-run
1. Conectar Preview Neon read-only y contar `work_items`, `formula_versions`
2. `BEGIN;` aplicar SQL; `SELECT` columnas/tablas; `ROLLBACK;`
3. Confirmar fórmulas 842/784 intactas

## Rollback
- `DROP TABLE IF EXISTS deposito_graneles_audit;`
- `DROP TABLE IF EXISTS deposito_graneles;`
- `ALTER TABLE work_items DROP COLUMN IF EXISTS …` (solo columnas 0014)
- Preferible no rollback en Preview si ya hay datos de smoke; anular filas TEST_

## Gate
```
APPLY_MIGRATION_0014=1 node scripts/_apply_preview_0014_once.mjs  # (aún no creado hasta autorización)
```
