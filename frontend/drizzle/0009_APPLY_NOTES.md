# Migración 0009 — Procedimientos + Métricas

## Gate de aplicación

**NO aplicar** hasta autorización explícita con `APPLY_MIGRATION_0009=1`.

## Tablas nuevas

| Tabla | Propósito |
|-------|-----------|
| `procedure_folders` | Árbol de carpetas de procedimientos |
| `procedure_files` | Metadatos de archivos por carpeta |
| `procedure_file_versions` | Versiones con blob privado (Vercel Blob) |
| `packaging_metrics` | Unidades envasadas por sector/fecha/responsable |
| `procedure_audit_events` | Auditoría de acciones en procedimientos |

## Columnas clave

- **procedure_folders**: `id`, `parent_id`, `name`, `relative_path`, `status` (active/archived/deleted), actor fields, timestamps
- **procedure_files**: `folder_id`, `display_name`, `relative_path`, `mime`, `size_bytes`, `sha256`, `current_version`, `status`
- **procedure_file_versions**: `file_id`, `version`, `storage_provider`, `storage_key`, nombres, `sha256`, `change_reason`, `is_current`
- **packaging_metrics**: `sector` (ENVASADO_MASIVO|ENVASADO_PREMIUM), `metric_date`, `product`, `units`, `responsible_display`, `responsible_key`, `work_item_id`
- **procedure_audit_events**: `actor_email`, `actor_sector`, `action`, `entity_type`, `entity_id`, `detail` (jsonb)

## Índices

- `procedure_folders_parent_idx` — parent_id
- `procedure_folders_parent_name_idx` — parent_id + name
- `procedure_files_folder_name_idx` — folder_id + display_name
- `procedure_file_versions_file_version_idx` — file_id + version (UNIQUE)
- `packaging_metrics_sector_date_responsible_idx` — sector + metric_date + responsible_key
- `procedure_audit_events_entity_idx`, `procedure_audit_events_created_at_idx`

## Impacto en 0001–0008

**Ninguno.** Solo crea tablas nuevas con `CREATE TABLE IF NOT EXISTS`. No altera tablas existentes. Sin DROP ni TRUNCATE.

## Rollback plan

1. Verificar que no hay dependencias activas en la app.
2. Eliminar blobs huérfanos en Vercel Blob (prefijo `procedimientos/`).
3. Ejecutar en orden inverso de FKs:
   ```sql
   DROP TABLE IF EXISTS procedure_audit_events;
   DROP TABLE IF EXISTS procedure_file_versions;
   DROP TABLE IF EXISTS procedure_files;
   DROP TABLE IF EXISTS procedure_folders;
   DROP TABLE IF EXISTS packaging_metrics;
   ```
4. Remover gate en código o redeploy sin features 0009.

## Schema gate en app

`frontend/src/lib/db/procedure-metrics-schema.ts` sonda `procedure_folders` y `packaging_metrics`. Sin tablas: banner "Base de datos pendiente de actualización" y escrituras deshabilitadas.
