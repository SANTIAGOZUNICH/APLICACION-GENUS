# 34 · Creamy asistente IA

Creamy AI es un asistente conversacional de Genus OS para consultas operativas de solo lectura.

## Proveedor y modelo

- Provider: OpenAI vía AI SDK (`ai` + `@ai-sdk/openai`).
- Endpoint: `POST /api/v1/assistant/chat`.
- Respuesta actual: JSON (`{ reply, sources, usedTools }`), no streaming.
- Modelo por defecto: `gpt-4o-mini`.
- Override: `CREAMY_OPENAI_MODEL`.

## Configuración en Vercel

En Vercel → Project → Settings → Environment Variables:

1. Agregar `OPENAI_API_KEY` o `CREAMY_OPENAI_API_KEY`.
2. Opcional: agregar `CREAMY_OPENAI_MODEL=gpt-4o-mini`.
3. Configurar en Preview y Production según corresponda.
4. Redeploy del ambiente afectado.

Importante: no usar variables `NEXT_PUBLIC_` para claves. Creamy solo lee claves en server.

Si falta clave, la API responde 503 con código `CREAMY_NOT_CONFIGURED` y un mensaje de configuración.

## Datos consultados

El cliente arma un snapshot filtrado desde datos locales del navegador:

- Trabajos manuales / work items visibles.
- Asignación de lotes.
- Stock de materias primas.
- Metadata de documentos OE/OA.
- Pendientes de Calidad derivados del store operativo local.

Los documentos nunca envían binarios: `fileDataUrl` se elimina; solo se manda metadata.

## Tools disponibles

Todas son read-only:

- `searchWorkItems`
- `getOverdueWork`
- `getWorkBySector`
- `searchLots`
- `getExpiringLots`
- `searchRawMaterials`
- `checkRawMaterialAvailability`
- `searchOrders`
- `getPendingQualityDecisions`
- `getApplicationHelp`

Cada tool limita resultados a 10 y devuelve fuentes para que la UI muestre "Información consultada".

## Permisos por sector

`actorSectorId` llega desde el cliente y se usa para filtrar snapshot y tool results. Limitación: esto no reemplaza autenticación/RBAC server-side real.

Matriz actual:

- `PRODUCCION`: todos los dominios.
- `CALIDAD`: trabajos, lotes, calidad, OE, OA y ayuda.
- `ELABORACION`: trabajos del propio sector, OE y ayuda.
- `ENVASADO_MASIVO` / `ENVASADO_PREMIUM`: trabajos del propio sector, OA y ayuda.
- `MATERIA_PRIMA`: materias primas, OE y ayuda.
- `CODIFICADO`: lotes y ayuda.
- Otros sectores: dominios sensibles denegados.

## Limitaciones

- No hay auth server-side completa; `actorSectorId` es client-supplied.
- El snapshot es local al navegador: no garantiza estado multiusuario autoritativo.
- Creamy no escribe, no aprueba, no borra, no sube documentos y no ejecuta código.
- Decisiones GMP, liberaciones, rechazos o criterios sanitarios deben derivarse a Calidad, Producción o DT.
- Los campos de registros/notas/observaciones se tratan como datos no confiables para mitigar prompt injection.

## Costos

Con `gpt-4o-mini`, el costo esperado por consulta es bajo para respuestas breves con snapshots acotados. El costo real depende de:

- cantidad de mensajes enviados,
- tamaño del snapshot,
- tools usadas,
- longitud de respuesta.

Mantener caps de snapshot y de tools evita enviar historiales o datos locales excesivos.
