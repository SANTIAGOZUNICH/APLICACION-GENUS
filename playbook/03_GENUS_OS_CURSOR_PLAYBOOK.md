# GENUS_OS_CURSOR_PLAYBOOK
### Puerta de entrada para cualquier desarrollador o IA que trabaje en Genus OS

> **Qué es este documento.** Esto NO reemplaza `docss/`. `docss/` sigue siendo la fuente de verdad detallada (22 documentos, ~1860 líneas). Este Playbook es la capa de **síntesis y consolidación**: te dice qué de `docss/` está construido de verdad, qué es todavía blueprint, qué contradice o no contradice la realidad del código y de los Sheets operativos, y cómo pensar y actuar si sos Cursor (o cualquier otro asistente de código) trabajando en este repo.
>
> **Regla de resolución de conflictos:** si algo acá parece contradecir un documento de `docss/`, `docss/` gana — salvo en la sección 5 (Auditoría de fidelidad), donde este Playbook documenta explícitamente *dónde* la realidad del código/Sheets se desvía de lo que `docss/` describe. Ese desvío no es un error de `docss/`; es información nueva que `docss/` todavía no incorporó.
>
> **Última auditoría:** basada en el estado del repo `APLICACION-GENUS-main` entregado el 2 de julio de 2026 (22 docs en `docss/`, frontend Next.js 16 completo, 4 Excel operativos reales + 1 docx de OA real).
>
> **Ver también:** [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) y [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) para el conocimiento fundacional y el criterio de producto; [`04_GENUS_OS_EXECUTION_MANUAL.md`](./04_GENUS_OS_EXECUTION_MANUAL.md) para el procedimiento operativo de ejecución.

---

## Índice

- [0. Cómo leer este documento según quién seas](#0-cómo-leer-este-documento-según-quién-seas)
- [1. Qué es Genus OS (síntesis en una página)](#1-qué-es-genus-os-síntesis-en-una-página)
- [2. Mapa de las dos fuentes: qué es cada cosa](#2-mapa-de-las-dos-fuentes-qué-es-cada-cosa)
- [3. Los principios que nunca se rompen](#3-los-principios-que-nunca-se-rompen)
- [4. Arquitectura: quién manda a quién](#4-arquitectura-quién-manda-a-quién)
- [5. Auditoría de fidelidad — la parte nueva de este Playbook](#5-auditoría-de-fidelidad--la-parte-nueva-de-este-playbook)
- [6. Gaps identificados (consolidado, para planificar)](#6-gaps-identificados-consolidado-para-planificar)
- [7. Los flujos, el modelo, el RBAC y el design system — resumen operativo](#7-los-flujos-el-modelo-el-rbac-y-el-design-system--resumen-operativo)
- [8. Checklist — cómo debe pensar Cursor antes de tocar cualquier cosa](#8-checklist--cómo-debe-pensar-cursor-antes-de-tocar-cualquier-cosa)
- [9. Cómo debe evolucionar el frontend sin romper la arquitectura](#9-cómo-debe-evolucionar-el-frontend-sin-romper-la-arquitectura)
- [10. Preguntas abiertas que quedan pendientes de validar](#10-preguntas-abiertas-que-quedan-pendientes-de-validar)
- [11. Índice de referencia cruzada](#11-índice-de-referencia-cruzada)

---

## 0. Cómo leer este documento según quién seas

| Si sos... | Empezá por |
|---|---|
| **Cursor, arrancando una tarea nueva** | Sección 3 (no negociables) → Sección 8 (checklist antes de programar) → la sección específica de tu tarea |
| **Un desarrollador humano nuevo** | Secciones 1 → 2 → 4 → 7, después `docss/README.md` para el detalle |
| **Alguien evaluando qué falta** | Sección 5 (auditoría de fidelidad) y Sección 6 (gaps) |
| **Agustina validando este documento** | Todo, en orden — pero especialmente la Sección 5, que es la parte nueva que no estaba en ningún doc anterior |

---

## 1. Qué es Genus OS (síntesis en una página)

**Genus OS** (nombre de producto del frontend; el sistema completo se llama también "Genus Operaciones") es el sistema nervioso digital de **Laboratorio Genus**, fabricante cosmético por contrato (tercerista) en Avellaneda, Buenos Aires. Opera bajo **ANMAT**, **GMP** e **ISO 9001:2015**, con ~40 personas y producción para ~20+ marcas cliente.

Tiene dos capas:

1. **El motor operativo (backend, ya existe y funciona):** Google Sheets + AppSheet + Apps Script + Looker Studio + Slack. Es el registro append-only y auditable de todo lo que pasa en planta. **No se reemplaza, no se reescribe.**
2. **La experiencia (frontend, en construcción activa):** una aplicación Next.js/React que se está construyendo para ser la interfaz definitiva, consumiendo el mismo backend. Su visión: dejar de ser una base de datos navegable y convertirse en un **asistente** que le dice a cada persona qué tiene que hacer ahora.

La frase que resume todo el producto:

> **"Esto es lo próximo que tenés que hacer."**

Genus OS es un **ERP guiado por tareas** (organiza por trabajo/estado, no por módulo/dato) y un **sistema asistente** (push, no pull): calcula tu trabajo pendiente, te lo prioriza, te muestra los problemas antes de que los busques, y te vacía la bandeja a medida que avanzás el día.

**Genus OS NO es** un ERP tradicional, ni un CRM, ni un MRP, ni una copia de AppSheet, ni una digitalización literal de Excel.

El flujo de negocio de punta a punta:

```
Pedido → Planificación → OE (Elaboración/Granel) → Consumo MP → Liberación Granel
       → OA (Acondicionamiento/PT) → Consumo ME por lote → Liberación PT → Despacho
```

Con trazabilidad completa por lote y segregación de funciones GMP (quien ejecuta no libera; quien produce no firma) en cada paso.

---

## 2. Mapa de las dos fuentes: qué es cada cosa

Antes de tocar nada, entendé qué material tenés adelante y para qué sirve cada uno:

| Fuente | Qué es | Para qué la usás |
|---|---|---|
| `docss/00`–`docss/20` | La visión de producto completa, el modelo de datos, el design system, los flujos. **Sigue siendo la fuente de verdad.** | Entender **qué debería ser** el sistema y **por qué**. |
| `frontend/src/` | El código Next.js real, ya construido: design system aplicado, Workspaces, Bandeja, pipeline de acciones, adapters a datos reales. | Entender **qué existe hoy de verdad**, en qué nivel de madurez. |
| `ASIGNACION DE LOTES 2026.xlsx`, `PEDIDOS 2026.xlsx`, `SEMANAS 2026.xlsx`, `SHAMPOO VITAMIN SHOCK - CAV.xlsx`, `ORDEN DE ACONDICIONAMIENTO... LAUDE.docx` | Los documentos operativos **reales** que hoy usa el laboratorio en producción. | Entender **cómo es el dato de verdad**, con toda su irregularidad, y medir qué tan lejos está el modelo idealizado de `docss/03` de lo que hay en producción. |
| Este Playbook | La síntesis de las tres cosas anteriores. | Punto de entrada único. Cuando dudes, empezá acá; si necesitás el detalle fino, andá al doc de `docss/` correspondiente (siempre citado). |

---

## 3. Los principios que nunca se rompen

Consolidado de `docss/02-arquitectura.md` §1 y `docss/20-recomendaciones-cursor.md` §2. Si una tarea de Cursor implica romper alguno de estos, **se detiene y se pregunta**, no se avanza.

1. **`MOVIMIENTOS` es append-only.** Nunca `UPDATE`, nunca `DELETE`. Toda corrección es un movimiento nuevo. El signo lo calcula `cantidad_signo`; nunca se escribe una cantidad negativa a mano.
2. **`SALDOS` es derivado, nunca se escribe a mano.** Es la suma de `MOVIMIENTOS` por lote. Se lee o se recalcula, nunca se setea.
3. **`LIBERACIONES` es append-only** y es la **única** vía por la que cambia `LOTES.estado`. Nunca se edita el estado de un lote directamente.
4. **Los estados se derivan, no se tipean.** Estado de orden = transición de flujo. Estado de lote = última liberación. Cumplimiento de pedido = suma de despachos del renglón. No agregar campos manuales que dupliquen un estado derivable.
5. **La fórmula vive en `BOM`, versionada, y se congela** (`bom_version`) al nacer la OE/OA. Cambiar un BOM no altera órdenes históricas.
6. **Dos barreras de liberación humanas.** El granel debe estar Liberado antes de acondicionar. El PT debe estar Liberado antes de despachar. Ninguna pantalla debe permitir saltear esto.
7. **Segregación de funciones GMP.** Quien ejecuta/cierra una orden no firma su liberación. `ROL-DT` es el único con acción **Firmar**.
8. **RBAC default-deny, del lado servidor.** La UI oculta; la autorización real vive en la matriz `PERMISOS` y se valida en backend/API. Nunca confiar solo en el cliente.
9. **Todo cambio al modelo es aditivo.** Columnas y tablas nuevas van al final, sin romper fórmulas ni columnas existentes — especialmente en `MOVIMIENTOS`/`SALDOS`.
10. **El usuario no navega tablas para trabajar.** Si una solución obliga al operario a leer una grilla para saber qué hacer, está mal resuelta. El trabajo es tarea + flujo guiado.
11. **El backend actual no se reemplaza.** El frontend nuevo es *otra interfaz* sobre el mismo backend (Sheets + AppSheet), no un reemplazo de su lógica.
12. **Un significado = un color, siempre.** Verde solo para "aprobado por calidad" (nunca "terminado" genérico). "Cerrada" es gris, nunca verde. Azul es solo acción/marca, nunca estado.

> Fuente detallada: `docss/02-arquitectura.md`, `docss/20-recomendaciones-cursor.md`.

---

## 4. Arquitectura: quién manda a quién

```
┌─────────────────────────────────────────────┐
│  Frontend (Next.js/React) — frontend/src/    │  ← lo que estamos construyendo
│  Design System · Workspaces · Bandeja        │
└───────────────────┬───────────────────────────┘
                     │  hoy: adapters directos (mock | drive | sheets)
                     │  visión futura: API propia (docss/17) — NO EXISTE TODAVÍA
                     ▼
┌─────────────────────────────────────────────┐
│  Backend actual — NO SE TOCA                 │
│  Google Sheets (tablas) + AppSheet (RBAC,    │
│  acciones, automatizaciones) + Apps Script   │
└─────────────────────────────────────────────┘
```

**Estado real (verificado leyendo el código):** hoy NO hay una capa de API intermedia como la que describe `docss/17-api.md`. El frontend tiene un **`adapter-factory`** (`lib/adapters/adapter-factory.ts`) que elige en runtime entre:

- `mockAdapter` — datos 100% simulados, in-memory (`mocks/`).
- `driveAdapter` — lee de verdad Google Drive/Sheets (`GOOGLE_DRIVE_GENUS_FOLDER_ID`, hojas críticas `ASIGNACION DE LOTES 2026`, `PEDIDOS 2026`, `SEMANAS 2026`).

Esto se selecciona por la variable `GENUS_DATA_MODE` (`demo` | `real`). **`real` hoy es un slice experimental (E7.1), no producción completa** — el propio código lo marca explícitamente ("Movimientos no incluidos en ASIGNACION DE LOTES 2026", "Análisis no incluidos en el slice E7.1"). No hay todavía RBAC del lado servidor real sobre este adapter, ni escritura hacia Sheets (por ahora es solo lectura).

> Implicancia práctica para Cursor: **la API de `docss/17` es visión, no realidad.** Si una tarea asume que existe un backend de API con endpoints `/v1/...`, hay que verificar primero — hoy esos endpoints no existen; lo que existe es un adapter de lectura directo a Drive.

---

## 5. Auditoría de fidelidad — la parte nueva de este Playbook

Esta sección no existía en `docss/`. Es el resultado de cruzar el modelo de datos (`docss/03`) contra el código real (`lib/adapters/`) y contra los archivos operativos reales del laboratorio.

### 5.1 Tabla de fidelidad por entidad

| Entidad (`docss/03`) | Marca en `docss/03` | ¿Existe en el código del frontend? | ¿Existe en los Sheets/docs reales que vi? | Nota de la auditoría |
|---|---|---|---|---|
| `LOTES` | VERIFICADA | Sí — `types/`, mappers, `entity-page` para Lote | Parcial — `ASIGNACION DE LOTES 2026.xlsx` es un **log mensual por pestaña** (ENERO...JUNIO), no una tabla `LOTES` limpia con `estado` explícito | El "estado" del lote hoy se infiere (¿tiene fecha/N° de análisis o no?), no es un campo `LIBERACIONES`-derivado como pide el modelo. |
| `MOVIMIENTOS` | VERIFICADA | No conectado en el slice actual | No visto en los archivos entregados | El adapter de Drive lo marca explícitamente como "no incluido". Es el hueco más grande: sin esto, no hay `SALDOS` real ni trazabilidad de consumo real. |
| `SALDOS` | VERIFICADA | No conectado | No visto | Depende de `MOVIMIENTOS`. Mismo hueco. |
| `USUARIOS` / `ROLES` / `MODULOS` / `PERMISOS` | VERIFICADA (RBAC F6.0) | Sí, modelado en tipos (`RoleId`, mock role switcher) | No verificable desde los Excel entregados | Coherente con `docss/19` §1: existe en sandbox, pendiente de confirmar si ya está en el Sheet de producción — **tratar como pendiente salvo evidencia**. |
| `PEDIDOS` / `PEDIDOS_DET` | DISEÑADA | Sí — `pedido.mapper.ts`, `pedido-card.tsx`, ruta `/pedido/[id]` | Sí — `PEDIDOS 2026.xlsx` | **Desvío real confirmado:** la hoja real tiene columnas `OP, Fecha, N° OC, CLIENTE, PRODUCTO, S, Q, Ml, ESTADO, N° LOTE` — no `PEDIDO_ID/PEDIDO_DET_ID` normalizados, y `ESTADO` es **texto libre** ("entregado"), no el enum derivado Pendiente/Parcial/Completo que define el modelo. El mapper del frontend ya hace trabajo de traducción heurística (`pickField` con múltiples alias posibles) — es decir, el código ya está preparado para esta irregularidad, pero el dato de origen no está normalizado. |
| `OE` / `BOM` | DISEÑADA | Sí — `oe-sheet.mapper.ts`, `oe.handlers.ts`, `oe-card.tsx` | Sí — `SHAMPOO VITAMIN SHOCK - CAV.xlsx` (hoja `OE`) | Cada OE real hoy es **una hoja de cálculo por producto/lote**, con formato semi-libre (Código, Fecha, Cant. Kg, N° de Lote, Vigencia, Cliente, Equipo calefactor...). No hay un `BOM` versionado como tabla — la fórmula vive dispersa en estos documentos por producto. |
| `OA` | DISEÑADA | Sí — `oa.handlers.ts`, `oa-card.tsx`, `oe-document-locator.ts` | Sí — el `.docx` de Crema Facial Laude | El documento real es un formulario Word de una sola tabla con celdas fusionadas (Lote, Vto, Análisis, Aprobó, Código producto, Fecha emisión) — el "papel" que el sistema digital debe reemplazar, todavía no una fila de tabla estructurada. |
| `ANALISIS_CALIDAD` / `LIBERACIONES` | DISEÑADA | Modelado en tipos, sin adapter real conectado | Rastros parciales (columnas "FECHA ANALISIS", "N° ANALISIS", "APROBO" en los documentos reales) | El dato existe en el laboratorio pero disperso en distintos documentos; no hay todavía una tabla `LIBERACIONES` append-only real que el frontend pueda leer. |
| `CLIENTES` / `PRODUCTOS` | DISEÑADA | Sí, en tipos y mocks | Implícito (columna `MARCA`/`CLIENTE` en las planillas, sin maestro separado) | No hay maestro de clientes/productos normalizado visible en lo entregado; el dato vive repetido como texto en cada fila. |

### 5.2 Lectura de la auditoría

- **`docss/03` no está mal — está adelantado.** Es el contrato al que hay que llegar, no una descripción de lo que hay hoy. El propio documento ya avisa esto con las marcas `[VERIFICADA]`/`[DISEÑADA]`/`[PROPUESTA]`; esta auditoría simplemente confirma con evidencia real que esas marcas son precisas y probablemente **el gap es mayor de lo que un lector solo de `docss/` intuiría** — sobre todo en `MOVIMIENTOS`/`SALDOS` (el corazón del append-only) y en la normalización de `PEDIDOS`/`OE`/`OA`.
- **El código del frontend ya "sabe" esto.** Los mappers (`lote-asignacion.mapper.ts`, `pedido.mapper.ts`, `oe-sheet.mapper.ts`) están escritos con tolerancia a variación (`pickField` probando múltiples alias de columna), lo cual es la señal de que quien construyó el código ya lidió con esta irregularidad. Es un buen patrón — hay que mantenerlo, no "limpiarlo" prematuramente.
- **El diseño visual (Design System, Workspaces, gramática de card) está mucho más maduro que la conexión de datos.** F7.1 (Design System) está construido; la conexión real de datos (F1–F4.1 "verificado" según roadmap) está solo parcialmente reflejada en el frontend.

---

## 6. Gaps identificados (consolidado, para planificar)

| Gap | Impacto | Bloquea |
|---|---|---|
| `MOVIMIENTOS`/`SALDOS` no conectados al adapter real | Alto | Toda vista de saldo/trazabilidad real, toda validación de "cantidad ≤ saldo" |
| `ANALISIS_CALIDAD`/`LIBERACIONES` sin tabla real conectada | Alto | Las dos barreras de liberación no pueden operar sobre datos reales todavía |
| Tablas de gobierno RBAC (`ROLES`/`MODULOS`/`PERMISOS`) — estado de producción sin confirmar | Alto (P0 según `docss/19`) | RBAC real del lado servidor |
| `PEDIDOS.ESTADO` es texto libre, no el enum derivado | Medio | El cumplimiento de pedido no puede derivarse automáticamente de este campo tal cual está hoy |
| No hay maestro `CLIENTES`/`PRODUCTOS` normalizado visible | Medio | Cualquier validación cruzada producto↔cliente↔BOM |
| No existe la capa de API (`docss/17`) | Medio | El adapter directo a Drive es un atajo razonable para hoy, pero no escala a escritura ni a RBAC servidor real |
| Sin branding propio en `frontend/public/` (siguen los íconos default de Next.js) | Bajo | Cosmético, no funcional |

> Esta tabla es un insumo para decidir prioridades — no es una propuesta de solución (eso queda fuera de este documento, que es de comprensión y consolidación, no de implementación).

---

## 7. Los flujos, el modelo, el RBAC y el design system — resumen operativo

(Resumen deliberadamente corto: el detalle completo y autoritativo está en `docss/`. Esta sección es para no tener que abrir seis documentos para recordar lo esencial.)

**Flujo end-to-end** (`docss/05`): Recepción MP/ME → Pedido → Planificación → OE (crea, congela BOM) → Consumo MP por lote (error-proofing: lote existe, correcto, liberado, no vencido, cantidad ≤ saldo) → Granel nace en Cuarentena → **Liberación 1** (Calidad analiza, DT firma) → OA (congela BOM acondicionamiento, exige granel liberado) → Consumo ME por lote → PT nace en Cuarentena → **Liberación 2** → Despacho directo contra renglón de pedido (nunca "Orden de Despacho" separada).

**La posta** (quién recibe cada tarea al cambiar de estado): Operario cierra su parte → Supervisor cierra la orden → Calidad analiza/dispone → DT firma → Depósito despacha → Comercial ve avanzar el pedido. Nadie empuja el trabajo a mano.

**RBAC** (`docss/04`): 7 roles (`ROL-OP`, `ROL-SU`, `ROL-CA`, `ROL-DT`, `ROL-AD`, `ROL-DI`, `ROL-SV` inactivo), 13 módulos, 8 acciones canónicas (C·L·E·K·X·D·A·F), 107 permisos, default-deny. Único con **Firmar (F)**: `ROL-DT`.

**Design System** (`docss/07`, ya implementado en código): 5 tokens de color semánticos, un ícono por concepto, gramática de card única (identidad · título · badge · metadatos · urgencia · acción primaria), tablas solo para consulta.

**Workspaces y Bandeja** (`docss/08`, `docss/09`, parcialmente implementado): navegación por misión con el rol como lente; 6 secciones canónicas (Ahora / En cola / Esperando aprobación / Esperando a otros / Problemas / Finalizados); la Bandeja es la pantalla central que unifica todo — depende de la tabla futura `TAREAS`, que **todavía no existe** (es "la gran apuesta" del roadmap, bucket C/D).

---

## 8. Checklist — cómo debe pensar Cursor antes de tocar cualquier cosa

1. **¿Esta tarea toca el modelo de datos o el backend?** → Si sí, primero verificar contra la Sección 3 (no negociables) y la Sección 5 (qué está `[VERIFICADA]` vs `[DISEÑADA]` vs `[PROPUESTA]`). Nunca tratar una tabla `[DISEÑADA]`/`[PROPUESTA]` como si ya existiera en producción sin confirmarlo.
2. **¿Es una tarea de experiencia/frontend?** → Es terreno fértil, seguí el Design System (`docss/07`) al pie de la letra; no inventes tokens ni componentes nuevos sin agregarlos primero al sistema.
3. **¿Requiere leer/escribir datos reales?** → Recordá: hoy `GENUS_DATA_MODE=real` es un slice experimental de solo lectura sobre 3 hojas críticas. No asumas que hay escritura real ni que `MOVIMIENTOS`/`SALDOS`/`LIBERACIONES` están conectados — verificalo en `lib/adapters/drive/` antes de asumir.
4. **¿Toca RBAC?** → Tratalo como pendiente en producción salvo evidencia clara en el repo (`docss/19` §1, P0 sin confirmar).
5. **¿Es un módulo futuro (Creamy, Comunicación, Procedimientos, Capacitaciones)?** → No están diseñados en detalle. No inventes decisiones regulatorias ni de alcance — confirmá con Agustina/Dirección Técnica antes de construir.
6. **¿La solución obliga al operario a leer una tabla para saber qué hacer?** → Está mal resuelta. Rehacela como tarea + flujo guiado.
7. **Ante la duda entre "arreglar prolijo" y "respetar lo que ya existe por una razón GMP"** → gana lo segundo. Cambios al backend/modelo solo con justificación explícita.

---

## 9. Cómo debe evolucionar el frontend sin romper la arquitectura

- Todo cambio al modelo de datos es **aditivo**: columnas/tablas nuevas al final, nunca se reordena ni se borra lo existente.
- Todo componente nuevo de UI **reutiliza** el Design System (`docss/07`) — si falta algo, se agrega al sistema antes de usarse suelto en una pantalla.
- Toda regla de negocio crítica (estado, saldo, vencimiento, permiso) se valida donde vive la autoridad — hoy eso significa: **no confiar en el cliente**, aunque todavía no exista la capa de API formal de `docss/17`. Mientras esa capa no exista, cualquier validación crítica debe quedar explícita y visible en el código del adapter, no implícita en la UI.
- Los adapters (`mock` / `drive` / futuro `api`) deben mantenerse intercambiables: una pantalla nunca debe asumir cuál está activo.
- Antes de conectar una tabla nueva de Sheets reales, documentar en el propio código (como ya se hace en `lote-asignacion.mapper.ts`) qué campos **no** están todavía disponibles en esa fuente — el patrón de dejarlo explícito en el `description` de la sección es bueno y hay que mantenerlo.

---

## 10. Preguntas abiertas que quedan pendientes de validar

(Trasladadas de `docss/19` + las que surgieron de esta auditoría — no son bloqueantes para seguir trabajando, pero sí para cerrar el modelo de datos real)

1. Confirmar si `ROLES`/`MODULOS`/`PERMISOS` (RBAC) ya están en el Sheet de producción o siguen en sandbox (P0 de `docss/19`).
2. Confirmar si `PEDIDOS` tiene o va a tener `fecha_compromiso` — necesaria para nivel de servicio y para "compromiso por vencer" en el Workspace Comercial.
3. Decidir el criterio de normalización de `PEDIDOS.ESTADO` (hoy texto libre) hacia el enum derivado del modelo.
4. Definir el plan de conexión de `MOVIMIENTOS`/`SALDOS`/`ANALISIS_CALIDAD`/`LIBERACIONES` al adapter real — es el gap más grande entre visión y ejecución.
5. Definir si existe o se va a construir un maestro `CLIENTES`/`PRODUCTOS` separado, o si se sigue trabajando con el dato repetido en cada fila como hoy.

> **Estado de estas preguntas según Agustina (validado en conversación):**
> 2. `GENUS_DATA_MODE=real` debe considerarse experimental/slice inicial, no producción completa.
> 3. Dirección y Dirección Técnica pueden estar en la misma persona en la práctica, pero conceptualmente deben mantenerse separadas porque tienen responsabilidades distintas.
> 4. Si `docss/19-pendientes.md` marca P0, considerarlo todavía pendiente salvo evidencia clara en el repo.
> 5. El proyecto se viene desarrollando con ayuda de IA/Cursor, pero Agustina Zunich es quien define la visión de producto y valida las decisiones.

---

## 11. Índice de referencia cruzada

| Tema | Doc de detalle |
|---|---|
| Filosofía / visión | `docss/00-vision-general.md` |
| Objetivos, roles, KPIs | `docss/01-producto.md` |
| Arquitectura conceptual | `docss/02-arquitectura.md` |
| Modelo de datos completo | `docss/03-modelo-de-datos.md` |
| RBAC | `docss/04-rbac.md` |
| Flujos operativos | `docss/05-flujos-operativos.md` |
| Módulos funcionales | `docss/06-modulos.md` |
| Design System | `docss/07-design-system.md` |
| Workspaces | `docss/08-workspaces.md` |
| Bandeja Inteligente | `docss/09-bandeja-inteligente.md` |
| Módulos futuros (Creamy, Comunicación, Procedimientos, Capacitaciones) | `docss/10`–`docss/13` |
| Roadmap y buckets | `docss/14-roadmap.md` |
| Visión del frontend ideal | `docss/15-frontend.md` |
| Backend (por qué no se toca) | `docss/16-backend.md` |
| API futura | `docss/17-api.md` |
| Convenciones de lenguaje | `docss/18-convenciones.md` |
| Pendientes | `docss/19-pendientes.md` |
| Recomendaciones originales para Cursor | `docss/20-recomendaciones-cursor.md` |
| **Auditoría de fidelidad real (nuevo)** | Este documento, [Sección 5](#5-auditoría-de-fidelidad--la-parte-nueva-de-este-playbook) |
| Conocimiento fundacional (qué/por qué) | [`01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md`](./01_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_I.md) |
| Criterio de producto (cómo pensar) | [`02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md`](./02_GENUS_OS_FOUNDATIONAL_KNOWLEDGE_PART_II.md) |
| Manual de ejecución (cómo trabajar) | [`04_GENUS_OS_EXECUTION_MANUAL.md`](./04_GENUS_OS_EXECUTION_MANUAL.md) |

---

*Fin del Playbook. Cualquier decisión de producto nueva la valida Agustina Zunich; este documento no reemplaza ese criterio, lo hace más rápido de aplicar.*
