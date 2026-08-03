# Órdenes OE/OA nativas (PR #60)

## Arquitectura

- **UI**: listados OE/OA con tabs Pendientes/Completas, buscador/filtros, CTA crear, editor web + vista legal A4.
- **API**: `/api/v1/orders`, `/api/v1/order-templates`, `/api/v1/notifications`, PDF en `/api/v1/orders/[id]/pdf`.
- **Dominio**: `frontend/src/lib/orders/*` (RBAC, service, validators, content, seed).
- **Persistencia**: Neon Postgres + Drizzle (migración `0001_operational_orders`).
- **Histórico**: uploads previos quedan en “Documentos anteriores” (localStorage, no legal).

## Variables de entorno

| Variable | Uso |
|---|---|
| `DATABASE_URL` | Neon pooled — requerido para órdenes legales |
| `DATABASE_URL_UNPOOLED` | Migraciones |
| `POSTGRES_URL` | Alias aceptado |

Sin DB: APIs responden `503 DATABASE_UNAVAILABLE` y la UI muestra banner **no legalmente operativo**. No se usa localStorage para órdenes nuevas.

## Migraciones

```bash
cd frontend && node scripts/migrate-if-database.mjs
```

Tablas: `order_templates`, `operational_orders`, `order_versions`, `template_change_proposals`, `order_audit_events`, `order_number_sequences`, `os_notifications`.

## Permisos (resumen)

- Crear: CALIDAD, PRODUCCION (+ DIRECCION).
- Editar/entregar OE: ELABORACION.
- Editar/entregar OA: ENVASADO_MASIVO / ENVASADO_PREMIUM (solo asignadas).
- Codificado: solo campos de etiquetado/codificado.
- Guardar como maestra: CALIDAD/PRODUCCION; operativos proponen.
- Firmas: siempre vacías (físicas post-impresión).

## Qué falta para considerarlo legalmente operativo

1. `DATABASE_URL` en Preview/Prod + backups Neon.
2. Migración `0001` aplicada.
3. Comparación humana PDF vs Excel/Word de cada producto.
4. Logo oficial embebido (hoy texto “Laboratorio Genus”).
5. Política de retención/auditoría firmada por Dirección Técnica.
