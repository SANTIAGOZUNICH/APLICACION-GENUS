# 36 · Entregas y Creamy flotante

**Rama:** `claude/genus-os-operational-ui`  
**Estado:** Beta Preview

## Creamy FAB global y conversación compartida

- `CreamyChatProvider` envuelve la app OS (`OsAppRoot`) y mantiene **una sola conversación** por pestaña del navegador.
- `CreamyCompanion` renderiza el **FAB flotante** y el panel (abierto, minimizado o cerrado) en todas las vistas operativas.
- El historial y el estado del panel persisten en `sessionStorage`:
  - `genus_os_creamy_chat` — últimos 40 mensajes.
  - `genus_os_creamy_panel_open` / `genus_os_creamy_panel_minimized` — modo del panel.
- `resetConversation` restaura el mensaje de bienvenida sin cerrar el panel.

Creamy es **solo lectura**: consulta un snapshot local filtrado por sector; no confirma entregas ni muta datos operativos.

## Flujo de entrega FINALIZADO → APROBADO → ENTREGADO

1. **FINALIZADO** — el sector productivo completa el trabajo (`complete_work` / estado `revision` en overlay).
2. **APROBADO** — Calidad decide (`quality_decision` con `actorSectorId: CALIDAD`).
3. **ENTREGADO** — Producción confirma la entrega desde **Entregados → Pendientes de entrega** (`deliver_work`).

La vista **Entregados** agrupa:

- **Entregados** — registros activos (`status: ENTREGADO`, no archivados).
- **Archivados** — entregas históricas archivadas por Producción.
- **Pendientes de entrega** — trabajos aprobados por Calidad que aún no tienen registro de entrega.

## Live Sync — acciones de entrega

Endpoint: `POST /api/v1/live-sync/operations` (requiere modo real + Drive adapter).

| Acción | Quién | Efecto |
|---|---|---|
| `deliver_work` | PRODUCCION | Crea o reutiliza entrega por `workItemId` (idempotente). Marca trabajo `entregado`. |
| `archive_delivery` | PRODUCCION | Mueve entrega activa a archivados (sigue en storage, `archived: true`). |
| `restore_delivery` | PRODUCCION | Devuelve entrega archivada a la bandeja activa. |
| `annul_delivery` | PRODUCCION | Anula entrega activa; el trabajo vuelve a pendiente de entrega. Requiere motivo. |
| `delete_delivery_record` | PRODUCCION | Eliminación definitiva **solo si estaba archivada**. Requiere motivo. |

Todas validan `actorSectorId` con `validateDeliveryMutationActor` (importado desde `delivery-rbac` en la route).

## Limitación de `actorSectorId`

- El cliente envía `actorSectorId`; el servidor **no** verifica identidad autenticada.
- Solo se comprueba que el valor sea exactamente `PRODUCCION` para mutaciones de entrega.
- Ausente o distinto de PRODUCCION → **403** (`DELIVERY_MUTATION_MISSING_ACTOR` o `DELIVERY_MUTATION_FORBIDDEN`).
- Esto **no reemplaza** RBAC server-side real (ver doc 29 Identity Access).

## Archivar vs eliminar definitivamente

| Operación | Registro operativo | Archivos adjuntos (localStorage) | Auditoría |
|---|---|---|---|
| **Archivar** | Permanece; deja de verse en Entregados activos | Se conservan | No genera stub |
| **Eliminar definitivo** | Se quita del listado activo/archivado | **No se borran del disco local** | Stub `REGISTRO_ELIMINADO` |

## Qué se elimina realmente vs stub `REGISTRO_ELIMINADO`

- **Eliminación definitiva** (`delete_delivery_record`):
  - Quita el `DeliveryRecord` del almacenamiento operativo (`genus_os_deliveries` en localStorage / overlay server-side).
  - Deja una **huella de auditoría** (`DeliveryAuditStub`) con `status: REGISTRO_ELIMINADO`, motivo, fecha y hash de referencia.
  - Creamy y las bandejas activas **no** muestran ese registro.
- **Anular** (`annul_delivery`) no es eliminación: cambia `status` a `ANULADO` y libera el `workItemId` para una nueva entrega futura.

## Archivos adjuntos — solo localStorage

- Los documentos de entrega (remitos, fotos, etc.) se guardan en **localStorage del navegador** (`delivery-files-dialog`).
- Archivar o eliminar un registro de entrega **no libera espacio en servidor** ni borra esos archivos automáticamente.
- No hay backend de archivos de entrega en esta iteración.

## Creamy — herramientas de entrega (read-only)

Tools disponibles en el asistente (snapshot local):

- `searchDeliveries`
- `getPendingDeliveries`
- `getLateDeliveries`
- `getDeliveriesByDateRange`
- `getDeliveriesByCustomer`

Comportamiento:

- Solo sectores con permiso de consulta (`PRODUCCION`, `CALIDAD`, `DIRECCION`, etc.).
- Excluyen registros con `status !== ENTREGADO` (incluye `REGISTRO_ELIMINADO` y `ANULADO`).
- Por defecto ocultan archivados; `includeArchived: true` los incluye con `archived: true` en el resultado.
- No ejecutan `deliver_work`, archivar, anular ni eliminar.

## Variables de entorno

| Variable | Uso |
|---|---|
| `OPENAI_API_KEY` | Clave OpenAI para el endpoint de chat (server-only). |
| `CREAMY_OPENAI_API_KEY` | Alias alternativo aceptado por la route de assistant. |
| `CREAMY_OPENAI_MODEL` | Override del modelo (default `gpt-4o-mini`). |

Nunca usar prefijo `NEXT_PUBLIC_` para claves. El cliente consulta `/api/v1/assistant/status` para saber si Creamy está configurado.

## Anular entrega archivada

- `annul_delivery` sobre una entrega **archivada** responde **404** (`NOT_FOUND_OR_ARCHIVED`).
- Flujo correcto: **Restaurar** (`restore_delivery`) → **Anular** (`annul_delivery` con motivo).

## Archivos relevantes

- `frontend/src/features/os/assistant/creamy-chat-context.tsx` — estado global del chat.
- `frontend/src/features/os/feedback/creamy-companion.tsx` — FAB + panel.
- `frontend/src/features/os/operational/views/entregados-view.tsx` — UI de entregas.
- `frontend/src/features/os/operational/adapters/delivery-repository.ts` — persistencia local.
- `frontend/src/app/api/v1/live-sync/operations/route.ts` — mutaciones Live Sync.
- `frontend/src/lib/live-sync/server-operational-state.ts` — overlay autoritativo server-side.
