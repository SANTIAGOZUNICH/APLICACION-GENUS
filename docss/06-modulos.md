# 06 — Módulos

Módulos funcionales del sistema. Cada uno: **objetivo · pantallas/vistas · usuarios**. (Nota: a partir de F7 la *navegación* se reorganiza por Workspaces de misión —ver `08`— pero los módulos siguen siendo la unidad funcional y de permisos —ver `04`.)

---

## Producción
- **Objetivo:** planificar y ejecutar la fabricación: planificación, OE (elaboración de granel) y OA (acondicionamiento de PT), con sus consumos por lote.
- **Pantallas:** lista/tablero de OE y OA por estado; detalle de orden (estilo ERP) con sus consumos, controles y avance; formularios guiados de consumo de MP/ME (con escaneo); registro de producción de lote; cierre de orden.
- **Usuarios:** Supervisor (crea/cierra), Operarios de Elaboración y Acondicionamiento (ejecutan).

## Calidad
- **Objetivo:** controlar y disponer lotes: registrar análisis y preparar la disposición que habilita la liberación.
- **Pantallas:** cola de lotes en cuarentena (por antigüedad); detalle de lote con su evidencia; formulario de carga de `ANALISIS_CALIDAD`; preparación de disposición.
- **Usuarios:** Calidad. Lectura para Supervisor, Dirección Técnica y Dirección.

## Liberaciones
- **Objetivo:** registrar la **decisión firmada** sobre cada lote (acto legal de Dirección Técnica). Es la materialización de las dos barreras GMP (granel y PT).
- **Pantallas:** cola "esperando firma" con la evidencia al lado; detalle de la disposición; acción **Firmar** (Liberar/Rechazar/Condicional/Bloquear); historial inmutable de `LIBERACIONES`.
- **Usuarios:** Dirección Técnica (firma), Calidad (prepara), todos los demás (lectura).

## Inventario
- **Objetivo:** estado de existencias y trazabilidad. Comprende `LOTES`, `MOVIMIENTOS` (libro mayor) y `SALDOS` (caché).
- **Pantallas:** consulta de saldos por lote/ítem; ficha de lote con su historial de movimientos; recepción; ajustes; alertas de stock crítico y por vencer.
- **Usuarios:** Depósito (opera), Administración (ajustes/maestros), Supervisor (consulta/ajuste), todos (lectura de saldos).

## Formulación
- **Objetivo:** definir y versionar las fórmulas/recetas (`BOM`): elaboración (MP por granel) y acondicionamiento (ME por PT), con densidad y especificaciones.
- **Pantallas:** lista de BOM por producto/granel; detalle con sus ítems y tolerancias; gestión de versiones (vigente/obsoleta) y aprobación.
- **Usuarios:** Dirección Técnica / Calidad (definen/aprueban), Producción (consulta).

## Comercial
- **Objetivo:** gestionar clientes, productos y pedidos; seguir el cumplimiento.
- **Pantallas:** maestros de `CLIENTES` y `PRODUCTOS`; alta de `PEDIDOS`/`PEDIDOS_DET`; seguimiento de pedidos con avance de producción y despacho.
- **Usuarios:** Administración / Comercial (gestiona), Supervisor (planifica desde pedidos).

## Depósito
- **Objetivo:** recepción de insumos, control de stock y **despacho** de PT contra pedido.
- **Pantallas:** tareas de recepción; tareas de despacho (guiadas, contra renglón de pedido, con validaciones); alertas de stock/vencimiento.
- **Usuarios:** Depósito (operario de área Depósito).

## Dirección Técnica
- **Objetivo:** garantía de cumplimiento ANMAT/GMP: firma de liberaciones y aprobación de fórmulas/especificaciones.
- **Pantallas:** cola de firma; revisión de evidencia y registro de lote; aprobación de BOM.
- **Usuarios:** Dirección Técnica (Farm. responsable).

## Dirección
- **Objetivo:** visión ejecutiva y gestión por excepción.
- **Pantallas:** tableros de KPIs (panorama); buzón de excepciones (rechazos, retrasos, quiebres, KPIs fuera de rango).
- **Usuarios:** Dirección.

---

> **Relación con Workspaces (F7+):** estos módulos no desaparecen; dejan de ser el **punto de entrada**. La navegación se organiza por **Workspaces de misión** (Producción, Calidad, Comercial, Depósito, Dirección), y el rol actúa como **lente** (qué se ve y qué se puede hacer dentro de cada misión). Los módulos siguen siendo la base de los **permisos** (`PERMISOS` se otorga por módulo). Ver `08-workspaces.md`.
