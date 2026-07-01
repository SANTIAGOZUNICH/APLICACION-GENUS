# 01 — Producto

Define el producto desde la perspectiva de negocio y de usuario. Complementa la visión conceptual de `00-vision-general.md` con objetivos concretos, personas, casos de uso y métricas.

---

## 1. Objetivos del producto

| # | Objetivo | Cómo se mide el éxito |
|---|---|---|
| 1 | **Trazabilidad total por lote**, de materia prima a producto despachado, exigible en una inspección ANMAT | Cadena reconstruible para cualquier lote en < 5 minutos |
| 2 | **Cero error operativo evitable** mediante flujos guiados y validaciones (error-proofing) | Imposibilidad de consumir lote en cuarentena, vencido o de ítem incorrecto |
| 3 | **Segregación de funciones GMP** garantizada por el sistema, no por la disciplina de las personas | Matriz RBAC con default-deny; firmante ≠ cerrador |
| 4 | **Eliminar planillas paralelas**: una sola fuente de verdad | Cero registros fuera del sistema para operaciones GMP |
| 5 | **Reducir la carga cognitiva**: que el sistema diga qué hacer (ERP guiado por tareas) | Usuario empieza en su bandeja, no en un menú |
| 6 | **Visibilidad operativa y de gestión** en tiempo cuasi-real para supervisión y dirección | KPIs de cola, avance y excepciones disponibles |

---

## 2. Usuarios

El laboratorio tiene aproximadamente 40 personas. No todas interactúan con el sistema de la misma forma. Los usuarios del sistema, organizados por área:

### Elaboración

- **Quiénes:** operarios de planta que producen el granel.
- **Ejemplos:** Cristian, Nicolás, Santino.
- **Rol en el sistema:** `ROL-OP` con `area = Elaboración`.
- **Interacción principal:** consumo de MP por lote, controles de proceso, registro de producción de granel, marcar OE como lista.

### Acondicionamiento

- **Quiénes:** operarios que envasan y etiquetan el producto terminado.
- **Rol en el sistema:** `ROL-OP` con `area = Acondicionamiento`.
- **Interacción principal:** consumo de ME por lote, controles de envasado, registro de producción de PT, marcar OA como lista.

### Depósito

- **Quiénes:** personal de recepción, stock y despacho.
- **Ejemplo:** Belén.
- **Rol en el sistema:** `ROL-OP` con `area = Depósito`.
- **Interacción principal:** recepción de MP/ME, despacho de PT liberado contra pedido.

### Calidad

- **Quiénes:** analistas y responsables de control de calidad.
- **Ejemplo:** Santiago.
- **Rol en el sistema:** `ROL-CA`.
- **Interacción principal:** carga de análisis, preparación de disposición de liberación. **No firma.**

### Dirección Técnica

- **Quiénes:** responsable legal ANMAT del laboratorio.
- **Ejemplo:** Farm. Caio David Zunich.
- **Rol en el sistema:** `ROL-DT`.
- **Interacción principal:** firma de liberaciones (acto legal). Aprobación de fórmulas/especificaciones.

### Administración / Comercial

- **Quiénes:** personal que gestiona clientes, productos y pedidos.
- **Rol en el sistema:** `ROL-AD`.
- **Interacción principal:** maestros (MP, ME, clientes, productos), alta de pedidos, seguimiento de cumplimiento.

### Dirección

- **Quiénes:** gerencia y dirección del laboratorio.
- **Rol en el sistema:** `ROL-DI`.
- **Interacción principal:** lectura integral, tableros, gestión por excepción. No ejecuta operaciones.

### Clientes (externos)

- **Quiénes:** marcas para las que el laboratorio fabrica (~22).
- **Ejemplos:** Jactans, TMCO (The Minimal Co), TYL.
- **Interacción:** no usan el sistema directamente; sus pedidos se registran en Genus por Comercial.

---

## 3. Roles (RBAC)

Seis roles activos + un rol de servicio futuro. Detalle completo de permisos en `04-rbac.md`.

| ID | Rol | Resumen | Estado |
|---|---|---|---|
| `ROL-OP` | Operario | Ejecuta tareas físicas (recepción, consumo, despacho). Diferenciado por `area`. | Activo |
| `ROL-SU` | Supervisor | Planifica, confirma, crea y cierra OE/OA, ajustes de inventario. | Activo |
| `ROL-CA` | Calidad | Carga análisis y evidencia; prepara disposición. No firma. | Activo |
| `ROL-DT` | Dirección Técnica | Firma la liberación de lote (acto legal ANMAT). | Activo |
| `ROL-AD` | Administración | Mantiene maestros y gestiona pedidos. | Activo |
| `ROL-DI` | Dirección | Lectura integral y tableros ejecutivos. | Activo |
| `ROL-SV` | Servicio (Creamy) | Rol de servicio futuro para el asistente conversacional. | Inactivo |

### Diferenciación de operarios

`ROL-OP` es un solo rol con tres áreas:
- **Elaboración:** ve OE y consumos de MP.
- **Acondicionamiento:** ve OA y consumos de ME.
- **Depósito:** ve recepción y despacho.

La seguridad (permisos) es la misma; la experiencia se filtra por `USUARIOS.area`.

---

## 4. Casos de uso principales

### CU-01: Ingresar y planificar un pedido

- **Actores:** Comercial (crea), Supervisor (planifica).
- **Flujo:** Alta de `PEDIDOS` + `PEDIDOS_DET` → planificación en `PLANIFICACION` → generación de OE/OA.
- **Precondición:** cliente y productos existen en maestros.
- **Postcondición:** pedido en estado "En proceso"; órdenes de producción creadas.

### CU-02: Elaborar un granel contra una OE

- **Actores:** Operario de elaboración (ejecuta), Supervisor (cierra).
- **Flujo:** Iniciar OE → consumir MP por lote (`OE_CONSUMO`) → controles de proceso → registrar lote de granel → cerrar OE.
- **Validaciones:** lote MP liberado, no vencido, cantidad ≤ saldo, ítem correcto según BOM.
- **Postcondición:** granel en cuarentena; OE cerrada (inmutable).

### CU-03: Liberar el granel

- **Actores:** Calidad (analiza), Dirección Técnica (firma).
- **Flujo:** Cargar `ANALISIS_CALIDAD` → preparar disposición → DT firma en `LIBERACIONES`.
- **Postcondición:** granel Liberado (o Rechazado/Condicional/Bloqueado). Solo Liberado puede acondicionarse.

### CU-04: Acondicionar un PT contra una OA

- **Actores:** Operario de acondicionamiento (ejecuta), Supervisor (cierra).
- **Flujo:** Crear OA contra granel liberado → consumir ME por lote (`OA_MATERIALES`) → controles de envasado → registrar lote PT → cerrar OA.
- **Validaciones:** granel origen liberado; cada ME con su lote registrado.
- **Postcondición:** PT en cuarentena; OA cerrada.

### CU-05: Liberar el PT

- **Actores:** Calidad (analiza), Dirección Técnica (firma).
- **Flujo:** Análogo a CU-03 pero para el lote PT.
- **Postcondición:** PT Liberado. Solo Liberado puede despacharse.

### CU-06: Despachar PT liberado contra pedido

- **Actores:** Depósito.
- **Flujo:** Seleccionar renglón de pedido → escanear/seleccionar lote PT liberado → registrar cantidad → `MOVIMIENTOS` de Despacho.
- **Validaciones:** PT liberado, no vencido, cantidad ≤ saldo, producto del lote = producto del renglón.
- **Postcondición:** cumplimiento del renglón actualizado (derivado).

### CU-07: Reportar un problema en planta

- **Actores:** Operario (reporta), Supervisor (resuelve).
- **Estado:** módulo INCIDENCIAS pendiente de construcción.
- **Flujo previsto:** operario reporta desvío/incidencia → aparece en bandeja del supervisor → resolución/derivación.

### CU-08: Recepcionar MP/ME

- **Actores:** Depósito (recibe), Calidad (analiza y libera).
- **Flujo:** Registrar recepción → crear lote en cuarentena → análisis → liberación.
- **Postcondición:** insumo liberado y disponible para consumo.

### CU-09: Monitorear y decidir sobre excepciones

- **Actores:** Supervisor, Dirección.
- **Flujo:** Ver excepciones en Workspace (rechazos, retrasos, quiebres) → profundizar → escalar o resolver.
- **Postcondición:** excepción atendida o escalada.

---

## 5. Problemas actuales (estado previo / motivación del proyecto)

| Problema | Impacto | Estado con Genus |
|---|---|---|
| Información en planillas dispersas | Sin trazabilidad automática de punta a punta | Resuelto: libro mayor unificado |
| Lote de ME no registrado en acondicionamiento | Violación GMP; sin trazabilidad ME→PT | Resuelto: `OA_MATERIALES` con `LOTE_ID` |
| Error en consumos (lote equivocado, cuarentena, cantidad) | Riesgo de producto no conforme | Resuelto: validaciones error-proofing |
| Sin segregación de funciones forzada | Riesgo regulatorio en auditoría | Resuelto: RBAC default-deny |
| Estado de orden/lote no evidente | Carga cognitiva; errores de interpretación | En progreso: Design System + estados derivados |
| Usuario navega módulos para encontrar trabajo | Pérdida de tiempo; frustración | Pendiente: Bandeja Inteligente + TAREAS |
| Sin notificaciones de la posta | El trabajo no "llega" al siguiente rol | Pendiente: automatizaciones + notificaciones |

---

## 6. Beneficios

### Cumplimiento y auditoría

- Trazabilidad completa por lote, reconstruible en segundos.
- Registros ALCOA (Attributable, Legible, Contemporaneous, Original, Accurate).
- Segregación de funciones demostrable.
- Historial inmutable de movimientos y liberaciones.

### Calidad operativa

- Menos errores de consumo (lote equivocado, cuarentena, vencimiento).
- Menos retrabajo y mermas.
- Controles de proceso registrados y trazables.

### Velocidad

- Menos tiempo decidiendo qué hacer y dónde registrar.
- Flujos guiados reducen pasos innecesarios.
- La posta automática elimina esperas por comunicación manual.

### Gobernanza

- Acceso y acciones controladas por rol.
- Cambios de permiso auditables (fila en `PERMISOS`).
- Visibilidad de quién hizo qué y cuándo.

### Escalabilidad

- Sumar módulos (Compras, MRP, Comunicación, Capacitaciones) sin reescribir el núcleo.
- Front-end propio como capa independiente del backend.
- API como contrato estable para integraciones futuras.

---

## 7. KPIs esperados

Algunos KPIs requieren datos o cálculos adicionales. Se indica la dependencia.

### KPIs disponibles hoy (conteo directo)

| KPI | Qué mide | Fuente |
|---|---|---|
| OE en curso | Carga de trabajo de elaboración | Conteo de OE con estado "En curso" |
| OA en curso | Carga de trabajo de acondicionamiento | Conteo de OA con estado "En curso" |
| Lotes en cuarentena | Cola de calidad | Conteo de lotes con estado "Cuarentena" |
| Lotes esperando firma | Cola de Dirección Técnica | Conteo de liberaciones pendientes de firma |
| Pedidos pendientes | Demanda no satisfecha | Conteo de renglones con cumplimiento "Pendiente" |

### KPIs que requieren cálculo derivado (VCR / fórmulas)

| KPI | Qué mide | Dependencia |
|---|---|---|
| % de avance por orden | Real vs. plan | Cálculo: consumido/planificado o producido/planificado |
| Días en cuarentena | Antigüedad de lotes en cola de calidad | Cálculo: hoy − fecha de entrada en cuarentena |
| % aprobado / rechazado | Desempeño de calidad | Cálculo: liberaciones por decisión / total |
| Cumplimiento de pedidos | Pendiente / Parcial / Completo | Derivado de movimientos de despacho |

### KPIs que requieren datos nuevos

| KPI | Qué mide | Dependencia |
|---|---|---|
| Nivel de servicio (a tiempo) | Cumplimiento de fecha de compromiso | `fecha_compromiso` en `PEDIDOS` + fecha de entrega |
| Lead time por etapa | Tiempos de proceso (OE, cuarentena, OA, etc.) | Tabla de eventos/timestamps por transición de estado |
| Valor de inventario | Stock valorizado | Maestro de precios/costos por ítem |
| Stock crítico / por vencer | Prevención de quiebres y vencimientos | Umbral por ítem + fecha de vencimiento |

### KPIs de experiencia (cualitativos)

| Indicador | Meta |
|---|---|
| Operario sabe qué hacer sin preguntar | "Se siente otra cosa" a los 30 días |
| Supervisor ve su cola de cierre | Cero búsqueda manual de OE/OA listas |
| Calidad ve lotes por antigüedad | Priorización automática |
| DT ve cola de firma con evidencia | Una pantalla, sin navegar |

---

## 8. Perfiles de usuario y sus necesidades

### Operario de planta

- **Necesita:** saber qué hacer ahora, hacerlo sin error, pasar al siguiente.
- **No necesita:** ver tablas, filtrar, interpretar estados, navegar módulos.
- **Dispositivo:** móvil/tablet en planta, posiblemente con lector de código de barras.
- **Frecuencia:** uso continuo durante el turno.

### Supervisor

- **Necesita:** ver qué está en curso, qué necesita su decisión, qué tiene problemas.
- **No necesita:** operar consumos ni firmar liberaciones.
- **Dispositivo:** desktop principalmente; móvil para consultas.
- **Frecuencia:** uso continuo; múltiples contextos simultáneos.

### Calidad

- **Necesita:** cola de lotes en cuarentena priorizada por antigüedad, cargar análisis, preparar disposición.
- **No necesita:** firmar (eso es DT), operar producción.
- **Dispositivo:** desktop.
- **Frecuencia:** uso diario; picos cuando hay muchos lotes en cuarentena.

### Dirección Técnica

- **Necesita:** cola de firmas con evidencia al lado, consultar procedimientos (futuro: Creamy).
- **No necesita:** operar producción ni cargar análisis.
- **Dispositivo:** desktop.
- **Frecuencia:** uso diario pero concentrado en momentos de firma.

### Comercial / Administración

- **Necesita:** gestionar pedidos y maestros, seguir cumplimiento.
- **Dispositivo:** desktop.
- **Frecuencia:** uso diario moderado.

### Dirección

- **Necesita:** panorama ejecutivo, excepciones, KPIs fuera de rango.
- **No necesita:** ejecutar operaciones.
- **Dispositivo:** desktop.
- **Frecuencia:** consulta diaria/semanal.

---

## 9. Relación con otros documentos

| Documento | Contenido relacionado |
|---|---|
| `04-rbac.md` | Detalle de permisos por rol |
| `05-flujos-operativos.md` | Recorrido paso a paso de cada caso de uso |
| `06-modulos.md` | Módulos funcionales y sus pantallas |
| `08-workspaces.md` | Cómo cada rol ve su trabajo |
| `14-roadmap.md` | Qué está hecho y qué falta |
| `19-pendientes.md` | Inventario de pendientes |
