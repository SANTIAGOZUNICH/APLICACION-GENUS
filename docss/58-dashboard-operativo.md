# 58 — Dashboard Operativo (nativo)

> Pestaña «Dashboard» del menú lateral, visible para **todos** los sectores. Inspirada en el «Dashboard Operativo 2026» del
> Google Sheets del laboratorio, pero **nativa**: se calcula sola con los datos reales de GENUS OS (nada incrustado, nada fijo,
> ningún registro ficticio). Solo lectura.

## Estado y advertencia principal

- **El Google Sheets original NO estuvo accesible** al desarrollar esto (requiere login; no hay conector de Drive/Sheets).
  Por lo tanto **las definiciones de cada indicador son un «criterio propuesto, pendiente de validar contra la planilla»**.
  Ninguna afirma coincidir con las fórmulas reales de la planilla vigente.
- Lo único que se pudo consultar es una **copia local antigua** del libro en el repo (`PEDIDOS 2026 (1).xlsx`, pestañas
  `Dashboard`, `KPI`, `CALCULOS_CLIENTES`, `PEDIDOS`, `EXPEDICION`). Se usó **solo como inspiración** de los criterios; puede
  estar desactualizada. Sus fórmulas observadas están en «Fórmulas de la planilla a confirmar» (más abajo).
- **Regla de oro: nada inventado.** Si GENUS OS no registra lo necesario (o la muestra es insuficiente) el indicador dice
  **«Sin datos suficientes»**, con el motivo y qué habría que registrar. No hay porcentajes, objetivos ni resultados de relleno.

## Qué muestra

| Bloque | Contenido |
|---|---|
| Encabezado | «Dashboard Operativo», año seleccionado, período, fecha de **última actualización de los datos** (último `updated_at` de las fuentes) y momento del cálculo; fuente de datos (real / demo en memoria / sin base). |
| Filtros | Año, mes/período, sector (Envasado Masivo / Premium) y cliente (solo Producción/Dirección). Cada indicador muestra **su** período y **qué fecha usa** (pedido / producción / entrega) y si el filtro de sector aplica. |
| Indicadores principales | Nivel de servicio · % de pedidos sin reclamos · Lead time promedio · Unidades producidas (trabajos) por año. |
| Gestión de pedidos | Pedidos activos · entregados · en despacho · productos distintos producidos. |
| Productividad de Envasado (Métricas) | KPIs coloreados (Total envasado, Masivo, Premium, % Masivo, % Premium, Promedio diario, Mes más productivo), participación Masivo/Premium, mayor/menor productividad por responsable, podio 1.º/2.º/3.º, ranking completo, tendencia mensual comparativa (variación vs mes anterior, SUBE/BAJA, columnas por responsable y total acumulado con %). Ver sección propia. |
| Clientes | Top por cantidad de pedidos, menor lead time promedio, clientes activos y comparación entre clientes. |
| Indicadores operativos | Resultado actual, objetivo, estado y **semáforo** (con texto, no solo color). |
| Resumen gerencial | Texto determinístico armado con los números calculados (sin IA); omite lo que no tiene datos. |

Cada tarjeta tiene un ícono de información que despliega el criterio, la fuente y las notas (registros excluidos, etc.).

## Reglas generales de cálculo

- **Solo lectura** sobre todo lo demás: el Dashboard nunca modifica pedidos, trabajos, entregas, stock ni remitos. Lo único
  que escribe es la tabla de objetivos (`dashboard_kpi_targets`) y su auditoría.
- Se **excluyen siempre**: registros con `deleted_at`, entregas `ANULADO` / `REGISTRO_ELIMINADO` (y las de trabajos
  eliminados), trabajos cancelados (`operational_status = 'cancelado'` o `operational_cancelled_at`).
- Los **clientes se derivan de los pedidos/trabajos** (no existe una tabla de clientes). Se comparan normalizados (sin tildes,
  minúsculas, espacios colapsados); se muestra la escritura más frecuente.
- Fechas calendario en **hora de Argentina (UTC-3)**.
- Cantidades: `finished_qty` (texto) se interpreta aceptando `1.200`, `1200`, `1.200,5`, `12,5`; si falta, se usa
  `packaging_total_units` (igual que «Mi trabajo»). Sin cantidad ⇒ el trabajo no se suma y se informa.
- Producción de Envasado: `work_items` cuyo sector es Envasado Masivo/Premium **o** que pasaron por Codificado con
  `codificado_origin_sector` Envasado (cuentan para su sector de origen). Elaboración (kg) y Codificado **no suman unidades**
  (no son unidades nuevas; evitar doble conteo).
- Un trabajo «terminado» es el que tiene `completed_at` o un estado operativo `completo / entregado / revision /
  codificado_completo / en_codificado`. La **fecha de producción** es `completed_at`; sin esa fecha no se puede ubicar en el
  tiempo y se informa aparte.

## Indicadores: definición, fuente, fecha y estado

Estado: **exacto** = el dato existe tal cual en GENUS OS · **adaptado** = criterio propuesto sobre datos que sí se registran ·
**sin datos** = GENUS OS no lo registra (o la muestra es 0). Todo lo «adaptado» está *pendiente de validar contra la planilla*.

| Indicador | Definición usada | Fuente | Fecha | Estado |
|---|---|---|---|---|
| Nivel de servicio | Promedio por pedido de (unidades producidas ÷ unidades pedidas) × 100. Solo pedidos con Q > 0 y con **todos** sus trabajos de Envasado terminados (con fecha de cierre y cantidad). No se limita a 100 %. | `production_pedidos.q` + `work_items` (Envasado) por `production_pedido_id` | Producción (último cierre del pedido) | Adaptado |
| % de pedidos sin reclamos | **Sin datos suficientes siempre**: GENUS OS no registra reclamos de clientes. Los rechazos/«rehacer» de Calidad son internos y no se usan. | — | Pedido | Sin datos |
| Lead time promedio | Promedio de días entre `fecha` del pedido y la **última entrega real** del pedido (entregas de Envasado/Codificado). Solo plazos > 0 y < 100 días (como la planilla local); el resto se informa como excluido. | `production_pedidos.fecha` + `work_item_deliveries.actual_delivered_at` | Entrega | Adaptado |
| Unidades producidas (trabajos) | Suma de cantidad final de trabajos de Envasado Masivo+Premium terminados. **No es la unidad envasada de Métricas** y puede diferir de ella; el rótulo lo aclara. Alimenta el semáforo de «unidades» (objetivo anual) y el nivel de servicio. | `work_items` | Producción | Adaptado |
| Pedidos activos | Estado `INGRESO`, `EN_ELABORACION`, `EN_ENVASADO` o `EN_CODIFICADO`. | `production_pedidos.estado` | Pedido | Exacto |
| Pedidos entregados | Estado `ENTREGADO`. | `production_pedidos.estado` | Pedido | Exacto |
| Pedidos en despacho | Estado `LISTO_PARA_ENTREGAR` (no hay un estado «en despacho» separado). | `production_pedidos.estado` | Pedido | Adaptado |
| Productos distintos | Nombres de producto distintos (normalizados) entre los trabajos de Envasado terminados. Texto libre: dos escrituras del mismo producto cuentan como dos. | `work_items.product` | Producción | Adaptado |
| Clientes activos | Clientes distintos con ≥ 1 pedido en el período. | `production_pedidos.cliente` | Pedido | Adaptado |
| Productividad de Envasado | Ver «Productividad de Envasado (fuente única: Métricas)». Reemplaza al antiguo bloque «Masivo vs Premium» calculado desde `work_items`. | `packaging_metrics` | Fecha de la métrica | Exacto |

Activos + En despacho + Entregados = total de pedidos del período (los pedidos sin estado reconocible se informan aparte).

**Filtros:** el de **sector** aplica a unidades y productos distintos (en Productividad de Envasado el filtro de sector se aplica a todo: el sector excluido queda «fuera del filtro»). El de **cliente** aplica a todo. El de **mes** acota los indicadores; el gráfico mensual siempre muestra el
año completo (con el mes resaltado). El sector **no** aplica a pedidos, nivel de servicio ni lead time (cada tarjeta lo aclara).

## Productividad de Envasado (fuente única: Métricas)

Indicadores del «Dashboard de Productividad 2026», calculados **solo** con el módulo **Métricas** (`packaging_metrics`,
servicio `src/lib/metricas/metricas-service.ts`). **No se calcula nada desde `work_items`.**

- **Fuente y frescura.** `src/lib/dashboard/metrics-source.ts` llama a `MetricasService.list` (la misma función que usa la
  pantalla de Métricas) con una identidad interna de Producción, solo lectura. Excluye `deleted_at` no nulo (el mismo criterio
  de «activos» de Métricas). **No hay caché**: la API responde `Cache-Control: no-store` y se recalcula en cada consulta, así que
  altas, ediciones, importaciones (pegado), bajas y restauraciones de Métricas se ven al instante (botón «Actualizar»).
  Los totales se suman con `computeTotals` de Métricas, por eso coinciden **exactamente** con lo que Métricas muestra para el
  mismo período/sector (prueba `metricas-consistency.test.ts` y E2E con SQL independiente).
- **Filtros.** Año, mes y sector del Dashboard (el de cliente no aplica: los registros de Métricas no tienen cliente; se avisa).
  Con filtro de sector todo se limita a ese sector y el otro queda «Fuera del filtro de sector».

| Indicador | Cálculo |
|---|---|
| TOTAL ENVASADO | Suma de `units` de los registros activos del período y sector (Masivo + Premium). |
| TOTAL MASIVO / TOTAL PREMIUM | Suma de `units` del sector. |
| % MASIVO / % PREMIUM | sector ÷ total envasado × 100 (1 decimal). Sin unidades: «Sin datos suficientes» (nunca divide por cero). |
| PROMEDIO DIARIO DE ENVASADO | total envasado ÷ cantidad de **fechas distintas** con registros válidos en el período. Masivo + Premium el mismo día cuenta **1 día**; no usa días calendario ni hábiles. Sin registros: «Sin datos suficientes». Con filtro de sector, solo ese sector. Un registro válido es activo, con fecha y unidades numéricas ≥ 0 (un registro en 0 cuenta como día con registro: a confirmar). |
| MES MÁS PRODUCTIVO | Mes del año seleccionado con más unidades (con filtro de sector; el de mes no aplica). Empate: el más temprano. |
| Tendencia mensual | 12 meses: Masivo, Premium, total, **variación % vs el mes calendario anterior** y **SUBE / BAJA / IGUAL**. Enero no tiene mes anterior; un mes sin registros (o con anterior sin registros) no se compara. |
| MAYOR / MENOR productividad | Responsable con más / menos unidades en el período. «Menor» exige al menos 2 responsables identificados. |
| Podio y ranking | Unidades por responsable, de mayor a menor, con cantidad y % de participación; podio visual 1.º/2.º/3.º arriba y ranking completo debajo; filtrable por período y sector. Empates: por nombre. |
| Columnas por responsable + total acumulado | En la tendencia: los 4 responsables con más unidades del año, «Otros» y «Sin responsable»; fila de total acumulado con su %. |

**Responsables (campo RESPONSABLE).** Se agrupan por `responsible_key`, la normalización que ya usa Métricas (minúsculas, espacios
colapsados). **No** se unifican tildes ni apodos: «José Díaz» y «Jose Diaz» quedan como dos personas antes que unir a dos
personas distintas por error (si son la misma, se corrige el dato en Métricas). Un registro sin responsable válido (vacío, solo
signos, «sin responsable», «n/a», «s/r»…) se agrupa en **«Sin responsable»**: aparece identificado al final del ranking, cuenta en
los totales y en el % pero **nunca** entra al podio ni a mayor/menor productividad.

### Unidades: envasadas, entregadas, pendientes y consumo de MP

Un glosario desplegable en la sección y el «Ver criterio» de cada tarjeta distinguen cuatro conceptos que **no se mezclan**:

| Concepto | Fuente | Dónde se usa |
|---|---|---|
| **Unidades envasadas** | Métricas | Toda la sección «Productividad de Envasado». |
| **Unidades entregadas** | Entregas reales | Solo el lead time. |
| **Unidades pendientes** | Pedidos y trabajos | Pedidos activos / en despacho (no son unidades envasadas). |
| **Consumo de materia prima** | Inventario | No se muestra ni se convierte en unidades. |

Los KPIs que antes decían «unidades producidas» y se calculan desde trabajos se **renombraron**: «Unidades producidas (trabajos)»,
«Productos distintos (trabajos)», columna de unidades por cliente y el objetivo «Unidades producidas (trabajos, año completo)»
(el semáforo y los objetivos ya guardados conservan su clave `unidades_producidas`). El bloque «Masivo vs Premium» y su gráfico
(que salían de trabajos) se reemplazaron por los de Métricas para que el mismo concepto no muestre dos valores.

**Permisos (mínimo privilegio).** Métricas sigue accesible solo para Envasado + Producción (`canAccessMetricas`); **no se amplió ningún
permiso de lectura ni de edición de Métricas**. El Dashboard lee con identidad interna y el servidor recorta el payload:

| Sector | Totales agregados (KPIs, participación, promedio, tendencia, mes más productivo) | Nombres de responsables (podio, ranking, mayor/menor, columnas) |
|---|---|---|
| PRODUCCION, DIRECCION | Sí | Todos los registros (Dirección: solo lectura, ya ve clientes) |
| ENVASADO_MASIVO / ENVASADO_PREMIUM | Sí (toda la planta) | Solo los registros de **su** sector (lo mismo que ya ve en Métricas); si filtra el otro sector: «No disponible» |
| ELABORACION, CODIFICADO, CALIDAD, MATERIA_PRIMA, DEPOSITO, COMERCIAL | Sí | No: «No disponible para tu sector» (los nombres no viajan en el payload) |

El % de participación de un sector de Envasado se calcula sobre el total de **su** alcance visible, así que no deja inferir a los
responsables ocultos.

## Semáforo y objetivos

- **No existen objetivos por defecto.** Tabla aditiva `dashboard_kpi_targets` (migración 0046): `key, target_value,
  direction ('min'|'max'), unit, updated_by, updated_at`. Nace vacía.
- Se editan **solo por Producción/Dirección**, desde el propio Dashboard (ícono de lápiz en «Indicadores operativos»).
  `PUT/DELETE /api/v1/dashboard/targets`; el servidor valida el sector (403 al resto) y el valor (número ≥ 0; % ≤ 100).
  Cada alta/cambio/baja queda en `feature_audit_events` (dominio `dashboard`, acciones `target_set` / `target_cleared`, con
  valor previo y nuevo).
- Indicadores que admiten objetivo: nivel de servicio, % sin reclamos, lead time, unidades producidas (**anual**: solo se
  evalúa con «Año completo», sector «Todos» y sin cliente; en otro caso queda «No aplica a este período»).
- **Regla del semáforo** (explícita; el 10 % es relativo al objetivo):

| Sentido | Verde (Cumple) | Amarillo (Atención) | Rojo (Crítico) |
|---|---|---|---|
| `min` (más alto es mejor) | resultado ≥ objetivo | resultado ≥ objetivo × 0,90 | resultado < objetivo × 0,90 |
| `max` (más bajo es mejor) | resultado ≤ objetivo | resultado ≤ objetivo × 1,10 | resultado > objetivo × 1,10 |

- Sin objetivo cargado: **«Sin objetivo definido»** (gris). Sin resultado: **«Sin datos suficientes»**.
- Todos los sectores ven el objetivo y el semáforo de **unidades** (solo lectura); Producción/Dirección ven los cuatro.

## Matriz de permisos (la decide el servidor)

`resolveOrdersActor(request)` → `dashboardLevelFor(sector)`. El payload se **recorta en el servidor** (los datos que el sector
no puede ver no viajan; no se ocultan en la UI).

| Sector | Nivel | Qué recibe |
|---|---|---|
| PRODUCCION, DIRECCION | `full` | Todo: nivel de servicio, lead time, reclamos (sin datos), ranking/comparación de clientes, lead time por cliente, filtro por cliente, lista de clientes, edición de objetivos. |
| ENVASADO_MASIVO, ENVASADO_PREMIUM | `aggregate` | Unidades envasadas (Métricas) de planta y trabajos, KPIs de productividad, tendencia mensual y **los responsables de SU sector** (con su sector propio resaltado), productos distintos, pedidos activos/despacho/entregados agregados, evolución mensual, objetivo de unidades (solo lectura). **Sin** clientes y **sin** nivel de servicio / lead time / reclamos («No disponible para tu sector»). |
| ELABORACION, CODIFICADO, CALIDAD, MATERIA_PRIMA, DEPOSITO, COMERCIAL | `aggregate` | Igual que Envasado (sin sector propio resaltado). |

- Filtro por cliente: solo `full`. Un sector `aggregate` que lo pida por API recibe **403** (no se ignora en silencio).
- Objetivos: lectura para cualquier sector autenticado; escritura (PUT/DELETE) solo `full`.
- Se decidió dejar nivel de servicio / lead time / reclamos solo para `full` (criterio conservador: la consigna listaba para el
  resto «unidades, productos distintos, pedidos agregados, evolución mensual»). Abrirlos a otros sectores es un cambio de una línea
  en `permissions.ts` / `compute.ts`.

## Qué falta registrar (y cómo proponerlo)

1. **Reclamos de clientes** (para «% de pedidos sin reclamos»). No existe entidad ni campo. Propuesta: campo `reclamo`
   (sí/no + fecha + motivo) en `production_pedidos`, o tabla `pedido_reclamos(pedido_id, fecha, motivo, estado, registrado_por)`
   vinculada al pedido. Con eso: `1 − pedidos con reclamo / pedidos del período`. No se aproxima con rechazos de Calidad.
2. **Fecha de entrega prometida al cliente** (para un indicador de cumplimiento de fecha). `work_items.delivery_date` es opcional y
   `work_item_deliveries.planned_delivery_date` se completa con un *fallback* a la fecha planificada de producción, por lo que no
   es una promesa real; por eso **no** se calcula «entregas en fecha». Propuesta: fecha prometida obligatoria en el pedido.
3. **Vínculo trabajo ↔ pedido** (`production_pedido_id`) y **cantidad pedida (Q)**: sin ellos el nivel de servicio y el lead time
   no se pueden calcular para ese pedido (se informa cuántos quedaron afuera). Propuesta: exigir el pedido al asignar el trabajo.
4. **Entrega al cliente** (despacho/remito) como evento propio: hoy la «entrega» registrada es la del sector a Calidad/Producción
   (queda el pedido «listo para entregar»). Si se quiere el lead time hasta el despacho real, registrar la fecha de despacho del
   remito por pedido.
5. **Tabla de clientes** con nombre canónico: hoy el cliente es texto libre en pedidos y trabajos (se normaliza, pero «Jactans» y
   «Jactans – Disney» son dos clientes).

## Fórmulas de la planilla a confirmar (NO validadas)

Observadas en la copia local `PEDIDOS 2026 (1).xlsx` (puede no coincidir con la planilla vigente). **No se afirma coincidencia.**

| Indicador | Fórmula observada en la copia local | Qué confirmar |
|---|---|---|
| Nivel de servicio | `AVERAGE(KPI!H2:H500)` con `H = EXPEDICION!I` y `I = 1 − (Q pedida − Q envasada)/Q pedida` (cumplimiento de cantidad, sin tope). Objetivo ≥ 97 % (atención ≥ 96 %). | ¿Es cantidad producida/pedida o entregas en fecha? ¿Tope 100 %? ¿Qué pedidos entran (¿solo entregados?)? Los rangos `H2:H500`/`H2:H1000` difieren entre celdas. |
| % pedidos sin reclamos | `1 − COUNTIF(KPI!I2:I31,"R") / COUNTA(KPI!C2:C31)`; objetivo > 95 %. | Se marca a mano una «R»; el rango `2:31` abarca solo 30 filas (¿intencional?). Quién carga el reclamo y con qué criterio. |
| Lead time | `AVERAGEIFS(KPI!G2:G1000, G>0, G<100)` con `G = EXPEDICION!K − PEDIDOS!B` (columna FECHA de EXPEDICION − fecha de pedido); objetivo ≤ 25 días. | ¿`EXPEDICION!K` es «listo para entregar» o despacho al cliente? ¿Por qué > 0 y < 100? ¿Por pedido o por entrega? |
| Unidades producidas / año | `SUM(EXPEDICION!G2:G10966)` (Q envasada). | Acá además se filtra por año de producción; la planilla no filtra por año. |
| Pedidos activos | `COUNTIF(PEDIDOS!J,"EN PROCESO") + COUNTIF(PEDIDOS!I,"INGRESO")`. | Sin filtro de año en la planilla. |
| Entregados / En despacho | `COUNTIF(PEDIDOS!L,"entregado")` / `COUNTIF(PEDIDOS!K,"despacho")` («listos para entregar»). | Entregado = tiene N° de remito en EXPEDICION; en GENUS OS es el estado `ENTREGADO` del pedido. |
| Productos / año | `COUNTA(KPI!D2:D10031)` (cuenta filas, no distintos), rótulo «Ítems distintos». | ¿Distintos o filas? |
| Consumo Masivo vs Premium | `SUMIF(PEDIDOS!F,"M"/"P", PEDIDOS!G)` = **unidades pedidas** por sector `S`. | Acá se usan unidades **producidas** por sector de Envasado. ¿Cuál quieren? |
| Clientes | Listas fijas en `CALCULOS_CLIENTES` (`COUNTIF(PEDIDOS!D:D, cliente)`); «clientes activos» = `COUNTA(CALCULOS_CLIENTES!A2:A2000)`. | La planilla usa una lista fija; acá se derivan de los pedidos del período. |
| Objetivos | ≥ 97 % / ≥ 96 % (atención), > 95 %, ≤ 25 días (en fórmulas con texto). | **No se cargaron como valores por defecto**: Producción/Dirección los definen en el Dashboard. |

## Arquitectura

- `src/lib/dashboard/` — `types.ts`, `kpi-definitions.ts` (definición textual de cada KPI), `compute.ts` (funciones **puras**),
  `productividad.ts` (cálculo puro de Productividad), `metrics-source.ts` (lectura de Métricas), `semaforo.ts`, `permissions.ts` (incluye `responsiblesScopeFor`), `data-source.ts` (lectura SQL de solo lectura / memoria para demo y tests), `targets-service.ts`,
  `service.ts`, `dashboard-client.ts`, `format.ts`.
- API: `GET /api/v1/dashboard?year&month&sector&client`; `GET/PUT/DELETE /api/v1/dashboard/targets`.
- UI: `src/features/os/operational/views/dashboard-view.tsx` + `components/dashboard/*` (tarjetas, gráfico SVG, semáforo,
  clientes, indicadores, filtros, `dashboard-productividad.tsx`, `dashboard-podium.tsx`). Sin librerías de gráficos nuevas.
- Navegación: ítem `dashboard` en `SidebarItemId`, `sector-registry.ts` (todos los sectores), `twin-nav.ts`, `os-sidebar.tsx`,
  `twin-app.tsx`.
- Modo demo/memoria: sin base y con `isFeatureMemoryAllowed()` lee filas de memoria (vacías por defecto ⇒ «Sin datos
  suficientes»). Sin memoria permitida: fuente «none».

## Migración 0046

`drizzle/0046_dashboard_kpi_targets.sql` — `-- genus:reconcile-safe`, `CREATE TABLE IF NOT EXISTS "dashboard_kpi_targets"`
(aditiva e idempotente). Agregada al `_journal.json` (idx 43), a `ALLOWED_RECONCILE_MIGRATIONS` (sha256 exacto), a
`REQUIRED_SCHEMA_OBJECTS` y a `src/lib/db/migration-reconcile.test.ts`. Si la tabla no existe (migración pendiente), el
Dashboard igual funciona (lectura) y avisa que los objetivos no se pueden guardar.

> Nota de coordinación: otra rama usa la 0045 (entregas programadas). Ambas agregan una entrada al journal con `idx` 43/44:
> al fusionar hay que renumerar el `idx` de la segunda (los `when` ya son crecientes). No se modificó ninguna migración existente.

## Pruebas

- Unitarias de `compute.ts` (`src/lib/dashboard/compute.test.ts`): sin datos, fechas faltantes, entregas anuladas/eliminadas,
  un solo cliente, meses sin producción, año filtrado, división por cero, semáforo, nivel agregado sin clientes.
- Permisos de la API (`src/app/api/v1/dashboard/route.test.ts`): cada sector, payload sin nombres de clientes, 403 en filtro por
  cliente y edición de objetivos, auditoría.
- Componentes (happy-dom): «Sin datos suficientes», semáforo con/sin objetivo, filtros, gráfico accesible, permisos en pantalla.
- Productividad (Métricas): `productividad.test.ts` (total/masivo/premium/%, promedio diario con día compartido y sin datos, ranking, orden,
  «Sin responsable», normalización, filtros período+sector, variación/SUBE-BAJA, permisos de nombres) y `metricas-consistency.test.ts`
  (Dashboard == Métricas con la misma función de totales, refleja alta/edición/importación/baja/restauración, permisos por sector).
  Componentes: tarjetas, podio, ranking, «No disponible».
- Menú: `src/features/os/navigation/dashboard-nav.test.ts` (los 10 sectores).
- E2E con Postgres **descartable** (Chromium): `flock -w 3600 /tmp/e2e.lock npm run test:e2e:dashboard`
  (`run-dashboard-local.sh` + `dashboard-validate.mjs`). Siembra datos de prueba («E2E Dash …») solo en la base descartable,
  compara la pantalla con un cálculo independiente por SQL, permisos por sector, filtros, objetivos/auditoría, solo lectura y
  capturas 1440/820/390 sin scroll horizontal. Usa los puertos 443 y 3280. Además siembra `packaging_metrics`, compara Dashboard vs
un cálculo SQL independiente de Métricas y verifica que alta/edición/importación/baja/restauración por `/api/v1/metricas` cambian el Dashboard.
(`GENUS_E2E_PRODUCTION_BUILD=1 flock -w 3600 /tmp/e2e.lock npm run test:e2e:dashboard`).
