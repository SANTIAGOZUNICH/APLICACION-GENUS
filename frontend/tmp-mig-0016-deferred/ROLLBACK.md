# Rollback — Migración 0016 (Genus Auth)

La migración 0016 es puramente aditiva (`CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, sin `DROP`/`TRUNCATE`, sin tocar tablas
existentes). No hay riesgo de pérdida de datos de otros módulos al
aplicarla ni al revertirla.

## Si aún NO se aplicó (estado actual)

No hay nada que revertir: las tablas no existen. Basta con no setear
`APPLY_MIGRATION_0016=1`.

## Si se aplicó y hay que revertir

Ejecutar en orden inverso a las FKs (sesiones referencian usuarios):

```sql
DROP TABLE IF EXISTS "genus_auth_audit_events";
DROP TABLE IF EXISTS "genus_auth_sessions";
DROP TABLE IF EXISTS "genus_auth_users";
```

Pasos recomendados:

1. Setear `GENUS_AUTH_BACKEND` a cualquier valor distinto de `neon` (o
   eliminar la variable) para que `src/lib/auth/get-auth-service.ts`
   vuelva a usar `MemoryAuthRepository` de inmediato — así el login deja
   de depender de las tablas antes de borrarlas.
2. Confirmar que no hay sesiones activas críticas (`genus_auth_sessions`
   con `expires_at > now()` y `revoked_at is null`); si las hay, los
   usuarios simplemente deberán volver a loguearse (no es destructivo
   para otros datos operativos).
3. Ejecutar los `DROP TABLE IF EXISTS` de arriba.
4. Quitar `APPLY_MIGRATION_0016=1` del entorno para que
   `scripts/migrate-if-database.mjs` vuelva a diferir 0016 en futuros
   builds (evita que el migrator intente recrearla contra un journal que
   ya la marcó como aplicada — si eso ocurre, hay que además borrar la
   fila correspondiente de la tabla interna de Drizzle
   `drizzle.__drizzle_migrations` para el tag `0016_genus_auth`).

## Notas

- Ningún dato de `formula_bank`, órdenes (OE/OA), planificación,
  inventario, Creamy (0015) ni Codificado/Depósito (0014) es afectado por
  aplicar o revertir 0016: son tablas nuevas e independientes.
