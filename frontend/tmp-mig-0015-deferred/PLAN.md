# Migración 0015 — Creamy memoria personal/operativa (diferida)

## Qué hace

Migración **aditiva** (`drizzle/0015_creamy_memory.sql`) que crea 6 tablas nuevas,
sin tocar ninguna tabla existente:

- `creamy_conversations` — encabezado de conversación (usuario, sector, estado).
- `creamy_messages` — mensajes de una conversación (FK a `creamy_conversations`).
- `creamy_user_memories` — memoria **personal** de un usuario (aislada por
  `user_email`; nadie más puede leerla ni mutarla).
- `creamy_operational_memories` — memoria **operativa compartida** (hechos tipo
  "en el cliente X, para el producto Y, se usó la MP B en vez de la MP A, por
  motivo Z"). Ciclo de vida `REPORTADA -> VALIDADA | REVOCADA`.
- `creamy_memory_evidence` — evidencia asociada a una memoria operativa (ref. a
  OE/OA, observación, etc.), payload en `jsonb`.
- `creamy_memory_audit_events` — auditoría de creación/validación/revocación/
  corrección/olvido, con actor y detalle en `jsonb`.

Todas las sentencias son `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
EXISTS`. No hay `ALTER` sobre tablas existentes, ni `DROP`, ni `TRUNCATE`.

## Gate de aplicación

Igual que 0005–0014: la migración queda **registrada en el journal** pero el
script `scripts/migrate-if-database.mjs` la **excluye** de la carpeta de
migraciones aplicada salvo que se exporte:

```
APPLY_MIGRATION_0015=1
```

Por defecto (sin la variable) el script sigue funcionando exactamente igual
que antes; 0015 se difiere junto con cualquier otra migración pendiente. No se
cambió ningún valor por defecto para que se aplique automáticamente.

Hasta que se autorice y aplique 0015, Creamy usa `MemoryCreamyMemoryRepository`
(Map en memoria de proceso, singleton a nivel de módulo) desde
`src/lib/creamy-memory/get-creamy-memory-service.ts`. Esto permite demostrar
memoria funcional dentro de una misma instancia "warm" de Preview, pero **no
es durable**: se pierde en cada reinicio/deploy y no se comparte entre
instancias. La durabilidad real llega cuando 0015 se aplique y se conecte el
adaptador Drizzle correspondiente (no incluido en este cambio).

## Rollback manual (solo documentación — NO es un archivo de migración)

Si algún día se aplica 0015 y hay que revertirla manualmente en Neon, el orden
correcto (inverso a la creación, respetando FKs) sería:

```sql
DROP TABLE IF EXISTS "creamy_memory_audit_events";
DROP TABLE IF EXISTS "creamy_memory_evidence";
DROP TABLE IF EXISTS "creamy_operational_memories";
DROP TABLE IF EXISTS "creamy_user_memories";
DROP TABLE IF EXISTS "creamy_messages";
DROP TABLE IF EXISTS "creamy_conversations";
```

Este bloque es **solo documentación operativa**; no existe ni debe agregarse
como archivo de migración de Drizzle.

## Riesgos / notas

- Ninguna columna nueva en tablas existentes; riesgo de bloqueo de escritura
  en tablas grandes es nulo.
- Los índices son `IF NOT EXISTS`; re-ejecutar la migración es seguro (idempotente).
- El único índice único (`creamy_user_memories_email_key_active_uidx`) es
  parcial (`WHERE status = 'active'`), por lo que memorias "olvidadas"
  (`status <> 'active'`) no bloquean volver a aprender el mismo dato.
- No se agregan triggers ni funciones nuevas.
- No requiere cambios en variables de entorno de Vercel ni en el modelo por
  defecto de Creamy (`DEFAULT_GEMINI_MODEL` no se tocó).

## Fórmulas — sin cambios

Esta migración **no** toca `formula_bank`, `formula_bank_versions`, ni ninguna
tabla relacionada con las fórmulas 842/784, ni la migración 0014
(Codificado/Depósito Graneles). El servicio de memoria de Creamy
(`src/lib/creamy-memory/service.ts`) no importa ni escribe en el banco de
fórmulas bajo ninguna circunstancia.
