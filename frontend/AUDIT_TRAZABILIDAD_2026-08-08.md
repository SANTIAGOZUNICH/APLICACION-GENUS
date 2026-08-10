# GENUS OS — Auditoría de trazabilidad de datos extremo a extremo

> Fecha: 2026-08-08
> Alcance: **READ-ONLY**. Ningún cambio de código ni de datos en esta fase.
> Metodología: 6 pistas de auditoría en paralelo, cada una siguiendo campos concretos desde UI → API → service → Neon → lectura → UI destino, citando archivo:línea real (no genérico).
> Nota: existe un audit previo (`PRODUCTION_READINESS_AUDIT.md`, 2026-07-30). Varios de sus hallazgos siguen vigentes; otros quedaron obsoletos (la migración 0014 ya está aplicada en Production, por ejemplo). Este documento reemplaza su vigencia operativa.

---

## 1. Resumen ejecutivo

GENUS OS tiene una arquitectura de datos **partida en dos sistemas paralelos que no siempre se hablan entre sí**:

1. **Un sistema Neon/Drizzle real**, transaccional y bien construido en las partes nuevas (asignación de trabajos, handoff de Codificado, inventario ME/MP por código).
2. **Un sistema legado de `localStorage` + memoria del proceso del servidor (`Map` en RAM)**, que sigue siendo la fuente de verdad — o al menos una fuente **mezclada sin avisar** — para partes operativamente críticas: trabajos manuales, avance de envasado (cajas, lote, VTO, observaciones), entregas, granel, MP.

El síntoma que describís ("cargo algo, aparentemente se guarda, pero Producción no lo ve, o lo ve incompleto, o distinto en otra PC") **no es un bug puntual**: es la consecuencia directa y esperable de que buena parte del "guardado" real ocurre en el navegador del operario o en la memoria de una instancia serverless de Vercel, que se pierde en cada cold start y nunca se comparte entre PCs.

El segundo problema central — el consumo excesivo de Neon que tumbó el login — tiene causa raíz identificada y concreta: 4 conexiones SSE simultáneas por pestaña del panel de Producción (una por sector), reconectando cada ~300s por el límite de duración de funciones serverless, combinadas con validación de sesión contra Neon **sin caché** en cada poll de ~8s.

Ninguno de estos hallazgos requiere reconstruir el sistema. Son puntos concretos y localizados de reparación.

---

## 2. Tabla de problemas

| ID | Sev. | Flujo | Síntoma | Causa raíz | Archivo | Dato afectado |
|---|---|---|---|---|---|---|
| P0-1 | **P0** | Asignación/todas las vistas | Trabajos "fantasma" o divergentes entre PCs en Producción, Codificado, Envasado, Control MP, Entregados | `mergeManualWorkItems()`/`listAllManualWorkItems()` leen `localStorage["genus_os_manual_work_items"]` **incondicionalmente**, sin gatear por modo `native` (a diferencia de `asignar-trabajos-view.tsx`) | `produccion-panel-view.tsx:93-95`, `materia-prima-control-view.tsx:30`, `envasado-operational-view.tsx:121,536`, `codificado-operational-view.tsx:68-70`, `entregados-view.tsx:200`, `build-local-snapshot.ts:338` | Listados completos de trabajos por sector |
| P0-2 | **P0** | Envasado → Producción | Operario guarda avance ("Guardado" en pantalla), pero tras redeploy/cold-start/otra PC el dato no está | `saveWorkPackaging`/`saveProgress` persisten en `Map` en memoria del proceso servidor, sin `import` de Drizzle/DB | `src/lib/live-sync/server-operational-state.ts:36-132` | packagingLote, packagingVto, packagingTotalUnits, packagingCajas, packagingUnidadesPorCaja, packingGroups, packingMismatchObservation |
| P0-3 | **P0** | Envasado → Producción | Cajas, unidades/caja y observación de discrepancia nunca llegan a Producción, ni con el guardado "durable" | No existen como columnas Postgres — pérdida **estructural**, no accidental. Solo `packagingTotalUnits` y `packingGroups` (jsonb) tienen columna real | `src/lib/db/schema.ts:112-180`, `src/lib/planning/codificado-handoff-service.ts:300-326`, `src/lib/planning/native-projector.ts:41-126` | packaging_cajas, packaging_unidades_por_caja, packing_mismatch_observation (no existen) |
| P0-4 | **P0** | Envasado (guardado) | UI dice "Avance guardado." aunque el POST haya fallado (red/4xx/5xx) | `void postSaveProgress(...).catch(() => {})` fire-and-forget; `postSaveProgress` no chequea `response.ok`; mensaje de éxito se setea de forma síncrona antes de la confirmación real | `operational-store-context.tsx:313-328`, `src/lib/api/live-sync-client.ts:103-123`, `packaging-quantities-block.tsx:123-160` | Todo el bloque de embalaje |
| P0-5 | **P0** | Envasado/Codificado → Depósito | Sobrante de granel declarado en Envasado no llega como registro trazable a Depósito en Production | Tablas `deposito_graneles`/`deposito_graneles_audit` (migración 0014) están marcadas **"CREADA Y DIFERIDA — NO APLICAR sin autorización"**; solo hay script de aplicación a Preview, ninguno a Production. El error se traga en un toast que no bloquea el envío a Codificado | `drizzle/0014_codificado_deposito_graneles.sql`, `tmp-mig-0014-deferred/PLAN.md`, `envasado-operational-view.tsx:171-195,224-250` | bulkRemainderKg queda "suelto" en work_items sin vínculo operativo en Depósito |
| P0-6 | **P0** | Deploy / Depósito | Próximo build en Preview puede romperse, o el constraint puede crearse "a ciegas" sin backfill confirmado | `scripts/migrate-if-database.mjs` no tiene gate para 0021/0022; el índice único de código en `0022` fallará si existen materiales ME activos duplicados por código | `scripts/migrate-if-database.mjs:47-201`, `drizzle/0022_me_materials_codigo_unique.sql` | Build completo de Preview / integridad de `inv_me_materials` |
| P0-7 | **P0** | Sincronización / consumo Neon | Timeouts de 300s en `/live-sync/stream`, consumo excesivo de transferencia, login caído | 4 conexiones SSE simultáneas por pestaña (una por sector en el panel de Producción), sin `maxDuration`, reconexión automática infinita del `EventSource` nativo cada ~300s | `produccion-panel-view.tsx:87-90`, `src/app/api/v1/live-sync/stream/route.ts:9-10,62-77` | Tráfico total a la plataforma / cuota Neon (indirecto vía auth) |
| P0-8 | **P0** | Sincronización / consumo Neon | Consumo de Neon no proporcional al dato real transferido | `AuthService.resolveSession()` ejecuta 2 SELECT a Neon en cada validación de sesión, sin caché ni TTL, disparado cada ~8s por pestaña vía `/auth/me`; el helper `neon-read-cache.ts` ya existe pero no se usa acá | `src/lib/auth/service.ts:118-133`, `src/lib/pwa/connection-monitor.ts:59-75,104-108` | Cuota de transferencia/compute Neon — causa más probable del corte de login |
| P1-1 | P1 | Asignación de trabajos | Cantidad tipeada `"1.500"` (mil quinientos) se guarda como `1.5` | `parseFloat` tras reemplazar coma por punto no elimina separador de miles | `work-assignment-service.ts:428-433`, `ensure-oa-on-assign.ts:300-309` | packaging_total_units, rendimientos.produccionTeoricaUnidades |
| P1-2 | P1 | Asignación de trabajos | Botón "Asignar trabajo" bloquea aunque Neon esté listo, o el flujo cae en modo `sheets` sin que nadie lo note | `getClientPlanningSource()` cliente cae a `"sheets"` por defecto si falta `NEXT_PUBLIC_GENUS_PLANNING_SOURCE=native` en build, aunque el server ya detecta `DATABASE_URL` | `src/lib/planning/planning-source.ts:26-44` | Modo de operación completo del formulario |
| P1-3 | P1 | Envasado | "Sobraron 0 kg" es indistinguible de "no cargué nada" | `parseBulkRemainderKg` colapsa `0` explícito a `null`; además `if (payload.bulkRemainderKg && ...)` usa truthiness | `src/features/os/operational/lib/bulk-remainder.ts:17-19`, `envasado-operational-view.tsx:170,224` | bulkRemainderKg |
| P1-4 | P1 | Envasado | `14.9` cajas/unidades-por-caja se acepta silenciosamente como `14`, sin avisar al usuario | `parseNonNegInt` usa `Math.floor` sin feedback | `src/lib/remitos/packing-math.ts:17-21,53-61` | cajas, unidadesPorCaja, totalEmbalado |
| P1-5 | P1 | Entregas | Entregas registradas en un dispositivo no visibles desde otro | `delivery-repository.ts` 100% localStorage, sin ningún `fetch` | `src/features/os/operational/adapters/delivery-repository.ts:1-76` | Toda entrega |
| P1-6 | P1 | Estados (transversal) | Filtros pueden excluir trabajos válidos o mostrar cancelados como activos | Dos vocabularios de estado paralelos: enum Postgres en MAYÚSCULAS (`workItemStatusEnum`) vs strings cliente en minúsculas (`pendiente`, `cancelado`, etc.) sin mapeo central | `src/types/operational/work-item.ts:37`, `src/lib/workflow-engine/workflow-engine.ts`, `src/lib/lifecycle/policy.ts:111-337`, `produccion-panel-view.tsx:53,166` | Estado de cualquier work item |
| P1-7 | P1 | Transversal (localStorage) | Historial visible desaparece silenciosamente si el localStorage se corrompe | `catch {}` en lectura devuelve `[]`/`{}` sin avisar; asimétrico con `writeAll()` que no tiene try/catch (QuotaExceededError sin manejar) | 8 adapters (`manual-work-items-repository.ts:75,90`, `delivery-repository.ts:68,83`, `graneles-repository.ts:59,75`, etc.) | Historial completo del dominio afectado |
| P1-8 | P1 | Migraciones | Gap de trazabilidad entre Preview y Production | `0021_codificado_handoff_pedidos` aplicada a Production vía script ad-hoc, nunca registrada en `drizzle/meta/_journal.json` | `drizzle/meta/_journal.json`, `scripts/_apply_prod_0021_codificado.mjs` | Estado del schema tracking |
| P1-9 | P1 | Inventario | Snapshot Neon puede quedar parcialmente actualizado si el proceso corta a mitad de request | `persistInventorySnapshot` hace 8 tablas en loop secuencial de `await`, sin `BEGIN/COMMIT` | `src/lib/inventory/neon-persist.ts:250-320` | Ingresos/salidas/materiales/alertas ME y MP |
| P1-10 | P1 | Codificado | Observación de discrepancia (producido≠embalado) no llega a Neon tampoco en el handoff a Codificado | Payload de `SendToCodificadoDialog`/`handoffToCodificadoDurable` no incluye `packingMismatchObservation` (no existe columna, ver P0-3) | `send-to-codificado-dialog.tsx:25-30`, `codificado-handoff-service.ts:23-35` | packingMismatchObservation |
| P1-11 | P1 | Envasado/Codificado | Avance intermedio (cajas parciales no confirmadas) depende 100% del navegador hasta el click "Confirmar envío" | Ver P0-2; solo lo copiado al payload de `postCodificadoHandoff` en el momento del envío queda en Neon | `operational-store.ts`, `server-operational-state.ts`, `operational-store-context.tsx:276-331` | Progreso intermedio de embalaje |
| P2-1 | P2 | Asignación / OA | Toda OA auto-creada queda con código de producto vacío | El formulario de asignación no tiene input de código; el payload nunca incluye `productCode`; `compareCompatField` trata `""` como "ok", nunca detecta mismatch real | `asignar-trabajos-view.tsx:238-256`, `oa-assign-helpers.ts:36-37` | operational_orders.code |
| P2-2 | P2 | OA | Regla "1 OA = 1 trabajo" protegida solo a nivel aplicación, no de esquema | No hay unique/partial index sobre `linked_work_item_id` / `order_id` en DB | `schema.ts:157,271` | Integridad futura de la relación OA↔trabajo |
| P2-3 | P2 | Asignación | Unidad cae a "KG" incluso en sectores de envasado si llega vacía | `unit: (input.unit ?? default).trim() || "KG"` no distingue sector | `work-assignment-service.ts:418-420` | unit |
| P2-4 | P2 | Depósito/Graneles | Comentario en código contradice el estado real de la migración | Dice "0014 diferida, no aplicar sin autorización" pero 0014 sí está aplicada en Preview (y la tabla existe); el repositorio sigue escribiendo solo a localStorage igual | `graneles-repository.ts:2-4` | Confusión operativa para futuros cambios |
| P2-5 | P2 | Envasado | Trabajos entregados desde Codificado siguen apareciendo indefinidamente en la bandeja de Envasado | Falta condición equivalente a `codificadoCancelledAt IS NULL` que sí tiene el filtro de Codificado | `src/lib/planning/drizzle-repository.ts:208-230` | Visibilidad de bandeja Envasado |
| P2-6 | P2 | Infra Neon | Conexiones Neon pueden multiplicarse bajo escalado horizontal | `closeDb()` existe pero nunca se invoca en los handlers | `src/lib/db/client.ts:35` | Conexiones concurrentes |
| P2-7 | P2 | Testing | Suite de inventario tiene un test que cuelga en conjunto (pasa aislado) | Fuga de recursos/async entre tests del módulo MP | `src/lib/inventory/inventory-service.test.ts:364` | Confiabilidad de CI |
| P2-8 | P2 | Inventario/Depósito | Sin evidencia de backfill ejecutado antes de aplicar el constraint único de código | `scripts/_repair_me_inventario_by_codigo.mjs` existe y es correcto pero no hay reporte de ejecución real | `scripts/_repair_me_inventario_by_codigo.mjs` | inv_me_materials |
| P3-1 | P3 | Codificado | Asignación directa a Codificado no genera evento de auditoría (a diferencia del handoff) | No se llama a `operationalEvents` en ese camino | `native-projector.ts:20-23` | Historial/auditoría |
| P3-2 | P3 | Asignación | Fallback silencioso en corrupción de JSON del adapter legacy | `catch { return [] }` | `manual-work-items-repository.ts:70-93` | genus_os_manual_work_items |

**Hallazgo positivo confirmado (no es un problema):** el handoff Envasado→Codificado (commit `83aa51d`) es transaccionalmente correcto — `db.transaction`, idempotencia por `idempotencyKey`, `codificadoRevision` monotónico sin duplicar filas. El módulo de inventario ME/MP identifica correctamente por código normalizado (`normalizeMeCodigo`), sin agrupar por nombre, con deduplicación y reconciliación idempotente ya probadas.

---

## 3. Mapa de datos por flujo

### 3.1 Asignación de trabajos (Producción → sector) + OA
```
asignar-trabajos-view.tsx (form)
  → POST /api/v1/work-assignments (route.ts)
  → work-assignment-service.ts (validación + transacción)
  → ensure-oa-on-assign.ts / oa-assign-helpers.ts (crea o vincula OA)
  → drizzle: INSERT work_items + INSERT/UPDATE operational_orders (atómico)
  → GET vía drizzle-repository.ts (listPublishedItems) + native-projector.ts (mapper)
  → vistas: produccion-panel-view.tsx, codificado-operational-view.tsx, envasado-operational-view.tsx, materia-prima-control-view.tsx
```
**Punto de fuga:** las vistas de destino NO leen exclusivamente de ese GET — todas hacen `mergeManualWorkItems()` con `localStorage`, mezclando datos de otra fuente sin que el usuario lo sepa (P0-1).

### 3.2 Envasado Masivo/Premium → Producción
```
packaging-quantities-block.tsx (operario carga cajas/lote/VTO/sobrante)
  → operational-store-context.tsx: saveWorkPackaging()
  → EN PARALELO:
     (a) localStorage (operational-store.ts) — inmediato, local
     (b) POST /api/v1/live-sync/operations action=save_progress → server-operational-state.ts (Map en RAM) — "best effort", catch silencioso
  → SOLO al hacer clic "Confirmar envío a Codificado":
     codificado-handoff-service.ts → UPDATE work_items (packagingTotalUnits, packagingLote, packagingVto, packingGroups, bulkRemainder*) — esto sí llega a Neon
  → GET vía native-projector.ts → vistas de Producción
```
**Punto de fuga:** packagingCajas/packagingUnidadesPorCaja/packingMismatchObservation nunca tienen columna Neon (P0-3); el avance intermedio no confirmado se pierde en cold start (P0-2).

### 3.3 Codificado (handoff + directo)
```
Envasado: SendToCodificadoDialog → POST codificado/route.ts
  → codificado-handoff-service.ts::handoffToCodificadoDurable (db.transaction)
  → UPDATE work_items SET sentToCodificadoAt/By, codificadoOriginSector, viaCodificado=true, ...
  → Codificado ve el ítem vía drizzle-repository.ts (filtro sector/viaCodificado)
  → deliverFromCodificadoDurable / cancelCodificadoHandoffDurable (misma transacción, idempotente)
  → Producción ve el historial vía native-projector.ts
```
Directo (Producción → Codificado sin Envasado): mismo work-assignment-service.ts, `sector='CODIFICADO'`, sin paso por handoff — no genera `operationalEvents` (P3-1).

### 3.4 Depósito / Inventario (ME/MP)
```
me-ingresos-view.tsx / me-inventario-view.tsx
  → inventory-service.ts (exige código; normalizeMeCodigo)
  → neon-persist.ts::persistInventorySnapshot (upsert por código, 8 tablas, loop no transaccional)
  → recalculateMeStock (SIEMPRE recalcula desde ingresos−salidas por código, no confía en snapshot cacheado)
  → GET inventory route → vistas ME/MP
```
Correcto en identidad (por código), con el riesgo de atomicidad de P1-9.

### 3.5 Sincronización entre PCs
```
Cliente: EventSource nativo → /api/v1/live-sync/stream (SSE, sin maxDuration)
       + poll /check cada 8s + /status cada 30s + /auth/me cada 8s
Server: operationalEventBus (pub/sub en memoria) + Google Sheets watcher (no Neon)
Auth:   resolveSession → 2 SELECT Neon por request, sin caché
```
El módulo live-sync en sí no toca Neon (lee Sheets); el consumo de Neon viene de auth + rutas de negocio golpeadas por el mismo ciclo de polling/reconexión.

---

## 4. Campos perdidos (lista concreta)

| Campo | No se envía | No se persiste (sin columna) | No se selecciona | No se muestra |
|---|---|---|---|---|
| `productCode` (código de producto en asignación) | ✅ (form no lo captura) | — | — | — |
| `packagingCajas` | — | ✅ | ✅ | ✅ |
| `packagingUnidadesPorCaja` | — | ✅ | ✅ | ✅ |
| `packingMismatchObservation` | ✅ (payload handoff no lo incluye) | ✅ | ✅ | ✅ |
| Avance intermedio de embalaje (no confirmado) | — | ✅ (solo Map en RAM) | — | ✅ |
| `bulkRemainderKg = 0` explícito | se colapsa a `null` en el parser | — | — | tratado igual que "sin dato" |
| Entregas (deliveries) | — | ✅ (solo localStorage) | — | ✅ (no cross-device) |
| Sobrante de granel en Production | se envía, falla silenciosamente | ✅ (tabla no aplicada en prod) | — | ✅ en Depósito |

---

## 5. Problemas de sincronización entre PCs

Causa raíz dominante: **no es un problema de "tiempo real"**, es que buena parte de lo que parece guardarse no llega a Neon en absoluto (P0-1, P0-2, P0-3, P1-5, P1-11). Ninguna cantidad de polling o refetch va a arreglar esto — hay que mover la escritura real a Postgres primero. Una vez que el dato esté en Neon, el mecanismo de lectura actual (GET + refetch al entrar a la vista) alcanza; no hace falta "tiempo real al milisegundo", como vos mismo señalás.

## 6. Consumo de Neon — qué generar menos tráfico primero

1. **P0-7**: colapsar las 4 conexiones SSE del panel de Producción a 1 sola (multiplexar por sector en el cliente, no en el servidor), y fijar `maxDuration` + backoff explícito en el reconnect.
2. **P0-8**: cachear `resolveSession` (el helper `neon-read-cache.ts` ya existe, solo falta usarlo) con un TTL corto (5-10s) — reduce el poll de `/auth/me` de "2 SELECT cada 8s por pestaña" a casi cero.
3. **P2-6**: cerrar/reutilizar el pool de Neon correctamente en handlers serverless.

Ninguna de estas soluciones agrega polling — al revés, lo reduce.

---

## 7. Plan de reparación (orden recomendado)

**Fase 0 (ya cubierta por esta auditoría):** sin cambios de código.

**Fase 1 — P0 de sincronización/consumo (bloquea todo lo demás, incluido el login):**
1. P0-7 + P0-8: reducir conexiones SSE y cachear `resolveSession`. Esto es independiente del resto y de bajo riesgo.
2. P0-6: gatear 0021/0022 en `migrate-if-database.mjs`, correr `_repair_me_inventario_by_codigo.mjs --dry-run` contra Preview y Production antes de aplicar el índice único.
3. P0-5: decidir con vos si se autoriza aplicar 0014 a Production (tablas `deposito_graneles*`) — es una migración aditiva (`CREATE TABLE`), de bajo riesgo, pero requiere tu autorización explícita según tu propia regla.

**Fase 2 — P0 de integridad de datos (el núcleo de tu queja):**
4. P0-1: gatear `mergeManualWorkItems`/`listAllManualWorkItems` por modo `native` en las 6 vistas afectadas (mismo patrón que ya usa `asignar-trabajos-view.tsx`), o retirar el adapter si ya no aporta valor.
5. P0-3: agregar columnas reales (`packaging_cajas`, `packaging_unidades_por_caja`, `packing_mismatch_observation`) a `work_items` vía migración aditiva, y actualizar `native-projector.ts` para proyectarlas.
6. P0-2 + P1-11: mover `saveProgress`/`saveWorkPackaging` de `server-operational-state.ts` (Map) a un UPDATE real en `work_items` (o una tabla de progreso), reemplazando el guardado intermedio in-memory.
7. P0-4: no marcar "Guardado" hasta recibir `response.ok` real; propagar el error al operario con reintento.

**Fase 3 — P1 restantes:**
8. P1-1: normalizar separador de miles antes de `parseFloat` (o usar un parser numérico AR-aware) en cantidades.
9. P1-3: distinguir explícitamente `0` de `null`/`undefined` en sobrante de granel.
10. P1-6: unificar vocabulario de estados (un único enum, mapeo explícito si hace falta compatibilidad).
11. P1-5: migrar `delivery-repository.ts` a Neon.
12. P1-9: envolver `persistInventorySnapshot` en una transacción.

**Fase 4 — P2/P3:** el resto, en background, sin bloquear operación.

Para cada ítem de Fase 1-2, antes de tocar código: reproducir el síntoma con un caso concreto (ej. "Envasado carga 100 cajas × 96 un/caja, sobrante 12,5 kg" → verificar qué llega a Producción hoy), aplicar el fix mínimo, agregar test de regresión, y validar extremo a extremo (escribir en sector A → leer desde sector B con valores exactamente iguales) antes de dar el ítem por cerrado.

---

**Nada de esto se ejecutó todavía.** Quedo a la espera de tu confirmación para empezar por la Fase 1 (que es la que además evita que Neon se vuelva a cortar).
