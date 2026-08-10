# Migración 0022 en Production — procedimiento exacto

> Estado: **NO ejecutada en Production**. Este entorno de trabajo solo tiene
> credenciales de Preview (`.env.preview.db.local`) — Production es un
> proyecto Neon separado y aislado (confirmado en la auditoría del
> 2026-08-08: `ep-patient-mountain-***`, creado 2026-08-02). No hay forma de
> correr el diagnóstico ni la migración contra Production desde acá.
>
> Diagnóstico ya corrido y confirmado seguro contra **Preview**: 0 grupos de
> código duplicado (`scripts/_audit_me_codigo_duplicates.mjs`).

## Qué hace la migración 0022

`drizzle/0022_me_materials_codigo_unique.sql` crea un índice único parcial
sobre el código normalizado (`upper(trim(...))`) de materiales ME
**activos** (`payload->>'archived' != 'true'`). Es aditiva — no borra ni
modifica filas — pero **puede fallar** si existen hoy en Production dos o
más materiales activos cuyo código normalizado coincide (el bug histórico
de agrupación por nombre que motivó este trabajo).

## Procedimiento para quien tenga acceso a Production

1. **Diagnóstico (solo lectura, no modifica nada):**

   ```bash
   DATABASE_URL="<connection string de Production>" \
     node scripts/_audit_me_codigo_duplicates.mjs
   ```

   Salida esperada si es seguro aplicar:
   ```json
   { "duplicateGroups": 0, "safeToApply0022": true, "groups": [] }
   ```

   Si `duplicateGroups > 0`, el script imprime cada grupo (código
   normalizado + ids de las filas en conflicto) y termina con exit code 2.
   **No seguir al paso 2 hasta reconciliar esos grupos.**

2. **Si hay duplicados — reconciliar antes de aplicar el índice:**

   ```bash
   # Dry-run primero (no escribe nada, solo informa qué haría):
   DATABASE_URL="<connection string de Production>" \
     node --import tsx scripts/_repair_me_inventario_by_codigo.mjs --dry-run

   # Revisar el reporte. Si el resultado es el esperado:
   DATABASE_URL="<connection string de Production>" \
     node --import tsx scripts/_repair_me_inventario_by_codigo.mjs --apply
   ```

   Este script reconcilia por código (nunca por nombre), es idempotente y
   no borra movimientos ni auditoría — solo consolida el stock agrupado
   correctamente. Volver a correr el diagnóstico del paso 1 hasta obtener
   `safeToApply0022: true`.

3. **Aplicar la migración 0022 (una sola vez, con el gate explícito):**

   ```bash
   DATABASE_URL="<connection string de Production>" \
     DATABASE_URL_UNPOOLED="<connection string directa de Production>" \
     APPLY_MIGRATION_0022=1 \
     node scripts/migrate-if-database.mjs
   ```

   Sin `APPLY_MIGRATION_0022=1` la migración queda diferida automáticamente
   (ver comentario en `scripts/migrate-if-database.mjs`) — no se aplica por
   accidente en un build normal.

4. **Verificar:**

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'inv_me_materials'
     AND indexname = 'inv_me_materials_codigo_norm_active_uidx';
   ```

   Debe devolver una fila. Volver a correr el diagnóstico del paso 1 una
   vez más — debe seguir dando `duplicateGroups: 0` (ahora garantizado por
   el índice, no solo por el estado de los datos).

## Por qué no lo hice yo

No tengo credenciales de Production en este entorno (solo Preview). Aplicar
una migración de esquema contra Production sin haber corrido el
diagnóstico ahí mismo violaría la regla explícita del usuario ("no
modificar datos productivos" / "no ejecutarla en Production sin
diagnóstico"). El script y el procedimiento quedan listos para que alguien
con acceso lo ejecute cuando corresponda.
